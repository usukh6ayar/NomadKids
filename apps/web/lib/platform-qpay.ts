import { z } from "zod";
import { paginated } from "@kinder/contracts";

/**
 * «Төлбөр шалгах» — the operator answering "I paid, check it" (2026-10-20,
 * the user). Built ahead of the API; asked of the admin with the urgent
 * QPay re-check job:
 *
 *   GET  /platform/qpay/invoices?q=&status=&page=&pageSize=
 *        q — the receipt's «Дугаар» or a payer's phone. The «Дугаар» is what a
 *        family already sees on its paid receipt (`access-invoice.tsx`): the
 *        first eight characters of the subscription's id, upper-cased.
 *        `senderInvoiceNo` is a UUID nobody can read out on the phone.
 *   POST /platform/qpay/invoices/:id/recheck — asks QPay again, settles if paid
 *
 * ★ Not under `/platform/payments` — that is the contract payments the
 * operator records by hand (`kindergarten-payments.tsx`).
 *
 * ★★ No child's name and no whole phone number, by design: the operator does
 * not read children (`authz/platform-access.service.ts`) and the user chose
 * counts and search over names (2026-10-20). The server masks the phone;
 * this file never receives the digits to mask.
 */

export const QPAY_INVOICE_STATUSES = ["PENDING", "PAID", "EXPIRED", "CANCELLED"] as const;

export const qpayInvoiceKindSchema = z.enum(["ACCESS_FEE", "MATERIAL", "CONTRACT"]);

export const platformQpayInvoiceSchema = z.object({
  id: z.string(),
  /** What the payer sees on their receipt — «3F2A9C1B». */
  number: z.string(),
  kind: qpayInvoiceKindSchema,
  status: z.enum(QPAY_INVOICE_STATUSES),
  /** QPay reported a different amount — nothing opened; a person decides. */
  needsReview: z.boolean().default(false),
  amount: z.number(),
  createdAt: z.string(),
  paidAt: z.string().nullish(),
  kindergarten: z.object({ id: z.string(), name: z.string() }).nullish(),
  /** «99••••12», masked on the server. */
  payerPhone: z.string().nullish(),
  /** «2026–2027» or «1-р улирал» — what the fee covers. */
  periodLabel: z.string().nullish(),
  /** When the access it bought runs out. */
  validUntil: z.string().nullish(),
});

export const platformQpayInvoicesSchema = paginated(platformQpayInvoiceSchema);

export type PlatformQpayInvoice = z.infer<typeof platformQpayInvoiceSchema>;

export const QPAY_KIND_LABEL: Record<PlatformQpayInvoice["kind"], string> = {
  ACCESS_FEE: "Хандалтын төлбөр",
  MATERIAL: "Сургалтын хэрэглэгдэхүүн",
  CONTRACT: "Гэрээний төлбөр",
};

/** The filter chips — «Шалгах шаардлагатай» first after Бүгд: it is a person's work. */
export const QPAY_FILTERS = [
  { key: "", label: "Бүгд" },
  { key: "NEEDS_REVIEW", label: "Шалгах шаардлагатай" },
  { key: "PENDING", label: "Хүлээгдэж буй" },
  { key: "PAID", label: "Төлөгдсөн" },
  { key: "EXPIRED", label: "Хугацаа дууссан" },
] as const;

export type QpayFilter = (typeof QPAY_FILTERS)[number]["key"];

/** What the operator sees on a row, and what to tell the person on the phone. */
export function qpayStatusMeta(invoice: PlatformQpayInvoice): {
  label: string;
  tone: "mint" | "sun" | "neutral" | "danger";
  hint: string;
  recheck: boolean;
} {
  if (invoice.needsReview) {
    return {
      label: "Шалгах шаардлагатай",
      tone: "danger",
      hint: "QPay өөр дүн мэдээлсэн тул хандалт нээгдээгүй. Банкны баримтыг шалгана уу.",
      recheck: true,
    };
  }
  switch (invoice.status) {
    case "PAID":
      return {
        label: "Төлөгдсөн",
        tone: "mint",
        hint: "Хандалт нээлттэй. Апп-аа хаагаад дахин нээхийг зөвлөнө үү.",
        recheck: false,
      };
    case "PENDING":
      return {
        label: "Хүлээгдэж буй",
        tone: "sun",
        hint: "QPay мэдэгдээгүй байна. «QPay-ээс дахин шалгах»-ыг дарна уу.",
        recheck: true,
      };
    case "EXPIRED":
      return {
        label: "Хугацаа дууссан",
        tone: "neutral",
        hint: "Төлсөн гэж байвал «QPay-ээс дахин шалгах»-ыг дарна уу.",
        recheck: true,
      };
    default:
      return { label: "Цуцлагдсан", tone: "neutral", hint: "", recheck: false };
  }
}
