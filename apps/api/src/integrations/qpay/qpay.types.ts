/**
 * Transport and domain types for the QPay boundary.
 *
 * ★ Unlike `esis.types.ts`, this file **does** carry domain shapes — because
 * unlike ESIS, we have QPay's documentation and a real merchant account. The
 * reasoning is the same in both cases: describe exactly what is known and
 * nothing more. Inventing `EsisChild` would have been a guess; declaring
 * `QpayInvoiceResponse` is transcription.
 *
 * ★★ These are QPay's field names, in QPay's snake_case. They stop here:
 * `qpay.service.ts` returns our own shapes, so a rename on their side is a
 * one-file change (CLAUDE.md §2.1's boundary argument).
 */

export type QpayMethod = "GET" | "POST" | "DELETE";

export interface QpayRequest {
  /** Path relative to `QPAY_BASE_URL`, e.g. `/invoice`. */
  path: string;
  method?: QpayMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
  parse?: (body: unknown) => unknown;
  /**
   * Whether to attach the bearer token.
   *
   * ★ `false` for `/auth/token` itself, which authenticates with HTTP Basic
   * instead. Without this flag the client would try to fetch a token in order
   * to fetch a token.
   */
  authenticated?: boolean;
}

export interface QpayResponse<T> {
  data: T;
  status: number;
  durationMs: number;
}

/**
 * Why a QPay call could not be made or did not succeed.
 *
 * Mirrors `EsisErrorKind` deliberately — one error type per integration, one
 * catch per caller, `kind` distinguishing what needs different handling. A
 * timeout is worth retrying; a 401 means our credentials are wrong and an
 * operator must know; `invalid_response` means their contract moved.
 */
export type QpayErrorKind =
  | "not_configured"
  | "network"
  | "timeout"
  | "http"
  | "invalid_response"
  /** `/auth/token` itself failed — no call could be authenticated. */
  | "auth";

/**
 * What QPay returns when an invoice is created.
 *
 * `qr_text` and `qr_image` render the code; `urls` are the bank deeplinks a
 * parent taps on a phone. `invoice_id` is the handle every later call uses.
 */
export interface QpayInvoiceResponse {
  invoice_id: string;
  qr_text: string;
  qr_image: string;
  urls: { name: string; description: string; link: string }[];
}

/** One payment as QPay reports it, in a check or a callback lookup. */
export interface QpayPaymentRow {
  payment_id: string;
  payment_status: string;
  payment_amount: string;
  payment_currency?: string;
  payment_wallet?: string;
  payment_date?: string;
}

/** The body of `POST /payment/check`. */
export interface QpayPaymentCheckResponse {
  count: number;
  paid_amount: number;
  rows: QpayPaymentRow[];
}
