import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { QpayService } from "../integrations/qpay/qpay.service";
import { InvoicesRepository } from "./invoices.repository";
import { statusFor } from "./invoice-math";

/**
 * Online payment — `нэмэлт.md` §8.
 *
 * ★ Split from `InvoicesService` on purpose. That service is the ledger: it
 * knows what is owed and what has been received, and it must stay readable
 * without a payment provider in scope. This one is the provider conversation,
 * and it is where every assumption about QPay lives.
 *
 * ★★ **The threat model, stated plainly, because everything below follows from
 * it.** `QPAY_CALLBACK_URL` is public — QPay dials it, so it cannot sit behind
 * our authentication. Anyone on the internet can therefore POST to it claiming
 * a payment succeeded. If that claim were believed, any invoice in the system
 * could be settled for free by a stranger with a URL.
 *
 * So the callback is never believed. It is a hint that something may have
 * happened; the truth comes from asking QPay ourselves over a connection we
 * opened and authenticated. Three rules implement that and none is optional:
 *
 *   1. **The callback body is used for exactly one thing** — extracting a
 *      payment id. No amount, no status, no invoice reference is read from it.
 *   2. **Verification is mandatory before any credit.** `checkPayment` is the
 *      only thing that can move an invoice towards PAID.
 *   3. **The amount comes from QPay's answer**, not from what our invoice
 *      expected — so an underpayment is recorded as an underpayment rather
 *      than silently rounded up to "settled".
 */
@Injectable()
export class QpayPaymentsService {
  private readonly logger = new Logger(QpayPaymentsService.name);

  constructor(
    private readonly repo: InvoicesRepository,
    private readonly qpay: QpayService,
    private readonly tenants: TenantAccessService,
    private readonly children: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Creates a QPay invoice and returns the QR a parent scans.
   *
   * ★ A **guardian** may call this for their own child, which is the point of
   * the feature — the parent is the one holding the phone. Finance staff may
   * call it too, to read a QR out over the counter. A teacher may not: §13.
   */
  async createQpayInvoice(actor: Actor, invoiceId: string) {
    if (!this.qpay.isConfigured) {
      throw new BadRequestException("Онлайн төлбөр тохируулаагүй байна");
    }

    const invoice = await this.repo.findInvoice(invoiceId);
    if (!invoice) throw new NotFoundException();

    await this.assertMayPay(actor, invoice.kindergartenId, invoice.childId);

    const paid = await this.repo.paidTotal(invoiceId);
    const outstanding = invoice.totalAmount.sub(paid);

    if (!outstanding.isPositive() || outstanding.isZero()) {
      throw new BadRequestException("Энэ нэхэмжлэл төлөгдсөн байна");
    }

    const qpayInvoice = await this.qpay.createInvoice({
      invoiceId,
      invoiceNumber: invoice.number,
      // Only what is still owed, never the original total: a parent paying the
      // rest of a part-paid bill must not be quoted the whole amount again.
      amount: outstanding.toFixed(2),
      description: `${invoice.number} — ${invoice.child?.lastName ?? ""} ${
        invoice.child?.firstName ?? ""
      }`.trim(),
      payerName: `${invoice.child?.lastName ?? ""} ${invoice.child?.firstName ?? ""}`.trim(),
    });

    /*
     * ★ A PENDING row is written now, before the parent pays.
     *
     * It is what a callback resolves against: `providerInvoiceId` lets a
     * confirmation naming only the QPay invoice find its way home. It carries
     * no `idempotencyKey` — that is minted from QPay's payment id at
     * confirmation time — and it is never counted towards a paid total, because
     * `paidTotal` sums `PAID` rows alone.
     */
    const pending = await this.repo.createPayment({
      kindergarten: { connect: { id: invoice.kindergartenId } },
      invoice: { connect: { id: invoiceId } },
      amount: outstanding,
      method: "QPAY",
      status: "PENDING",
      providerInvoiceId: qpayInvoice.providerInvoiceId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: invoice.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Payment",
      objectId: pending.id,
      childId: invoice.childId,
      metadata: {
        invoiceId,
        method: "QPAY",
        status: "PENDING",
        amount: outstanding.toFixed(2),
        providerInvoiceId: qpayInvoice.providerInvoiceId,
      },
    });

    return {
      paymentId: pending.id,
      amount: outstanding.toFixed(2),
      qrText: qpayInvoice.qrText,
      qrImage: qpayInvoice.qrImage,
      links: qpayInvoice.links,
    };
  }

  /**
   * Handles QPay's callback — the public entry point.
   *
   * ★ Returns quietly on every failure it can, and that is deliberate. QPay
   * retries a callback that errors, so answering 500 to a payment we cannot
   * match produces a retry storm; and a public endpoint that reports *why* it
   * refused is an oracle for probing which payment ids exist. The operator
   * learns what happened from the log line, not the caller.
   *
   * ★★ It never trusts its input. The only field read is the payment id, and
   * that id is then handed straight to QPay for verification.
   */
  async handleCallback(
    providerPaymentId: string,
    /**
     * Our own invoice id, from the callback URL's query string.
     *
     * ★ Attacker-controllable, and safe to use anyway: it only selects which
     * pending row to settle. The payment is verified against QPay first, and
     * the amount written is theirs — a forged value cannot invent money, only
     * misdirect a real payment, which `idempotencyKey` then stops from
     * settling twice.
     */
    invoiceIdHint?: string,
  ): Promise<{ ok: true }> {
    if (!this.qpay.isConfigured) {
      this.logger.warn("QPay callback received while QPay is not configured");
      return { ok: true };
    }

    // Rule 1 of the three above: an id we have already settled is a retry.
    // The unique index on the column is the half that holds under a race.
    const key = idempotencyKeyFor(providerPaymentId);
    const existing = await this.repo.findPaymentByIdempotencyKey(key);
    if (existing) {
      this.logger.log(`QPay callback for ${providerPaymentId} already settled — ignoring`);
      return { ok: true };
    }

    // Rule 2: ask QPay. Nothing before this point may credit anything.
    const verified = await this.qpay.checkPayment(providerPaymentId);

    if (!verified) {
      this.logger.warn(`QPay callback for unknown payment ${providerPaymentId}`);
      return { ok: true };
    }
    if (!verified.isPaid) {
      this.logger.warn(
        `QPay callback for ${providerPaymentId} reported not paid — no credit applied`,
      );
      return { ok: true };
    }

    const pending = await this.repo.findPendingQpayPayment({
      providerInvoiceId: verified.providerInvoiceId ?? undefined,
      invoiceId: invoiceIdHint,
    });
    if (!pending) {
      // QPay confirmed a payment we have no pending row for. Possible if our
      // write failed after their invoice was created. Recorded rather than
      // credited: crediting an invoice we cannot identify is worse than a
      // manual reconciliation.
      this.logger.error(`QPay confirmed payment ${providerPaymentId} with no matching pending row`);
      return { ok: true };
    }

    // Rule 3: the amount is QPay's, not ours. An underpayment stays an
    // underpayment and `statusFor` leaves the invoice PARTIALLY_PAID.
    const amount = new Decimal(verified.amount);

    await this.repo.updatePayment(pending.id, {
      status: "PAID",
      amount,
      paidAt: verified.paidAt ?? new Date(),
      providerPaymentId: verified.providerPaymentId,
      idempotencyKey: key,
      rawPayload: {
        providerPaymentId: verified.providerPaymentId,
        amount: verified.amount,
        wallet: verified.wallet,
        paidAt: verified.paidAt?.toISOString() ?? null,
      },
    });

    await this.refreshInvoiceStatus(pending.invoiceId);

    const facts = await this.repo.invoiceFacts(pending.invoiceId);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: pending.kindergartenId,
      // No actor: QPay confirmed this, not a person. A user id here would
      // attribute the money to whoever happened to be nearby.
      actorUserId: null,
      actorLabel: "QPay",
      objectType: "Payment",
      objectId: pending.id,
      childId: facts?.childId ?? null,
      metadata: {
        invoiceId: pending.invoiceId,
        previous: { status: "PENDING", amount: pending.amount.toFixed(2) },
        next: { status: "PAID", amount: amount.toFixed(2) },
        providerPaymentId: verified.providerPaymentId,
      },
    });

