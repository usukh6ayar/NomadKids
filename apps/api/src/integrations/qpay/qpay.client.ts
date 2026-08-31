import { Injectable, Logger } from "@nestjs/common";
import { QpayConfig } from "./qpay.config";
import type { QpayErrorKind, QpayRequest, QpayResponse } from "./qpay.types";

/**
 * Every QPay failure, as one type.
 *
 * ★ Not an `HttpException`. This is an *outbound* failure, and letting it
 * escape as a Nest exception would forward QPay's status to our own caller — a
 * 401 from QPay would tell a parent that *their* session was rejected. The same
 * argument `EsisError` makes.
 *
 * ★★ `message` and `bodyExcerpt` are redacted before they are stored, so an
 * error reaching a log, Sentry or an HTTP response cannot carry the password or
 * a bearer token — see `QpayClient.redact`.
 */
export class QpayError extends Error {
  constructor(
    readonly kind: QpayErrorKind,
    message: string,
    readonly detail: {
      status?: number;
      /** Path only — never the full URL, which could carry a query secret. */
      path?: string;
      durationMs?: number;
      bodyExcerpt?: string;
    } = {},
  ) {
    super(message);
    this.name = "QpayError";
  }
}

const BODY_EXCERPT_LIMIT = 500;

/**
 * Seconds of headroom before a token is treated as expired.
 *
 * A token that expires while in flight fails the request it was fetched for.
 * Sixty seconds is comfortably longer than any single call and short enough
 * that we are not refreshing constantly.
 */
const EXPIRY_SKEW_SECONDS = 60;

/**
 * The HTTP client for QPay.
 *
 * ★ **The token is the difference from `EsisClient`, and it is the whole
 * reason this is a separate class rather than a shared one.**
 *
 * ESIS issues one long-lived token that lives in an environment variable. QPay
 * issues a short-lived one from `/auth/token`, and their integration note asks
 * for it explicitly:
 *
 * > "Token-ийн хугацааг timestamp-д тулгуурлан нэг удаагийн давтамжтайгаар
 * > үүсгэдэг байдлаар хөгжүүлнэ үү"
 *
 * So the token is cached with its expiry and re-fetched when it lapses. Three
 * properties matter and each is easy to get wrong:
 *
 *   1. **Expiry comes from QPay's own `expires_in`**, not from a guess. A
 *      hard-coded lifetime that outlives theirs fails every call until restart.
 *   2. **Concurrent refreshes collapse into one.** Ten requests noticing an
 *      expired token at once must not make ten `/auth/token` calls — that is
 *      how an integration gets rate-limited by its provider. `refreshing`
 *      holds the in-flight promise so the other nine await it.
 *   3. **A failed refresh clears the cache.** Holding a rejected promise would
 *      make every later call fail with the same stale error.
 *
 * ★★ Secrets never enter a URL, never enter a log line, and `redact()` scrubs
 * both the password and the live token from every string leaving this class.
 */
@Injectable()
export class QpayClient {
  private readonly logger = new Logger(QpayClient.name);

  /** The cached bearer token and the moment it stops being usable. */
  private token: { value: string; expiresAt: number } | null = null;

  /** The in-flight refresh, if one is running. See property 2 above. */
  private refreshing: Promise<string> | null = null;

  constructor(private readonly config: QpayConfig) {}

  /**
   * Makes one QPay request, fetching or reusing a token as needed.
   *
   * No retry: a retry policy depends on whether the endpoint is idempotent,
   * and creating an invoice twice is not a harmless repeat.
   */
  async request<T = unknown>(options: QpayRequest): Promise<QpayResponse<T>> {
    if (!this.config.isConfigured) {
      throw new QpayError(
        "not_configured",
        `QPay is not configured — set ${this.missingSettings().join(", ")}`,
        { path: options.path },
      );
    }

    const authenticated = options.authenticated ?? true;
    const headers: Record<string, string> = { Accept: "application/json" };

    if (authenticated) {
      headers.Authorization = `Bearer ${await this.accessToken()}`;
    } else {
      /*
       * `/auth/token` authenticates with HTTP Basic. Base64 is an encoding, not
       * encryption — which is exactly why `QPAY_BASE_URL` must be https, and
       * why `env.ts` refuses a plaintext origin in production.
       */
      const basic = Buffer.from(`${this.config.username}:${this.config.password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${basic}`;
    }

    return this.send<T>(options, headers);
  }

  /**
   * A valid bearer token, fetched only when the cached one has lapsed.
   *
   * ★ The single-flight guard. `refreshing` is set *before* the await so that a
   * second caller arriving mid-fetch joins the same promise instead of starting
   * a second one.
   */
  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now) return this.token.value;

    if (!this.refreshing) {
      this.refreshing = this.fetchToken().finally(() => {
        // Cleared whether it resolved or rejected: a retained rejected promise
        // would poison every later call with a stale failure.
        this.refreshing = null;
      });
    }

