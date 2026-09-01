import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditRepository } from "../../audit/audit.repository";
import { ChildAccessService } from "../../authz/child-access.service";
import type { Actor } from "../../authz/actor";
import { AccessService } from "../../access/access.service";
import { QpayClient, QpayError } from "./qpay.client";
import { QpayConfig } from "./qpay.config";
import { QpayRepository } from "./qpay.repository";

/**
 * How long a QR stays offered before a fresh one replaces it.
 *
 * Independent of whatever QPay's own invoice expiry is (undocumented without
 * a sandbox to inspect) — this bounds how long a *stale* row is reused by
 * `createForSubscription` and how long `status`/the callback keep polling QPay
 * about it before giving up and reporting EXPIRED locally.
 */
const QPAY_INVOICE_TTL_MS = 30 * 60 * 1000;

const GENERIC_FAILURE_MESSAGE = "QPay-тай холбогдоход алдаа гарлаа. Дараа дахин оролдоно уу.";

/**
 * Paying the portal access fee through QPay — the only thing this gateway is
 * used for (client, 2026-09-01).
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
    private readonly access: AccessService,
    private readonly childAccess: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /** Whether this deployment can talk to QPay at all — the pay button's own gate. */
  get isConfigured(): boolean {
    return this.config.isConfigured;
  }

  /**
   * Draws a QR for one child's portal access fee, or hands back one already in
   * flight.
   *
   * ★ Authorization is `AccessService.ensureForChild`'s, which uses
   * `assertCanViewFinance`: guardian, admin or accountant, never a teacher,
   * and deliberately not behind the access gate — this route has to stay
   * reachable by the family that has not paid yet.
   */
  async createForSubscription(actor: Actor, childId: string) {
    // ★★ Authorization FIRST, configuration second. The order is the test
    // `refuses a teacher` and `refuses another family's guardian` exist to
    // pin: checking `isConfigured` up front answered a stranger with "QPay is
    // not set up here" — a 400 that confirms the child id is real, where the
    // rule is 404 and indistinguishability (docs/SECURITY.md §5.4). Whether
    // this deployment has QPay credentials is not a fact an unauthorized
    // caller gets to learn.
    const subscription = await this.access.ensureForChild(actor, childId);

    if (!this.isConfigured) {
      throw new BadRequestException("QPay холболт тохируулагдаагүй байна.");
    }

    if (subscription.status === "ACTIVE") {
      throw new BadRequestException("Энэ хичээлийн жилийн хандалт аль хэдийн нээгдсэн байна.");
    }

    // decimal.js is unnecessary here — the amount is copied, never computed.
    // It was frozen onto the subscription at issue and is handed to QPay
    // unchanged, so a price change cannot move a QR already in a parent's hand.
    const amount = subscription.amount.toFixed(2);

    const now = new Date();
    const latest = await this.repo.findLatestForSubscription(subscription.id);
    if (latest && latest.status === "PENDING" && latest.expiresAt && latest.expiresAt > now) {
      return latest;
    }

    const senderInvoiceNo = randomUUID();

    let created;
    try {
      created = await this.client.createInvoice({
        senderInvoiceNo,
        amount,
        description: `NomadKids — хандалтын төлбөр ${subscription.schoolYear.name}`,
      });
    } catch (cause) {
      throw this.toHttpError(cause, "createInvoice");
    }

    const row = await this.repo.create({
      kindergartenId: subscription.kindergartenId,
      subscriptionId: subscription.id,
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
      kindergartenId: subscription.kindergartenId,
      actorUserId: actor.userId,
      objectType: "QpayInvoice",
      objectId: row.id,
      childId,
      metadata: { subscriptionId: subscription.id, amount },
    });

    return row;
  }

  async status(actor: Actor, childId: string) {
    const subscription = await this.access.ensureForChild(actor, childId);

    const row = await this.repo.findLatestForSubscription(subscription.id);
    if (!row) throw new NotFoundException();

    return this.reconcile(row);
  }

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
   * own `checkPayment`, and only THEN, if it says PAID, opens the family's
   * access. No `Payment` row is written: the fee is the platform operator's
   * revenue, and a kindergarten's ledger must not carry income its accountant
   * will never find on their own bank statement.
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

    // ★ No `Payment` row. An access fee is the platform operator's revenue,
    // not a kindergarten's — putting it in the ledger §14 audits would mix the
    // operator's income into a kindergarten's books, where an accountant
    // reconciling against their own bank statement would never find it.
    await this.access.markPaid(row.subscriptionId, now);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: row.kindergartenId,
      actorUserId: row.createdById,
      actorLabel: row.createdById ? null : "QPay (автомат баталгаажуулалт)",
      objectType: "QpayInvoice",
      objectId: row.id,
      metadata: {
        after: { subscriptionId: row.subscriptionId, amount: row.amount.toFixed(2) },
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
