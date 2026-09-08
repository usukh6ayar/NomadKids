/**
 * Transport types for the ESIS boundary.
 *
 * Domain schemas live in `esis.schemas.ts`; this file only describes transport.
 */

/** The methods the client supports. Extend when a real endpoint needs more. */
export type EsisMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface EsisRequest {
  /** Path relative to `ESIS_BASE_URL`, e.g. `/svc/api/hub/v2/group/list`. */
  path: string;
  method?: EsisMethod;
  /** Serialised as JSON. Omit for GET. */
  body?: unknown;
  /** Appended as a query string; `undefined` values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Overrides `ESIS_TIMEOUT_MS` for one call. */
  timeoutMs?: number;
  /** Deterministic fixture selected when `ESIS_DEMO_MODE=true`. */
  demoFixture?: import("./esis.samples").EsisEndpointKey;
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
  /** Makes mock and live data impossible to confuse above the transport layer. */
  source: "MOCK" | "LIVE";
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
