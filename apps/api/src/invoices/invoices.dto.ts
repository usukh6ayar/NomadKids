import { z } from "zod";
import { uuidSchema } from "@kinder/contracts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, "Сар YYYY-MM хэлбэртэй байна");

/**
 * Money, as a string on the wire — the exact convention `funding.dto.ts`
 * establishes, repeated rather than imported so this module has no compile
 * dependency on `funding/`. Not `z.number()`: JSON numbers are IEEE 754
 * doubles, and every amount here is reconciled against a bank statement.
 */
const money = z.string().regex(/^-?\d{1,10}(\.\d{1,2})?$/, "Дүн 1234.56 хэлбэртэй байна");

const invoiceLineTypeSchema = z.enum(["TUITION", "MEAL", "CLUB", "BUS", "EXTRA", "OTHER"]);

/** One charge — нэмэлт.md §7's six types, entered per invoice rather than assumed. */
const invoiceLineInputSchema = z.object({
  type: invoiceLineTypeSchema,
  description: z.string().trim().max(200).nullable().optional(),
  /** Positive only — a discount is its own field, not a negative line. */
  amount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Дүн 1234.56 хэлбэртэй байна"),
});

/**
 * Generating a month's invoice for one child — нэмэлт.md §7.
 *
 * ★ `lineItems` is supplied by the caller, not invented here.
 *
 * Unlike `FundingCalculation`, which computes its amount from attendance and
 * a configured rate with no human in the loop, an invoice's tuition/meal/club/
 * bus/extra charges are the kindergarten's own price list — nothing in this
 * codebase's schema says what a term costs. `InvoicesService.generate` still
 * enforces the single-entry principle where it can: `previousBalance` is read
 * from the child's own prior invoice, never re-entered.
 */
export const generateInvoiceSchema = z
  .object({
    childId: uuidSchema,
    month: isoMonth,
    dueDate: isoDate,
    lineItems: z.array(invoiceLineInputSchema).min(1, "Дор хаяж нэг мөр оруулна уу"),
    discountAmount: money.optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type GenerateInvoiceDto = z.infer<typeof generateInvoiceSchema>;

export const listInvoicesQuerySchema = z.object({
  month: isoMonth.optional(),
  childId: uuidSchema.optional(),
  status: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE", "REFUNDED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

/** Correcting an unpaid invoice's note or due date — never its charges once issued. */
export const updateInvoiceSchema = z
  .object({
    dueDate: isoDate.optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdateInvoiceDto = z.infer<typeof updateInvoiceSchema>;

/**
 * Recording a manual payment — нэмэлт.md §7, and the non-gateway half of §8
 * ("Банкны төлбөр" and cash in person).
 *
 * ★ `QPAY`/`SOCIALPAY` are deliberately not accepted here.
 *
 * Those two only mean something once a real gateway calls back with its own
 * transaction reference; a person typing "QPay" into this form would be
 * asserting a payment happened that nothing has actually verified. The schema
 * carries all five values (`Payment.method` in schema.prisma) so a future
 * webhook handler needs no migration — this endpoint just doesn't offer them.
 */
export const recordPaymentSchema = z
  .object({
    amount: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, "Дүн 1234.56 хэлбэртэй байна")
      .refine((v) => Number(v) > 0, "Дүн 0-ээс их байна"),
    method: z.enum(["CASH", "BANK_TRANSFER", "OTHER"]),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;

export const voidPaymentSchema = z
  .object({
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type VoidPaymentDto = z.infer<typeof voidPaymentSchema>;

export const markRefundedSchema = z
  .object({
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type MarkRefundedDto = z.infer<typeof markRefundedSchema>;

/**
 * A whole month's invoices, generated from the `PARENT` tariffs — `нэмэлт.md`
 * §3, §7.
 *
 * ★ No `lineItems`. That is the entire point of this route beside
 * `generateInvoiceSchema`: the lines come from `FundingRule` × the month's
 * attendance and meal days, so a forty-child kindergarten is one request
 * instead of forty hand-typed bills.
 *
 * `childIds` narrows it to a re-run for the few children who were missed;
 * omitted, it bills every actively enrolled child.
 */
export const generateMonthSchema = z
  .object({
    month: isoMonth,
    dueDate: isoDate,
    childIds: z.array(uuidSchema).min(1).max(500).optional(),
  })
  .strict();

export type GenerateMonthDto = z.infer<typeof generateMonthSchema>;

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
 *
 * ★★ Eight keys, not §16's nine. "Ирц–санхүүжилтийн тулгалт" is the monthly
 * register, which shipped with §6 and already has its own screen and export —
 * a second answer to one question is worse than none.
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

export { uuidSchema };
