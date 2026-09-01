import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { AuditRepository } from "../../audit/audit.repository";
import { ChildAccessService } from "../../authz/child-access.service";
import type { Actor } from "../../authz/actor";
import { InvoicesRepository } from "../../invoices/invoices.repository";
import { QpayClient, QpayError } from "./qpay.client";
import { QpayConfig } from "./qpay.config";
import { QpayRepository } from "./qpay.repository";

/**
 * How long a QR stays offered before a fresh one replaces it.
 *
 * Independent of whatever QPay's own invoice expiry is (undocumented without
 * a sandbox to inspect) — this bounds how long a *stale* row is reused by
 * `createForInvoice` and how long `status`/the callback keep polling QPay
 * about it before giving up and reporting EXPIRED locally.
 */
const QPAY_INVOICE_TTL_MS = 30 * 60 * 1000;

const GENERIC_FAILURE_MESSAGE = "QPay-тай холбогдоход алдаа гарлаа. Дараа дахин оролдоно уу.";

/**
 * Paying an invoice through QPay — нэмэлт.md §8.
 *
 * ★ Three entry points, one shared `reconcile()`.
 *
 * `status()` (a parent's browser polling while the QR is on screen) and
 * `handleCallback()` (QPay's own webhook) are two different triggers for the
 * exact same question — "has this been paid yet" — and both must produce the
 * same result whichever fires first or arrives at all. Neither is assumed
 * reliable: a webhook can be slow, dropped, or unreachable (`localhost`
 * during development), and a parent can close the tab before polling once. A
 * kindergarten operating without a public callback URL configured still
 * works correctly off polling alone.
 */
@Injectable()
export class QpayService {
  private readonly logger = new Logger(QpayService.name);