    this.logger.log(`QPay payment ${providerPaymentId} confirmed for invoice ${pending.invoiceId}`);

    return { ok: true };
  }

  /**
   * "I paid, but the screen still says unpaid" — the button a parent presses
   * when a callback was lost.
   *
   * ★ Runs the same verification the callback does. A lost callback is common
   * enough that without this the only remedy is an accountant recording the
   * payment by hand, which produces a second record of one payment.
   */
  async syncInvoice(actor: Actor, invoiceId: string) {
    if (!this.qpay.isConfigured) {
      throw new BadRequestException("Онлайн төлбөр тохируулаагүй байна");
    }

    const invoice = await this.repo.findInvoice(invoiceId);
    if (!invoice) throw new NotFoundException();

    await this.assertMayPay(actor, invoice.kindergartenId, invoice.childId);

    const pendingRows = invoice.payments.filter(
      (p) => p.status === "PENDING" && p.providerInvoiceId,
    );

    let applied = 0;
    for (const pending of pendingRows) {
      const payments = await this.qpay.paymentsForInvoice(pending.providerInvoiceId!);

      for (const payment of payments) {
        if (!payment.isPaid) continue;
        // Reuses the callback path so there is exactly one place that credits
        // money, and so a payment arriving by both routes settles once.
        await this.handleCallback(payment.providerPaymentId);
        applied += 1;
      }
    }

    const paidAmount = await this.repo.paidTotal(invoiceId);
    const refreshed = await this.repo.invoiceFacts(invoiceId);

    return {
      applied,
      status: refreshed?.status ?? invoice.status,
      paidAmount: paidAmount.toFixed(2),
    };
  }

  /** Recomputes an invoice's status from what has actually been received. */
  private async refreshInvoiceStatus(invoiceId: string) {
    const invoice = await this.repo.findInvoice(invoiceId);
    if (!invoice) return;

    const paidAmount = await this.repo.paidTotal(invoiceId);

    await this.repo.updateInvoice(invoiceId, {
      status: statusFor({
        totalAmount: invoice.totalAmount,
        paidAmount,
        dueDate: invoice.dueDate,
        now: new Date(),
        current: invoice.status,
      }),
    });
  }

  /**
   * May this actor start or check a payment for this invoice?
   *
   * Finance staff of the owning kindergarten, or one of the child's own
   * guardians. The child's teacher is refused — §13 — even though they pass
   * `canAccessChild`.
   */
  private async assertMayPay(actor: Actor, kindergartenId: string, childId: string) {
    if (this.tenants.canReadFinance(actor, kindergartenId)) return;

    const facts = await this.children.assertCanAccess(actor, childId);
    const isGuardian = facts.guardianships.some(
      (g) => g.guardianUserId === actor.userId && g.canView,
    );

    if (!isGuardian) throw new NotFoundException();
  }
}

/**
 * The idempotency key for one QPay payment.
 *
 * ★ Namespaced so that a provider id can never collide with a key minted by
 * another integration later. Derived purely from QPay's id, so two deliveries
 * of one confirmation produce one key — which the unique index then rejects.
 */
export function idempotencyKeyFor(providerPaymentId: string): string {
  return `qpay:${providerPaymentId}`;
}
