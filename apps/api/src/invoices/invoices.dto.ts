import { z } from "zod";
import { uuidSchema } from "@kinder/contracts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, "Сар YYYY-MM хэлбэртэй байна");

/**
 * Money, as a string on the wire — the same decision as `funding.dto.ts`.
 *
 * ★ Not `z.number()`. A JSON number is an IEEE 754 double, and an amount that
 * has to reconcile against a bank statement cannot pass through one. The string
 * goes to Prisma verbatim and lands in `DECIMAL(12,2)` unchanged.
 */
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Дүн 1234.56 хэлбэртэй байна");

export const invoiceItemKindSchema = z.enum(["TUITION", "MEAL", "CLUB", "BUS", "EXTRA", "OTHER"]);

export const invoiceStatusSchema = z.enum([
  "UNPAID",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "REFUNDED",
]);

export const paymentMethodSchema = z.enum(["QPAY", "SOCIALPAY", "BANK_TRANSFER", "CASH", "OTHER"]);

/**
 * Generating a month's invoices for a whole kindergarten — `нэмэлт.md` §7.
 *
 * ★ `childIds` is optional, and its absence means "every enrolled child".
 * Re-running for one child after fixing their attendance must not require
 * voiding the other two hundred invoices.
 */
export const generateInvoicesSchema = z
  .object({
    month: isoMonth,
    childIds: z.array(uuidSchema).max(500).optional(),
    dueDate: isoDate.nullable().optional(),
  })
  .strict();

export type GenerateInvoicesDto = z.infer<typeof generateInvoicesSchema>;

/**
 * One invoice, typed in by hand — the case a generated one cannot cover.
 *
 * A child who joined mid-month on terms nobody has written a tariff for still
 * has to be billed, and refusing that would push the kindergarten back to a
 * spreadsheet for exactly the awkward cases.
 */
export const createInvoiceSchema = z
  .object({
    childId: uuidSchema,
    month: isoMonth,
    dueDate: isoDate.nullable().optional(),
    discountAmount: money.optional(),
    note: z.string().max(2000).nullable().optional(),
    lines: z
      .array(
        z
          .object({
            kind: invoiceItemKindSchema,
            label: z.string().trim().min(1, "Нэрийг оруулна уу").max(200),
            quantity: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, "Тоо хэмжээ буруу байна"),
            unitAmount: money,
            note: z.string().max(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1, "Дор хаяж нэг мөр оруулна уу")
      .max(50),
  })
  .strict();

export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;

/**
 * Editing a draft — `нэмэлт.md` §7.
 *
 * ★ Deliberately cannot change `childId`, `month` or the amounts. The lines are
 * the amounts; letting a caller set `totalAmount` directly would let an invoice
 * disagree with the charges that justify it, which is the one property
 * `invoice-math.ts` exists to guarantee.
 */
export const updateInvoiceSchema = z
  .object({
    dueDate: isoDate.nullable().optional(),
    discountAmount: money.optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict();

export type UpdateInvoiceDto = z.infer<typeof updateInvoiceSchema>;

/** Recording money that arrived outside a payment provider — §8. */
export const recordPaymentSchema = z
  .object({
    amount: money,
    method: paymentMethodSchema,
    paidAt: isoDate.optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();

export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;

/**
 * Reversing a confirmed payment — `нэмэлт.md` §14.
 *
 * ★ A reason is **required**, unlike almost every other note in the system.
 * §14 asks that a confirmed transaction is corrected rather than deleted, and a
 * correction whose reason is blank is indistinguishable from a mistake six
 * months later — which is precisely when somebody asks why the money moved.
 */
export const reversePaymentSchema = z
  .object({
    reason: z.string().trim().min(1, "Шалтгааныг заавал бичнэ").max(500),
  })
  .strict();

export type ReversePaymentDto = z.infer<typeof reversePaymentSchema>;

/**
 * Listing a month's invoices.
 *
 * `status` arrives comma-separated for the same reason `funding.dto.ts`
 * documents: Express's query parser turns one repeated key into a string and
 * two into an array, so a filter for a single status would arrive in a
 * different shape than a filter for two.
 */
export const listInvoicesSchema = z
  .object({
    month: isoMonth.optional(),
    childId: uuidSchema.optional(),
    status: z
      .string()
      .optional()
      .transform((value) => (value ? value.split(",").filter(Boolean) : undefined))
      .pipe(z.array(invoiceStatusSchema).max(5).optional()),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListInvoicesQuery = z.infer<typeof listInvoicesSchema>;

/** The month a financial dashboard reports on — `нэмэлт.md` §9. */
export const financeDashboardQuerySchema = z.object({ month: isoMonth }).strict();

export type FinanceDashboardQuery = z.infer<typeof financeDashboardQuerySchema>;

/**
 * Which report, and over what period — `нэмэлт.md` §16.
 *
 * ★ `period` is a plain string rather than `isoMonth`, because two of the
 * reports are not monthly: `annual` takes a school year (`2025-2026`) and
 * `unpaid` ignores the period entirely. The service validates the shape each
 * report actually needs, which is the only place that knows.
 */
export const financeReportQuerySchema = z
  .object({
    report: z.enum([
      "state-funding",
      "child-funding",
      "meal-days",
      "meal-cost",
      "parent-payments",
      "unpaid",
      "variance",
      "annual",
    ]),
    period: z.string().min(4).max(9),
  })
  .strict();

export type FinanceReportQuery = z.infer<typeof financeReportQuerySchema>;