  constructor(
    private readonly repo: QpayRepository,
    private readonly client: QpayClient,
    private readonly config: QpayConfig,
    private readonly invoices: InvoicesRepository,
    private readonly childAccess: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /** Whether this deployment can talk to QPay at all — the pay button's own gate. */
  get isConfigured(): boolean {
    return this.config.isConfigured;
  }

  /**
   * Starts paying one invoice through QPay, or hands back a QR already in
   * flight for it.
   *
   * ★ `assertCanViewFinance`, same predicate the child-scoped invoice list
   * uses — a guardian pays their own child's bill, an admin or accountant may
   * do it on a family's behalf (e.g. showing the QR in person), and a teacher
   * is refused exactly as нэмэлт.md §13 requires.
   */
  async createForInvoice(actor: Actor, childId: string, invoiceId: string) {
    await this.childAccess.assertCanViewFinance(actor, childId);

    const ref = await this.invoices.findInvoiceRef(invoiceId);
    if (!ref || ref.childId !== childId) throw new NotFoundException();

    if (!this.isConfigured) {
      throw new BadRequestException("QPay холболт тохируулагдаагүй байна.");
    }
    if (ref.status === "PAID" || ref.status === "REFUNDED") {
      throw new BadRequestException("Энэ нэхэмжлэл аль хэдийн шийдэгдсэн байна.");
    }

    // decimal.js, not `Number()` — this figure becomes the amount frozen onto
    // the QR a parent is handed, so it is the last place a rounding error
    // could still be introduced before money moves.
    const balance = new Decimal(ref.balance.toString());
    if (!balance.gt(0)) {
      throw new BadRequestException("Төлөх үлдэгдэл алга.");
    }

    const now = new Date();
    const latest = await this.repo.findLatestForInvoice(invoiceId);
    if (latest && latest.status === "PENDING" && latest.expiresAt && latest.expiresAt > now) {
      return latest;
    }

    const amount = balance.toFixed(2);
    const senderInvoiceNo = randomUUID();

    let created;
    try {
      created = await this.client.createInvoice({
        senderInvoiceNo,
        amount,
        description: `NomadKids — нэхэмжлэл ${invoiceId.slice(0, 8)}`,
      });
    } catch (cause) {
      throw this.toHttpError(cause, "createInvoice");
    }

    const row = await this.repo.create({
      kindergartenId: ref.kindergartenId,
      invoiceId,
      amount,
      qpayInvoiceId: created.invoice_id,
      senderInvoiceNo,
      qrText: created.qr_text ?? null,
      qrImage: created.qr_image ?? null,
      createdById: actor.userId,
      expiresAt: new Date(now.getTime() + QPAY_INVOICE_TTL_MS),
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: ref.kindergartenId,
      actorUserId: actor.userId,
      objectType: "QpayInvoice",
      objectId: row.id,
      childId,
      metadata: { invoiceId, amount },
    });

    return row;
  }

  /**
   * The latest attempt's status, re-checked with QPay first if still pending.
   *
   * ★ This is the poll a parent's browser makes while the QR is on screen —
   * it is what makes payment visible even when the callback never arrives.
   */
  async status(actor: Actor, childId: string, invoiceId: string) {
    await this.childAccess.assertCanViewFinance(actor, childId);

    const ref = await this.invoices.findInvoiceRef(invoiceId);
    if (!ref || ref.childId !== childId) throw new NotFoundException();

    const row = await this.repo.findLatestForInvoice(invoiceId);
    if (!row) throw new NotFoundException();

    return this.reconcile(row);
  }

  /**
   * QPay's own callback — `@Public()`, called by their server, not a
   * signed-in actor.
   *
   * ★ The request body/query is used for exactly one thing: which
   * `qpayInvoiceId` to go check. It is never trusted for amount or status —
   * see `reconcile()`. An unrecognised id is a silent no-op rather than a 404:
   * this endpoint is reachable by anyone who can guess a URL, and confirming
   * "no such invoice" to an unauthenticated caller is exactly the oracle
   * docs/SECURITY.md §5.4 exists to deny elsewhere in this codebase.
   */
  async handleCallback(qpayInvoiceId: string): Promise<void> {
    if (!qpayInvoiceId) return;

    const row = await this.repo.findByQpayInvoiceId(qpayInvoiceId);
    if (!row) return;

    await this.reconcile(row);
  }

  /**
   * The one place that decides "has this been paid" and credits it — called
   * from both `status()` (poll) and the callback.
   *
   * ★ Never trusts a caller-supplied amount or status. Always re-asks QPay's
   * own `checkPayment`, and only THEN, if it says PAID, creates the real
   * `Payment` row — `InvoicesRepository.recordPayment`, the exact same
   * repository method the accountant's manual CASH/BANK_TRANSFER flow uses,
   * so `recomputeTotals` updates `Invoice.status`/`balance` identically
   * either way (нэмэлт.md §8: "Төлбөр амжилттай болсны дараа invoice-ийн
   * төлөв автоматаар шинэчлэгдэх").
   *
   * ★★ The claim-then-attach split against `QpayRepository` is what makes this
   * safe to call twice concurrently — see `claimForPayment`'s own comment.
   * Everything before the claim (the `checkPayment` call) may run twice
   * harmlessly; nothing after it can.
   */
  private async reconcile(row: NonNullable<Awaited<ReturnType<QpayRepository["findById"]>>>) {
    if (row.status !== "PENDING") return row;

    const now = new Date();
    if (row.expiresAt && row.expiresAt <= now) {
      await this.repo.markExpired(row.id);
      return { ...row, status: "EXPIRED" as const };
    }

    if (!this.isConfigured) return row;

    let checked;
    try {
      checked = await this.client.checkPayment(row.qpayInvoiceId);
    } catch (cause) {
      // A failed check is not a failed payment — it is "still don't know".
      // The next poll or callback tries again; nothing about `row` changes.
      this.logger.warn(
        `QPay checkPayment failed for ${row.qpayInvoiceId}: ${
          cause instanceof QpayError ? cause.message : "unknown error"
        }`,
      );
      return row;
    }

    const paidRow = checked.rows.find((r) => r.payment_status === "PAID");
    if (!paidRow) return row;

    const claimed = await this.repo.claimForPayment(row.id, now);
    if (!claimed) {
      // Lost the race to a concurrent call (the webhook and this poll firing
      // together, or two polls) — that call is creating the `Payment`. Read
      // back whatever it leaves rather than creating a second one.
      return (await this.repo.findById(row.id)) ?? row;
    }

    const { payment } = await this.invoices.recordPayment(row.invoiceId, {
      kindergartenId: row.kindergartenId,
      invoiceId: row.invoiceId,
      amount: row.amount.toFixed(2),
      method: "QPAY",
      gatewayReference: paidRow.payment_id,
      recordedById: null,
      note: "QPay-ээр автоматаар баталгаажлаа.",
    });

    await this.repo.attachPayment(row.id, payment.id);

    await this.audit.append({
      action: "CREATE",
      kindergartenId: row.kindergartenId,
      actorUserId: row.createdById,
      actorLabel: row.createdById ? null : "QPay (автомат баталгаажуулалт)",
      objectType: "Payment",
      objectId: payment.id,
      metadata: {
        after: { invoiceId: row.invoiceId, amount: row.amount.toFixed(2), method: "QPAY" },
        qpayInvoiceId: row.qpayInvoiceId,
        qpayPaymentId: paidRow.payment_id,
      },
    });

    return (await this.repo.findById(row.id)) ?? row;
  }

  private toHttpError(cause: unknown, context: string): BadRequestException {
    if (cause instanceof QpayError) {
      this.logger.warn(`QPay ${context} failed (${cause.kind}): ${cause.message}`);
    } else {
      this.logger.warn(`QPay ${context} failed with a non-QpayError: ${String(cause)}`);
    }
    return new BadRequestException(GENERIC_FAILURE_MESSAGE);
  }
}
