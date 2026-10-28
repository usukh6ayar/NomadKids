import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");

/** Money as a string — never a JSON number for a sum someone is held to (§2.2). */
const money = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Дүн буруу байна")
  .refine((value) => Number(value) > 0, "Дүн 0-ээс их байна");

/** ebarimt's own receipt number — kept as typed, never checked against ebarimt. */
const ebarimtNumber = z.string().trim().min(1).max(64);

export const listContractPaymentsQuerySchema = z.object({
  status: z.enum(["PENDING", "PAID"]).optional(),
  /** Paid periods with no e-receipt number yet — what is left to issue on ebarimt. */
  ebarimt: z.literal("missing").optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListContractPaymentsQuery = z.infer<typeof listContractPaymentsQuerySchema>;

/**
 * A bank transfer the operator saw on the statement — the client, 2026-10-18:
 * state kindergartens pay against an invoice.
 */
export const recordTransferSchema = z
  .object({
    /** What arrived — the row's figure unless the statement says otherwise. */
    amount: money,
    paidOn: isoDate,
    reference: z.string().trim().max(200).optional(),
    ebarimtNumber: ebarimtNumber.optional(),
  })
  .strict();
export type RecordTransferDto = z.infer<typeof recordTransferSchema>;

export const setEbarimtSchema = z.object({ ebarimtNumber: ebarimtNumber.nullable() }).strict();
export type SetEbarimtDto = z.infer<typeof setEbarimtSchema>;

/** «Эрх сунгах»: what the operator is about to record for one kindergarten. */
export const extensionQuerySchema = z
  .object({
    kindergartenId: z.string().uuid(),
    groups: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();
export type ExtensionQuery = z.infer<typeof extensionQuerySchema>;

/**
 * A transfer recorded from the kindergarten itself — the user, 2026-10-28:
 * some pay by bank transfer without ever opening «Үйлчилгээний эрх», and the
 * operator enters the payment, a note and the date the service runs to.
 * `coversTo` comes suggested (the term's or the year's end) and may be moved.
 */
export const recordExtensionSchema = z
  .object({
    kindergartenId: z.string().uuid(),
    period: z.enum(["TERM", "YEAR"]),
    groupCount: z.number().int().min(1).max(500),
    amount: money,
    paidOn: isoDate,
    coversTo: isoDate,
    note: z.string().trim().max(1000).optional(),
    reference: z.string().trim().max(200).optional(),
    ebarimtNumber: ebarimtNumber.optional(),
  })
  .strict();
export type RecordExtensionDto = z.infer<typeof recordExtensionSchema>;
