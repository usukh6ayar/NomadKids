import { z } from "zod";

/**
 * QPay's payloads, validated at the boundary.
 *
 * ★ These are the **only** place QPay's field names appear outside
 * `qpay.client.ts`. `qpay.service.ts` maps them to our own shapes immediately,
 * so a rename on their side is a one-file change — the plan `esis.service.ts`
 * writes down for its own first real endpoint, applied here.
 *
 * ★★ Money arrives from QPay as a **string** in some fields and a number in
 * others, and this file does not normalise that away silently: each schema
 * says which it expects, and the service converts once, deliberately. Coercing
 * `"12500.00"` through `z.number()` would put a float between the provider and
 * our ledger, which is the one thing the invoice module is built to avoid.
 */

/**
 * `POST /invoice` — what QPay returns when an invoice is created.
 *
 * `.passthrough()` on purpose: QPay adds fields over time, and rejecting a
 * response for carrying something new would break payment collection for a
 * change that does not affect us. We validate what we read and ignore the rest.
 */
export const qpayInvoiceResponseSchema = z
  .object({
    invoice_id: z.string().min(1),
    qr_text: z.string().min(1),
    qr_image: z.string().min(1),
    urls: z
      .array(
        z
          .object({
            name: z.string(),
            description: z.string(),
            link: z.string(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export type QpayInvoiceResponse = z.infer<typeof qpayInvoiceResponseSchema>;

/** One payment row, as `POST /payment/check` reports it. */
export const qpayPaymentRowSchema = z
  .object({
    payment_id: z.string().min(1),
    /** `PAID`, `NEW`, `FAILED`, `REFUNDED` — compared case-insensitively. */
    payment_status: z.string().min(1),
    /**
     * A decimal **string**. Kept as one all the way to `Decimal` — see the
     * note at the top of this file.
     */
    payment_amount: z.union([z.string(), z.number()]).transform((v) => String(v)),
    payment_currency: z.string().optional(),
    payment_wallet: z.string().optional(),
    payment_date: z.string().optional(),
    /**
     * The QPay invoice this payment settles.
     *
     * ★ How a confirmation finds its pending row. QPay has used both
     * `object_id` and `invoice_id` for this depending on the enquiry, so both
     * are read and the service takes whichever is present — a payment we
     * cannot match to an invoice is one an accountant reconciles by hand.
     */
    object_id: z.string().optional(),
    invoice_id: z.string().optional(),
  })
  .passthrough();

export type QpayPaymentRow = z.infer<typeof qpayPaymentRowSchema>;

/**
 * `POST /payment/check` — the verification step.
 *
 * ★ This is the response the whole callback design rests on. QPay's note is
 * explicit that a callback must be **verified**, not believed:
 *
 * > "Төлбөр амжилттай төлөгдсөн мэдээллийг callback URL-аар хүлээн авсны дараа
 * > шалгаж баталгаажуулна уу"
 *
 * The callback carries an id; this carries the truth.
 */
export const qpayPaymentCheckResponseSchema = z
  .object({
    count: z.number().int().nonnegative().default(0),
    paid_amount: z.union([z.string(), z.number()]).transform((v) => String(v)),
    rows: z.array(qpayPaymentRowSchema).default([]),
  })
  .passthrough();

export type QpayPaymentCheckResponse = z.infer<typeof qpayPaymentCheckResponseSchema>;

/**
 * The callback body QPay posts to `QPAY_CALLBACK_URL`.
 *
 * ★ Deliberately minimal, and **nothing in it is trusted**. QPay documents
 * `qpay_payment_id` as a query parameter; deployments have also been seen
 * posting a JSON body. Both are accepted, and either way the only field used
 * is the id — which is then handed to `/payment/check`. Any amount or status in
 * this payload is ignored, because the endpoint is public and an attacker can
 * post whatever they like to it.
 */
export const qpayCallbackSchema = z
  .object({
    qpay_payment_id: z.string().min(1).optional(),
    payment_id: z.string().min(1).optional(),
    object_id: z.string().min(1).optional(),
  })
  .passthrough()
  .refine((v) => Boolean(v.qpay_payment_id ?? v.payment_id), {
    message: "qpay_payment_id is required",
  });

export type QpayCallbackBody = z.infer<typeof qpayCallbackSchema>;

/** QPay's payment statuses that mean money actually moved. */
export function isPaidStatus(status: string): boolean {
  return status.toUpperCase() === "PAID";
}
