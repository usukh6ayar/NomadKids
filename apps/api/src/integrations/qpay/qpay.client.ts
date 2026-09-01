import { Injectable, Logger } from "@nestjs/common";
import type { ZodType } from "zod";
import { QpayConfig } from "./qpay.config";
import {
  qpayCheckPaymentResponseSchema,
  qpayCreateInvoiceResponseSchema,
  qpayTokenResponseSchema,
  type QpayCheckPaymentResponse,
  type QpayCreateInvoiceResponse,
  type QpayErrorKind,
} from "./qpay.types";

/**
 * Every QPay failure, as one type — mirrors `EsisError`.
 *
 * Not an `HttpException`: this is an *outbound* failure, and letting it
 * escape as a Nest exception would forward QPay's status code to our own
 * caller. `QpayService` decides what a parent or the callback sees; this only
 * says what happened. `message` and `bodyExcerpt` are redacted before they
 * are stored — see `QpayClient.redact`.
 */
export class QpayError extends Error {
  constructor(
    readonly kind: QpayErrorKind,
    message: string,
    readonly detail: {
      status?: number;
      /** Path only — never the full URL. */
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
 * A token is treated as expired this far ahead of its real expiry, so a
 * request that starts just before the boundary does not race the clock and
 * get refused mid-flight.
 */
const TOKEN_SAFETY_MARGIN_MS = 30_000;

/**
 * When the token stops being usable, in epoch milliseconds.
 *
 * ★ `expires_in` is **an absolute Unix timestamp on QPay's v2 API**, not the
 * duration in seconds the field name implies everywhere else in OAuth. Their
 * own onboarding mail says so — "Token-ийн хугацааг timestamp-д тулгуурлан ...
 * үүсгэдэг байдлаар хөгжүүлнэ үү" — and this client read it as a duration
 * until 2026-09-01.
 *
 * The consequence was not a visible failure. `now + 1.79e9 * 1000` lands in
 * the year 58,000, so the token cached successfully and was never refreshed;
 * everything worked until QPay expired it server-side, after which every call
 * would 401 forever and only a restart would clear it.
 *
 * Both readings are accepted, because the API shape is documented but has
 * never been exercised (`docs/reference/QPAY_INTEGRATION.md`) and guessing
 * wrong in the other direction — treating a real duration as a timestamp —
 * would expire the token instantly and re-authenticate on every call. A value
 * that is already past as an epoch is a duration; anything else is a deadline.
 */
export function tokenExpiryMs(expiresIn: number, nowMs: number): number {
  const asEpochMs = expiresIn * 1000;
  return asEpochMs > nowMs ? asEpochMs : nowMs + asEpochMs;
}

/**
 * The HTTP client for QPay's v2 "Simple" merchant API.
 *
 * ★ Unlike `EsisClient`, this one has real domain methods (`createInvoice`,
 * `checkPayment`) rather than a bare `request()` escape hatch. ESIS's shape
 * is unknown until the ministry answers a written request; QPay's v2 API is
 * public, and `docs/reference/QPAY_INTEGRATION.md` records exactly what is
 * assumed here. What is genuinely untested is different: not the contract,
 * but whether these particular credentials and this network path work —
 * there is no sandbox account to try them against yet.
 *
 * ★★ Same credential discipline as `EsisClient`: the password crosses exactly
 * one place (the token exchange's `Authorization: Basic` header), the bearer
 * token it returns is cached in memory only and never logged, and `redact()`
 * scrubs both from any string that could escape this class.
 */
@Injectable()
export class QpayClient {
  private readonly logger = new Logger(QpayClient.name);
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(private readonly config: QpayConfig) {}

  /** Creates one payable invoice on QPay's side, returning its QR and deep links. */
  async createInvoice(input: {
    senderInvoiceNo: string;
    /** Decimal string, e.g. `"195000.00"` — turned into a JSON number only here, at the edge. */
    amount: string;
    description: string;
  }): Promise<QpayCreateInvoiceResponse> {
    const token = await this.getAccessToken();

    return this.request(
      "/v2/invoice",
      {
        invoice_code: this.config.invoiceCode,
        sender_invoice_no: input.senderInvoiceNo,
        invoice_receiver_code: "terminal",
        invoice_description: input.description.slice(0, 200),
        amount: Number(input.amount),
        callback_url: this.config.callbackUrl,
      },
      `Bearer ${token}`,
      qpayCreateInvoiceResponseSchema,
    );
  }

  /**
   * Asks QPay directly whether an invoice has been paid.
   *
   * ★ This is the only source of truth this codebase trusts for "was this
   * paid" — never a callback's own request body. See `QpayService.reconcile`.
   */
  async checkPayment(qpayInvoiceId: string): Promise<QpayCheckPaymentResponse> {
    const token = await this.getAccessToken();

    return this.request(
      "/v2/payment/check",
      {
        object_type: "INVOICE",
        object_id: qpayInvoiceId,
        offset: { page_number: 1, page_limit: 100 },
      },
      `Bearer ${token}`,
      qpayCheckPaymentResponseSchema,
    );
  }

  /** The cached bearer token, refreshed by re-authenticating once it is near expiry. */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now) return this.cachedToken.accessToken;

    const credentials = Buffer.from(`${this.config.username}:${this.config.password}`).toString(
      "base64",
    );
    const parsed = await this.request(
      "/v2/auth/token",
      undefined,
      `Basic ${credentials}`,
      qpayTokenResponseSchema,
    );

    this.cachedToken = {
      accessToken: parsed.access_token,
      expiresAt: tokenExpiryMs(parsed.expires_in, now) - TOKEN_SAFETY_MARGIN_MS,
    };
    return parsed.access_token;
  }

  /** One QPay request: config check, `fetch`, status/JSON handling, schema validation. */
  private async request<T>(
    path: string,
    body: unknown,
    authorization: string,
    schema: ZodType<T>,
  ): Promise<T> {
    if (!this.config.isConfigured) {
      throw new QpayError(
        "not_configured",
        `QPay is not configured — set ${this.missingSettings().join(", ")}`,
        { path },
      );
    }

    const url = `${this.config.baseUrl}${path}`;
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (cause) {
      const durationMs = Date.now() - startedAt;
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      this.logFailure(path, timedOut ? "timeout" : "network", durationMs);

      throw new QpayError(
        timedOut ? "timeout" : "network",
        timedOut
          ? `QPay request timed out after ${this.config.timeoutMs}ms`
          : `QPay request failed: ${this.redact(cause instanceof Error ? cause.message : "unknown")}`,
        { path, durationMs },
      );
    }

    const durationMs = Date.now() - startedAt;
    const rawBody = await response.text().catch(() => "");

    if (!response.ok) {
      this.logFailure(path, "http", durationMs, response.status);
      throw new QpayError("http", `QPay responded ${response.status}`, {
        status: response.status,
        path,
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
        path,
        durationMs,
        bodyExcerpt: this.excerpt(rawBody),
      });
    }

    try {
      const parsed = schema.parse(data);
      this.logger.log(`QPay POST ${path} → ${response.status} (${durationMs}ms)`);
      return parsed;
    } catch (cause) {
      throw new QpayError(
        "invalid_response",
        `QPay response did not match the expected shape: ${this.redact(
          cause instanceof Error ? cause.message : "unknown",
        )}`,
        { status: response.status, path, durationMs, bodyExcerpt: this.excerpt(rawBody) },
      );
    }
  }

  /**
   * Removes the password and the current bearer token from a string.
   *
   * ★ The backstop behind every other habit in this class — see
   * `EsisClient.redact`'s own comment for why short values are excluded (a
   * global replace of `""` would corrupt every message on an unconfigured
   * instance) and why the literal is escaped implicitly by `split().join()`
   * rather than a regex (a token or password may contain regex
   * metacharacters).
   */
  private redact(text: string): string {
    let result = text;
    const password = this.config.password;
    if (password && password.length >= 8) result = result.split(password).join("[REDACTED]");
    if (this.cachedToken) result = result.split(this.cachedToken.accessToken).join("[REDACTED]");
    return result;
  }

  private excerpt(body: string): string {
    const redacted = this.redact(body);
    return redacted.length > BODY_EXCERPT_LIMIT
      ? `${redacted.slice(0, BODY_EXCERPT_LIMIT)}…`
      : redacted;
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

  private logFailure(path: string, kind: QpayErrorKind, durationMs: number, status?: number): void {
    this.logger.warn(`QPay POST ${path} failed (${kind}${status ? ` ${status}` : ""}) after ${durationMs}ms`);
  }
}
