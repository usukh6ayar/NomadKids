import { z } from "zod";
import { uuidSchema } from "@kinder/contracts";

/**
 * ★ `audience` is NOT accepted from the client.
 *
 * It is derived server-side from the requester's relationship to the child and
 * written onto the job — see `report-params.ts`. A client-supplied audience
 * would let a guardian ask for the staff copy, which is the whole leak the
 * field exists to close.
 */
export const createReportSchema = z
  .object({
    childId: uuidSchema,
    type: z.enum(["CHILD_PORTFOLIO", "TERM_REPORT", "ANNUAL_REPORT"]),
    termId: uuidSchema.optional(),
    /** RFP §6.5 — which year's four terms to compare. */
    schoolYearId: uuidSchema.optional(),
  })
  .strict()
  .refine((v) => v.type !== "TERM_REPORT" || Boolean(v.termId), {
    message: "Улирлын тайланд улирал сонгоно уу",
    path: ["termId"],
  })
  .refine((v) => v.type !== "ANNUAL_REPORT" || Boolean(v.schoolYearId), {
    message: "Жилийн тайланд хичээлийн жил сонгоно уу",
    path: ["schoolYearId"],
  });
export type CreateReportDto = z.infer<typeof createReportSchema>;
