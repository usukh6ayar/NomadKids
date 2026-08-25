import { z } from "zod";
import { uuidSchema } from "@kinder/contracts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, "Сар YYYY-MM хэлбэртэй байна");

export const fundingSourceSchema = z.enum(["STATE", "PARENT", "KINDERGARTEN", "OTHER"]);

/**
 * Money, as a string on the wire.
 *
 * ★ Not `z.number()`. JSON numbers are IEEE 754 doubles, and a tariff typed as
 * 1234.56 by an administrator has to survive the round trip to a
 * `DECIMAL(12,2)` unchanged — this is the figure a bank statement is
 * reconciled against. A decimal string is passed to Prisma verbatim.
 */
const money = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Дүн 1234.56 хэлбэртэй байна")
  .nullable()
  .optional();

export const createFundingRuleSchema = z
  .object({
    name: z.string().trim().min(1, "Дүрмийн нэрийг оруулна уу").max(200),
    source: fundingSourceSchema,
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional(),
    ageBand: z.enum(["NURSERY", "JUNIOR", "MIDDLE", "SENIOR"]).nullable().optional(),
    dailyRate: money,
    monthlyRate: money,
    dependsOnAttendance: z.boolean().default(true),
    dependsOnMeals: z.boolean().default(false),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((v) => !v.effectiveTo || v.effectiveFrom <= v.effectiveTo, {
    message: "Дуусах огноо эхлэх огнооноос өмнө байна",
    path: ["effectiveTo"],
  })
  .refine(
    (v) =>
      // A rule that depends on nothing needs a monthly rate; one that depends
      // on a counter needs a daily one. Neither is a rule that computes zero
      // for every child and looks configured.
      (!v.dependsOnAttendance && !v.dependsOnMeals ? v.monthlyRate : v.dailyRate) != null,
    {
      message: "Ирц/хоолноос хамаарах дүрэмд өдрийн тариф, бусад тохиолдолд сарын тариф хэрэгтэй",
      path: ["dailyRate"],
    },
  );
export type CreateFundingRuleDto = z.infer<typeof createFundingRuleSchema>;

/**
 * Closing a rule rather than editing its rate — нэмэлт.md §5.
 *
 * ★ Only `effectiveTo`, `name` and `note` may change.
 *
 * A month's calculation is evidence of the rate it was billed under, and
 * editing that rate rewrites the past. A new tariff is a new rule starting the
 * day the old one ends, which is why this DTO cannot express a rate change.
 */
export const updateFundingRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    effectiveTo: isoDate.nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdateFundingRuleDto = z.infer<typeof updateFundingRuleSchema>;

export const calculateMonthSchema = z
  .object({ month: isoMonth, source: fundingSourceSchema })
  .strict();
export type CalculateMonthDto = z.infer<typeof calculateMonthSchema>;

export const listFundingQuerySchema = z.object({
  month: isoMonth,
  source: fundingSourceSchema.optional(),
});
export type ListFundingQuery = z.infer<typeof listFundingQuerySchema>;

/** Recording what was approved and what actually arrived — §6. */
export const settleFundingSchema = z
  .object({
    approvedAmount: money,
    receivedAmount: money,
    note: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type SettleFundingDto = z.infer<typeof settleFundingSchema>;

export { uuidSchema };
