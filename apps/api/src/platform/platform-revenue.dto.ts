import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, "Сар YYYY-MM хэлбэртэй байна");

export const revenueMonthQuerySchema = z.object({ month: isoMonth });
export type RevenueMonthQuery = z.infer<typeof revenueMonthQuerySchema>;

/**
 * A percentage, as a string.
 *
 * ★ Not `z.number()`, for the reason `funding.dto.ts` gives about money: a JSON
 * number is an IEEE 754 double, and 12.5 typed by an operator has to reach a
 * `DECIMAL(5,2)` unchanged. The pattern also caps it at 100 before Prisma sees
 * it, so an out-of-range share is a readable 400 rather than a numeric overflow
 * from the driver.
 */
const percent = z
  .string()
  .regex(/^(100(\.00?)?|\d{1,2}(\.\d{1,2})?)$/, "Хувь 0–100 хооронд, 12.5 хэлбэртэй байна");

export const createPartnerSchema = z
  .object({
    name: z.string().trim().min(1, "Нэрийг оруулна уу").max(200),
    sharePercent: percent,
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((v) => !v.effectiveTo || v.effectiveFrom <= v.effectiveTo, {
    message: "Дуусах огноо эхлэх огнооноос өмнө байна",
    path: ["effectiveTo"],
  })
  .refine((v) => Number(v.sharePercent) > 0, {
    message: "Хувь 0-ээс их байна",
    path: ["sharePercent"],
  });
export type CreatePartnerDto = z.infer<typeof createPartnerSchema>;

/**
 * ★ No `sharePercent`. The percentage cannot be edited — see the model's own
 * note and `PlatformRevenueService.updatePartner`: a month's distribution is
 * evidence of the split it was paid under. Closing this agreement and opening
 * a new one is how a share changes.
 */
export const updatePartnerSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    effectiveTo: isoDate.nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdatePartnerDto = z.infer<typeof updatePartnerSchema>;