    return this.refreshing;
  }

  /**
   * Exchanges the merchant credentials for a bearer token.
   *
   * ★ The expiry is taken from QPay's response. `expires_in` is documented in
   * seconds; some deployments return `expires_at` as a unix timestamp instead,
   * so both are read and the sooner wins. When neither is present we fall back
   * to a deliberately short lifetime — a token we cannot date is one we should
   * not lean on.
   */
  private async fetchToken(): Promise<string> {
    let response: QpayResponse<Record<string, unknown>>;

    try {
      response = await this.request<Record<string, unknown>>({
        path: "/auth/token",
        method: "POST",
        authenticated: false,
      });
    } catch (cause) {
      // Re-thrown as `auth` so a caller can distinguish "our credentials are
      // wrong" from "this particular endpoint failed" — they need different
      // people to fix them.
      throw new QpayError(
        "auth",
        `QPay authentication failed: ${this.redact(
          cause instanceof Error ? cause.message : "unknown",
        )}`,
        cause instanceof QpayError ? cause.detail : {},
      );
    }

    const body = response.data;
    const value = typeof body.access_token === "string" ? body.access_token : "";

    if (!value) {
      throw new QpayError("auth", "QPay returned no access_token", { path: "/auth/token" });
    }

    this.token = { value, expiresAt: this.expiryFrom(body) };
    return value;
  }

  /** When the token in this body stops being usable, as an epoch millisecond. */
  private expiryFrom(body: Record<string, unknown>): number {
    const now = Date.now();
    const candidates: number[] = [];

    if (typeof body.expires_in === "number" && body.expires_in > 0) {
      candidates.push(now + (body.expires_in - EXPIRY_SKEW_SECONDS) * 1000);
    }
    if (typeof body.expires_at === "number" && body.expires_at > 0) {
      candidates.push(body.expires_at * 1000 - EXPIRY_SKEW_SECONDS * 1000);
    }

    // No usable expiry: hold it for five minutes rather than indefinitely.
    if (candidates.length === 0) return now + 5 * 60 * 1000;

    return Math.min(...candidates);
  }

  /** One HTTP round trip, with the transport failures separated. */
  private async send<T>(
    options: QpayRequest,
    headers: Record<string, string>,
  ): Promise<QpayResponse<T>> {
    const url = this.buildUrl(options.path, options.query);
    const method = options.method ?? "GET";
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          ...headers,
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs ?? this.config.timeoutMs),
      });
    } catch (cause) {
      const durationMs = Date.now() - startedAt;
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";

      this.logFailure(method, options.path, timedOut ? "timeout" : "network", durationMs);

      throw new QpayError(
        timedOut ? "timeout" : "network",
        timedOut
          ? `QPay request timed out after ${options.timeoutMs ?? this.config.timeoutMs}ms`
          : `QPay request failed: ${this.redact(
              cause instanceof Error ? cause.message : "unknown",
            )}`,
        { path: options.path, durationMs },
      );
    }

    const durationMs = Date.now() - startedAt;
    const rawBody = await response.text().catch(() => "");

    if (!response.ok) {
      /*
       * ★ A 401 drops the cached token. QPay may expire it early — a restart on
       * their side, a credential rotation — and holding a token they have
       * stopped honouring would fail every call until our own process
       * restarted. The next call fetches a fresh one.
       */
      if (response.status === 401) this.token = null;

      this.logFailure(method, options.path, "http", durationMs, response.status);

      throw new QpayError("http", `QPay responded ${response.status}`, {
        status: response.status,
        path: options.path,
        durationMs,
        bodyExcerpt: this.excerpt(rawBody),
      });
    }

    let data: unknown;
    try {
      data = rawBody === "" ? null : JSON.parse(rawBody);
    } catch {
      throw new QpayError("invalid_response", "QPay returned a body that is not JSON", {
        status: response.status,
        path: options.path,
        durationMs,
        bodyExcerpt: this.excerpt(rawBody),
      });
    }

    if (options.parse) {
      try {
        data = options.parse(data);
      } catch (cause) {
        throw new QpayError(
          "invalid_response",
          `QPay response did not match the expected shape: ${this.redact(
            cause instanceof Error ? cause.message : "unknown",
          )}`,
          { status: response.status, path: options.path, durationMs },
        );
      }
    }

    this.logger.log(`QPay ${method} ${options.path} → ${response.status} (${durationMs}ms)`);

    return { data: data as T, status: response.status, durationMs };
  }

  /**
   * Removes the password and the live token from a string.
   *
   * ★ The backstop behind every other habit here. Guards against short values
   * explicitly: a global replace of `''` inserts the placeholder between every
   * character, corrupting every message on an unconfigured instance.
   */
  private redact(text: string): string {
    let result = text;

    for (const secret of [this.config.password, this.token?.value]) {
      if (secret && secret.length >= 8) result = result.split(secret).join("[REDACTED]");
    }

    return result;
  }

  private excerpt(body: string): string {
    const redacted = this.redact(body);
    return redacted.length > BODY_EXCERPT_LIMIT
      ? `${redacted.slice(0, BODY_EXCERPT_LIMIT)}…`
      : redacted;
  }

  private buildUrl(path: string, query?: QpayRequest["query"]): string {
    const url = new URL(`${this.config.baseUrl}/${path.replace(/^\/+/, "")}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  /** Which settings are absent. Names only — a value here could be the password. */
  private missingSettings(): string[] {
    const missing: string[] = [];
    if (!this.config.baseUrl) missing.push("QPAY_BASE_URL");
    if (!this.config.username) missing.push("QPAY_USERNAME");
    if (!this.config.password) missing.push("QPAY_PASSWORD");
    if (!this.config.invoiceCode) missing.push("QPAY_INVOICE_CODE");
    if (!this.config.callbackUrl) missing.push("QPAY_CALLBACK_URL");

    return missing;
  }

  /** One log line per failure. Path, not URL; status, not body; never headers. */
  private logFailure(
    method: string,
    path: string,
    kind: QpayErrorKind,
    durationMs: number,
    status?: number,
  ): void {
    this.logger.warn(
      `QPay ${method} ${path} failed (${kind}${status ? ` ${status}` : ""}) after ${durationMs}ms`,
    );
  }

  /**
   * Drops the cached token. Test seam, and an operator escape hatch after a
   * credential rotation.
   */
  resetToken(): void {
    this.token = null;
  }
}
