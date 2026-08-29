/**
 * Transport types for the ESIS boundary.
 *
 * ★ There is deliberately **no domain type in this file** — no child, no
 * institution, no enrolment shape.
 *
 * We have not seen ESIS's API documentation. Writing `EsisChild` now would be
 * inventing a schema, and an invented schema is worse than none: it gets
 * imported, screens get built against it, and the day the real contract arrives
 * the cost of being wrong is spread across the codebase instead of contained
 * here. Everything below describes the *envelope* — how a request is made and
 * how a failure is reported — which is knowable without their documentation.
 *
 * When the real endpoints are published, domain schemas belong beside this file
 * as `esis.schemas.ts`, declared with Zod and validated at the boundary, so an
 * unexpected payload fails here rather than three layers inside the app.
 */

/** The methods the client supports. Extend when a real endpoint needs more. */
export type EsisMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface EsisRequest {
  /** Path relative to `ESIS_BASE_URL`, e.g. `/v1/institutions/123`. */
  path: string;
  method?: EsisMethod;
  /** Serialised as JSON. Omit for GET. */
  body?: unknown;
  /** Appended as a query string; `undefined` values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Overrides `ESIS_TIMEOUT_MS` for one call. */
  timeoutMs?: number;
  /**
   * Validates and narrows the response body.
   *
   * ★ Optional, and typed as a plain function rather than a Zod schema so this
   * file stays free of domain knowledge. Pass `schema.parse` once the real
   * contract exists. Without it the caller gets `unknown` and must narrow it
   * themselves — which is the honest default while the contract is unknown.
   */
  parse?: (body: unknown) => unknown;
}

/** A successful ESIS response, with the envelope a caller may need. */
export interface EsisResponse<T> {
  data: T;
  status: number;
  /**
   * Milliseconds the call took. Useful in a log line; carries no secret.
   */
  durationMs: number;
}

/**
 * Why an ESIS call could not be made or did not succeed.
 *
 * ★ One error type for every failure mode, so a caller writes one catch.
 *
 * `kind` distinguishes the cases that need different handling — a timeout is
 * worth retrying, a 401 is worth alerting an operator about, and a validation
 * failure means their contract changed. Without it every caller would be
 * parsing error messages, which is how retry logic ends up keyed on English
 * prose.
 */
export type EsisErrorKind =
  /** Config missing — no call was attempted. */
  | "not_configured"
  /** The request never completed: DNS, TLS, connection reset. */
  | "network"
  /** Abandoned at the timeout. */
  | "timeout"
  /** ESIS answered with a non-2xx status. */
  | "http"
  /** ESIS answered 2xx with a body we could not read or validate. */
  | "invalid_response";
