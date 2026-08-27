import { Injectable, Logger } from "@nestjs/common";
import { EsisConfig } from "./esis.config";
import type { EsisErrorKind, EsisRequest, EsisResponse } from "./esis.types";

/**
 * Every ESIS failure, as one type.
 *
 * ★ Not an `HttpException`. This is an *outbound* failure, and letting it
 * escape as a Nest exception would forward the ministry's status code to our
 * own caller — a 401 from ESIS would tell a logged-in administrator that
 * *their* session was rejected. A caller decides what a user sees; this only
 * says what happened.
 *
 * ★★ `message` and `bodyExcerpt` are both redacted before they are stored, so
 * an error that escapes into a log, a Sentry event or an HTTP response cannot
 * carry the token — see `EsisClient.redact`.
 */
export class EsisError extends Error {
  constructor(
    readonly kind: EsisErrorKind,
    message: string,
    readonly detail: {
      /** HTTP status, when there was a response. */
      status?: number;
      /** Path only — never the full URL, which could carry a query secret. */
      path?: string;
      durationMs?: number;
      /** A short, redacted slice of the response body, for diagnosis. */
      bodyExcerpt?: string;
    } = {},
  ) {
    super(message);
    this.name = "EsisError";
  }
}

/** How much of a failing response body is worth keeping. */
const BODY_EXCERPT_LIMIT = 500;

/**
 * The HTTP client for ESIS.
 *
 * ★ This class is the **only** place the token is read, and it puts it in
 * exactly one place: the `Authorization` header of an outbound request.
 *
 * Three habits keep it there, and they are defence in depth rather than
 * alternatives:
 *
 *   1. The token never enters a URL or a query string. Query secrets end up in
 *      access logs, proxy logs and browser histories, none of which we control.
 *   2. Request headers are never logged. Not at debug level, not on failure.
 *   3. `redact()` scrubs the token from every string that leaves this class —
 *      messages, body excerpts, thrown errors. Habits 1 and 2 should make this
 *      unreachable; it exists because "should" is not a guarantee, and because
 *      an upstream service that echoes a header back is not hypothetical.
 *
 * ★★ `fetch` is Node's own — no HTTP dependency added. The runtime image is
 * `node:22-slim`, where `fetch` and `AbortSignal.timeout` are both stable.
 */
@Injectable()
export class EsisClient {
  private readonly logger = new Logger(EsisClient.name);

  constructor(private readonly config: EsisConfig) {}

  /**
   * Makes one ESIS request.
   *
   * Returns the parsed body, or throws `EsisError`. There is no retry: a retry
   * policy depends on which endpoint is being called and whether it is
   * idempotent, and inventing one before we have seen a single real endpoint
   * would be guessing at the ministry's rate limits.
   */
  async request<T = unknown>(options: EsisRequest): Promise<EsisResponse<T>> {
    if (!this.config.isConfigured) {
      /*
       * ★ Fails before any network work, and names only which variables are
       * absent — never the values of the ones that are present.
       */
      throw new EsisError(
        "not_configured",
        `ESIS is not configured — set ${this.missingSettings().join(", ")}`,
        { path: options.path },
      );
    }

    const url = this.buildUrl(options.path, options.query);
    const method = options.method ?? "GET";
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          // The one place the token is used.
          Authorization: `Bearer ${this.config.token}`,
          Accept: "application/json",
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs ?? this.config.timeoutMs),
      });
    } catch (cause) {
      const durationMs = Date.now() - startedAt;
      // `AbortSignal.timeout` rejects with a TimeoutError; everything else here
      // is a connection-level fault. They are separated because only one of
      // them is worth retrying.
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";

      this.logFailure(method, options.path, timedOut ? "timeout" : "network", durationMs);

      throw new EsisError(
        timedOut ? "timeout" : "network",
        timedOut
          ? `ESIS request timed out after ${options.timeoutMs ?? this.config.timeoutMs}ms`
          : `ESIS request failed: ${this.redact(cause instanceof Error ? cause.message : "unknown")}`,
        { path: options.path, durationMs },
      );
    }

    const durationMs = Date.now() - startedAt;
    const rawBody = await response.text().catch(() => "");

    if (!response.ok) {
      this.logFailure(method, options.path, "http", durationMs, response.status);

      throw new EsisError("http", `ESIS responded ${response.status}`, {
        status: response.status,
        path: options.path,
        durationMs,
        bodyExcerpt: this.excerpt(rawBody),
      });
    }

    let data: unknown;
    try {
      // An empty 204 is a success with nothing to parse.
      data = rawBody === "" ? null : JSON.parse(rawBody);
    } catch {
      throw new EsisError("invalid_response", "ESIS returned a body that is not JSON", {
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
        /*
         * Their contract changed, or we read it wrong. Distinguished from
         * `http` because it needs a developer, not an operator: no amount of
         * retrying fixes a payload that no longer matches.
         */
        throw new EsisError(
          "invalid_response",
          `ESIS response did not match the expected shape: ${this.redact(
            cause instanceof Error ? cause.message : "unknown",
          )}`,
          { status: response.status, path: options.path, durationMs },
        );
      }
    }

    this.logger.log(`ESIS ${method} ${options.path} → ${response.status} (${durationMs}ms)`);

    return { data: data as T, status: response.status, durationMs };
  }

  /**
   * Removes the token from a string.
   *
   * ★ The backstop behind every other habit in this class.
   *
   * Guards against `''` and short values explicitly: a global replace of the
   * empty string inserts the placeholder between every character, which would
   * corrupt every message on an unconfigured instance. The literal is escaped
   * because a token may contain regex metacharacters — `+` and `/` are both in
   * base64's alphabet, and an unescaped `+` would silently fail to match.
   */
  private redact(text: string): string {
    const token = this.config.token;
    if (!token || token.length < 8) return text;

    return text.split(token).join("[REDACTED]");
  }

  /** A bounded, redacted slice of a response body. */
  private excerpt(body: string): string {
    const redacted = this.redact(body);
    return redacted.length > BODY_EXCERPT_LIMIT
      ? `${redacted.slice(0, BODY_EXCERPT_LIMIT)}…`
      : redacted;
  }

  /**
   * Builds the target URL.
   *
   * `URL` rather than string concatenation so a path with or without a leading
   * slash behaves the same, and so query values are encoded rather than
   * trusted. `undefined` values are dropped instead of becoming the string
   * "undefined" in a query.
   */
  private buildUrl(path: string, query?: EsisRequest["query"]): string {
    const url = new URL(`${this.config.baseUrl}/${path.replace(/^\/+/, "")}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  /** Which settings are absent. Names only — a value here could be the token. */
  private missingSettings(): string[] {
    const missing: string[] = [];
    if (!this.config.baseUrl) missing.push("ESIS_BASE_URL");
    if (!this.config.token) missing.push("ESIS_TOKEN");
    if (!this.config.institutionId) missing.push("ESIS_INSTITUTION_ID");

    return missing;
  }

  /**
   * One log line per failure.
   *
   * ★ Path, not URL; status, not body; and never the headers. The path is
   * chosen by us and carries no secret, whereas the full URL would carry any
   * query parameter a future caller adds — including one that should not be
   * there.
   */
  private logFailure(
    method: string,
    path: string,
    kind: EsisErrorKind,
    durationMs: number,
    status?: number,
  ): void {
    this.logger.warn(
      `ESIS ${method} ${path} failed (${kind}${status ? ` ${status}` : ""}) after ${durationMs}ms`,
    );
  }
}
