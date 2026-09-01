import { z } from "zod";

/**
 * Response shapes for QPay's v2 "Simple" merchant API.
 *
 * ★ Unlike `esis.types.ts`, this file DOES carry domain knowledge of the
 * remote contract. ESIS's shape is unknown until the ministry answers
 * `docs/ESIS_REQUEST.md`; QPay's v2 API is public
 * (developer.qpay.mn/#/reference), and `docs/reference/QPAY_INTEGRATION.md`
 * records exactly what is assumed here and why.
 *
 * ★★ Every schema uses `.passthrough()` and validates only the fields this
 * codebase actually reads. QPay adding a field breaks nothing; QPay renaming
 * or dropping one of the fields below fails loudly at the boundary — as a
 * `QpayError("invalid_response", …)` — rather than silently, three layers
 * into `QpayService`, as a wrong amount credited to the wrong invoice.
 */

export const qpayTokenResponseSchema = z
  .object({
    token_type: z.string(),
    access_token: z.string(),
    refresh_token: z.string(),
    /** Seconds. */
    expires_in: z.number(),
  })
  .passthrough();
export type QpayTokenResponse = z.infer<typeof qpayTokenResponseSchema>;

export const qpayCreateInvoiceResponseSchema = z
  .object({
    invoice_id: z.string(),
    qr_text: z.string().optional(),
    /** Base64 PNG, no data: prefix. */
    qr_image: z.string().optional(),
    /** Deep links into banking apps that can pay this invoice directly. */
    urls: z
      .array(
        z
          .object({
            name: z.string().optional(),
            description: z.string().optional(),
            logo: z.string().optional(),
            link: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
export type QpayCreateInvoiceResponse = z.infer<typeof qpayCreateInvoiceResponseSchema>;

const qpayPaymentRowSchema = z
  .object({
    payment_id: z.string(),
    /** `"PAID"` is the only value this codebase treats as a completed payment. */
    payment_status: z.string(),
    payment_amount: z.union([z.string(), z.number()]),
  })
  .passthrough();

export const qpayCheckPaymentResponseSchema = z
  .object({
    count: z.number(),
    rows: z.array(qpayPaymentRowSchema).default([]),
  })
  .passthrough();
export type QpayCheckPaymentResponse = z.infer<typeof qpayCheckPaymentResponseSchema>;

/** Why a QPay call could not be made or did not succeed — one type, one catch. */
export type QpayErrorKind =
  /** Config missing — no call was attempted. */
  | "not_configured"
  /** The request never completed: DNS, TLS, connection reset. */
  | "network"
  /** Abandoned at the timeout. */
  | "timeout"
  /** QPay answered with a non-2xx status. */
  | "http"
  /** QPay answered 2xx with a body that did not match the expected shape. */
  | "invalid_response";
