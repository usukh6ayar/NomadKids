import { Injectable } from "@nestjs/common";
import { QpayClient } from "./qpay.client";
import { QpayConfig } from "./qpay.config";
import {
  isPaidStatus,
  qpayInvoiceResponseSchema,
  qpayPaymentCheckResponseSchema,
} from "./qpay.schemas";

/**
 * One QPay invoice, in **our** vocabulary.
 *
 * ★ Their `invoice_id` becomes `providerInvoiceId`, their `qr_text` becomes
 * `qrText`. Nothing outside `integrations/qpay/` sees a snake_case field.
 */
export interface QpayInvoice {
  providerInvoiceId: string;
  qrText: string;
  /** Base64 PNG, rendered by the parent's browser. */
  qrImage: string;
  /** Bank deeplinks, for tapping on a phone. */
  links: { name: string; description: string; link: string }[];
}

/** What QPay says about one payment, after verification. */
export interface QpayPayment {
  providerPaymentId: string;
  /** The QPay invoice it settles, when their answer names one. */
  providerInvoiceId: string | null;
  /** True only when QPay itself reports the money as received. */
  isPaid: boolean;
  /** A decimal string — never parsed to a number here. */
  amount: string;
  wallet: string | null;
  paidAt: Date | null;
}

/**
 * The application-facing entry point to QPay — `нэмэлт.md` §8.
 *
 * ★ Unlike `EsisService`, this has real domain methods: we have the provider's
 * documentation and a live merchant account, so there is nothing to guess. The
 * boundary rule is unchanged though — everything QPay-shaped stops here.
 *
 * ★★ **One merchant serves every kindergarten** (client, 2026-08-31). No method
 * here takes a kindergarten id, because the credentials do not vary by one.
 * Which kindergarten a payment belongs to is answered by the invoice it
 * references.
 */
@Injectable()
export class QpayService {
  constructor(
    private readonly client: QpayClient,
    private readonly config: QpayConfig,
  ) {}

  /**
   * Whether this deployment can take an online payment at all.
   *
   * ★ Callers check this rather than catching `not_configured`. A deployment
   * without QPay is an ordinary state — invoicing still works, the accountant
   * records cash by hand — and treating it as an exception would make ordinary
   * operation look like failure in the logs.
   */
  get isConfigured(): boolean {
    return this.config.isConfigured;
  }

  /** Safe to show an operator: no password, not even its length. */
  status(): ReturnType<QpayConfig["describe"]> {
    return this.config.describe();
  }

  /**
   * Creates a QPay invoice and returns the QR a parent scans.
   *
   * ★ `senderInvoiceNo` is **our** invoice number, and it is what ties their
   * record to ours. QPay echoes it back on enquiry, so a payment can be traced
   * from their dashboard to a row here without a lookup table.
   *
   * ★★ The callback URL carries the invoice id as a query parameter so that a
   * callback naming a payment we have never heard of can still be resolved. It
   * carries no secret: the id is a UUID, and possession of it grants nothing —
   * the callback handler verifies against QPay regardless of what arrives.
   */
  async createInvoice(input: {
    invoiceId: string;
    invoiceNumber: string;
    amount: string;
    description: string;
    /** Shown in the payer's bank app. */
    payerName: string;
  }): Promise<QpayInvoice> {
    const callbackUrl = new URL(this.config.callbackUrl);
    callbackUrl.searchParams.set("invoice_id", input.invoiceId);

    const response = await this.client.request({
      path: "/invoice",
      method: "POST",
      body: {
        invoice_code: this.config.invoiceCode,
        sender_invoice_no: input.invoiceNumber,
        invoice_receiver_code: "terminal",
        invoice_description: input.description,
        sender_branch_code: "NOMADKIDS",
        amount: input.amount,
        callback_url: callbackUrl.toString(),
        invoice_receiver_data: { name: input.payerName },
      },
      parse: (body) => qpayInvoiceResponseSchema.parse(body),
    });

    const data = response.data as ReturnType<typeof qpayInvoiceResponseSchema.parse>;

    return {
      providerInvoiceId: data.invoice_id,
      qrText: data.qr_text,
      qrImage: data.qr_image,
      links: data.urls,
    };
  }

  /**
   * Asks QPay whether a payment really happened — `нэмэлт.md` §8.
   *
   * ★★★ **This is the security boundary of the whole payment flow.**
   *
   * `QPAY_CALLBACK_URL` is public by necessity: QPay dials it, so it cannot sit
   * behind our authentication. That means anybody can post to it claiming a
   * payment succeeded. If the callback body were believed, a stranger could
   * settle any invoice in the system for free.
   *
   * So the callback is treated as a *hint that something may have happened*,
   * and this method is the answer. Nothing is credited until QPay itself,
   * over an authenticated connection we opened, says the money arrived.
   *
   * Returns `null` when QPay knows of no such payment.
   */
  async checkPayment(providerPaymentId: string): Promise<QpayPayment | null> {
    const response = await this.client.request({
      path: "/payment/check",
      method: "POST",
      body: {
        object_type: "PAYMENT",
        object_id: providerPaymentId,
        offset: { page_number: 1, page_limit: 10 },
      },
      parse: (body) => qpayPaymentCheckResponseSchema.parse(body),
    });

    const data = response.data as ReturnType<typeof qpayPaymentCheckResponseSchema.parse>;
    const row = data.rows.find((r) => r.payment_id === providerPaymentId) ?? data.rows[0];

    if (!row) return null;

    return toPayment(row);
  }

  /**
   * Every payment against one QPay invoice.
   *
   * Used when a callback names an invoice rather than a payment, and by the
   * "check now" button a parent presses when their bank was slow.
   */
  async paymentsForInvoice(providerInvoiceId: string): Promise<QpayPayment[]> {
    const response = await this.client.request({
      path: "/payment/check",
      method: "POST",
      body: {
        object_type: "INVOICE",
        object_id: providerInvoiceId,
        offset: { page_number: 1, page_limit: 100 },
      },
      parse: (body) => qpayPaymentCheckResponseSchema.parse(body),
    });

    const data = response.data as ReturnType<typeof qpayPaymentCheckResponseSchema.parse>;

    return data.rows.map(toPayment);
  }
}

/**
 * One QPay row in our vocabulary.
 *
 * ★ The only place their field names are read, so the two call sites above
 * cannot drift apart — which they did in the first draft, where one of them
 * quietly dropped the invoice id a callback needs to find its pending row.
 */
function toPayment(row: {
  payment_id: string;
  payment_status: string;
  payment_amount: string;
  payment_wallet?: string;
  payment_date?: string;
  object_id?: string;
  invoice_id?: string;
}): QpayPayment {
  return {
    providerPaymentId: row.payment_id,
    providerInvoiceId: row.invoice_id ?? row.object_id ?? null,
    isPaid: isPaidStatus(row.payment_status),
    amount: row.payment_amount,
    wallet: row.payment_wallet ?? null,
    paidAt: row.payment_date ? new Date(row.payment_date) : null,
  };
}
