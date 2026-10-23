import { z } from "zod";

/** «Төлбөр шалгах» — `GET /platform/qpay/invoices`. */
export const listOperatorQpayQuerySchema = z.object({
  /** The receipt's «Дугаар» (hex) or the payer's phone. */
  q: z.string().trim().max(32).optional(),
  status: z.enum(["PENDING", "PAID", "EXPIRED", "CANCELLED", "NEEDS_REVIEW"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListOperatorQpayQuery = z.infer<typeof listOperatorQpayQuerySchema>;
