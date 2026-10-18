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
