import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AccessPeriod } from "@kinder/contracts";
import { AuditRepository } from "../../audit/audit.repository";
import { ChildAccessService } from "../../authz/child-access.service";
import { PlatformAccessService } from "../../authz/platform-access.service";
import type { Actor } from "../../authz/actor";
import { AccessService } from "../../access/access.service";
import { QpayClient, QpayError } from "./qpay.client";
import { QpayConfig } from "./qpay.config";
import { QpayRepository, type OperatorQpayRow } from "./qpay.repository";
import type { ListOperatorQpayQuery } from "./qpay.dto";

/**
 * How long a QR stays offered before a fresh one replaces it.
 *
 * Independent of whatever QPay's own invoice expiry is (undocumented without
 * a sandbox to inspect) — this bounds how long a *stale* row is reused by
 * `createForSubscription` and how long `status`/the callback keep polling QPay
 * about it before giving up and reporting EXPIRED locally.
 */
const QPAY_INVOICE_TTL_MS = 30 * 60 * 1000;

/** How far back the sweep re-asks about an EXPIRED QR — a late settlement is hours, not days. */
const SWEEP_EXPIRED_WINDOW_MS = 48 * 60 * 60 * 1000;

/** The most attempts one sweep asks QPay about — newest first; the rest wait ten minutes. */
const SWEEP_BATCH = 100;

const GENERIC_FAILURE_MESSAGE = "QPay-тай холбогдоход алдаа гарлаа. Дараа дахин оролдоно уу.";

/**
 * Paying through QPay: the portal access fee (client, 2026-09-01) and, since
 * 2026-10-11, a teaching material (client, 2026-10-09 — CLAUDE.md §7). Nothing
 * a kindergarten bills a family ever goes through here.
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
    private readonly platform: PlatformAccessService,
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
  async createForSubscription(actor: Actor, childId: string, period: AccessPeriod = "YEAR") {
    // ★★ Authorization FIRST, configuration second. The order is the test
    // `refuses a teacher` and `refuses another family's guardian` exist to
    // pin: checking `isConfigured` up front answered a stranger with "QPay is
    // not set up here" — a 400 that confirms the child id is real, where the
    // rule is 404 and indistinguishability (docs/SECURITY.md §5.4). Whether
    // this deployment has QPay credentials is not a fact an unauthorized
    // caller gets to learn.
    const subscription = await this.access.ensureForChild(actor, childId, period);

    if (!this.isConfigured) {
      throw new BadRequestException("QPay холболт тохируулагдаагүй байна.");
    }

    if (subscription.status === "ACTIVE") {
      throw new BadRequestException("Энэ хүүхдийн үйлчилгээний эрх аль хэдийн нээгдсэн байна.");
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
        description: `NomadKids — хандалтын төлбөр ${subscription.schoolYear.name}${
          subscription.termNumber ? `, ${subscription.termNumber}-р улирал` : ""
        }`,
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

  /**
   * Draws a QR for one teacher's purchase of one material, or hands back one
   * still in flight.
   *
   * ★ No authorization here: `MaterialsService` has already decided the
   * actor may buy this (a teacher, a material on sale) and owns `purchase`.
   * The amount is the purchase's, re-read from the material by the caller.
   */
  async createForMaterialPurchase(
    actor: Actor,
    purchase: { id: string; amount: number; title: string },
  ) {
    if (!this.isConfigured) {
      throw new BadRequestException("QPay холболт тохируулагдаагүй байна.");
    }

    const amount = `${purchase.amount}.00`;
    const now = new Date();
    const latest = await this.repo.findLatestForMaterialPurchase(purchase.id);
    if (
      latest &&
      latest.status === "PENDING" &&
      latest.expiresAt &&
      latest.expiresAt > now &&
      latest.amount.toFixed(2) === amount
    ) {
      return latest;
    }

    const senderInvoiceNo = randomUUID();
    let created;
    try {
      created = await this.client.createInvoice({
        senderInvoiceNo,
        amount,
        description: `NomadKids — ${purchase.title}`.slice(0, 120),
      });
    } catch (cause) {
      throw this.toHttpError(cause, "createInvoice");
    }

    const row = await this.repo.create({
      kindergartenId: null,
      materialPurchaseId: purchase.id,
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
      actorUserId: actor.userId,
      objectType: "QpayInvoice",
      objectId: row.id,
      metadata: { materialPurchaseId: purchase.id, amount },
    });

    return row;
  }

  /**
   * A QR for one period of a kindergarten's platform contract — №6, the user
   * 2026-10-16/18: every payment to the platform is QPay, so the revenue and
   * the partners' shares count it without anybody typing it in.
   *
   * ★ No authorization here: `ServiceAccessService` has decided the actor is
   * this kindergarten's director and priced `payment` on the server. An
   * unexpired PENDING attempt at the same amount is reused, as for a material.
   */
  async createForContractPayment(
    actor: Actor,
    payment: { id: string; kindergartenId: string; amount: string; description: string },
  ) {
    if (!this.isConfigured) {
      throw new BadRequestException("QPay холболт тохируулагдаагүй байна.");
    }

    const now = new Date();
    const found = await this.repo.findLatestForContractPayment(payment.id);
    // ★ The QR before is asked about before another is drawn (review of
    // #258): paid off-screen with no callback reaching us, it would otherwise
    // be replaced and never credited — and the new QR charge a second time.
    const latest = found?.status === "PENDING" ? await this.reconcile(found) : found;
    if (latest?.status === "PAID") {
      throw new BadRequestException("Энэ хугацааны төлбөр аль хэдийн төлөгдсөн.");
    }
    if (
      latest &&
      latest.status === "PENDING" &&
      latest.expiresAt &&
      latest.expiresAt > now &&
      latest.amount.toFixed(2) === payment.amount
    ) {
      return latest;
    }

    const senderInvoiceNo = randomUUID();
    let created;
    try {
      created = await this.client.createInvoice({
        senderInvoiceNo,
        amount: payment.amount,
        description: `NomadKids — ${payment.description}`.slice(0, 120),
      });
    } catch (cause) {
      throw this.toHttpError(cause, "createInvoice");
    }

    const row = await this.repo.create({
      kindergartenId: payment.kindergartenId,
      contractPaymentId: payment.id,
      amount: payment.amount,
      qpayInvoiceId: created.invoice_id,
      senderInvoiceNo,
      qrText: created.qr_text ?? null,
      qrImage: created.qr_image ?? null,
      createdById: actor.userId,
      expiresAt: new Date(now.getTime() + QPAY_INVOICE_TTL_MS),
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: payment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "QpayInvoice",
      objectId: row.id,
      metadata: { contractPaymentId: payment.id, amount: payment.amount },
    });

    return row;
  }

  /** The latest attempt for a contract period, reconciled — `null` when none was drawn. */
  async statusForContractPayment(contractPaymentId: string) {
    const row = await this.repo.findLatestForContractPayment(contractPaymentId);
    return row ? this.reconcile(row) : null;
  }

  /** The latest attempt for a purchase, reconciled — `null` when none was drawn. */
  async statusForMaterialPurchase(purchaseId: string) {
    const row = await this.repo.findLatestForMaterialPurchase(purchaseId);
    return row ? this.reconcile(row) : null;
  }

  async status(actor: Actor, childId: string, period: AccessPeriod = "YEAR") {
    const subscription = await this.access.ensureForChild(actor, childId, period);

    const row = await this.repo.findLatestForSubscription(subscription.id);
    if (!row) throw new NotFoundException();

    return this.reconcile(row);
  }

  async handleCallback(qpayInvoiceId: string): Promise<void> {
    if (!qpayInvoiceId) return;

    const row = await this.repo.findByQpayInvoiceId(qpayInvoiceId);
    if (!row) return;

    await this.reconcile(row, { recheckExpired: true });
  }

  /**
   * The sweep — asks QPay again about every attempt nobody is asking about.
   *
   * ★ A family that pays and closes the tab, whose callback never reaches us,
   * would otherwise have paid and stayed locked out until someone called the
   * operator: `status()` only runs while the QR is on screen, and the
   * callback is the only other caller that re-asks about an EXPIRED row.
   * `QpaySweepScheduler` runs this every ten minutes; the same `reconcile`
   * settles, so a sweep racing a callback credits once.
   *
   * One row's failure is logged and the rest still run.
   */
  async sweepUnsettled(now = new Date()): Promise<{ checked: number; paid: number }> {
    if (!this.isConfigured) return { checked: 0, paid: 0 };

    const rows = await this.repo.findUnsettled(
      new Date(now.getTime() - SWEEP_EXPIRED_WINDOW_MS),
      SWEEP_BATCH,
    );
    let paid = 0;
    for (const row of rows) {
      try {
        const after = await this.reconcile(row, { recheckExpired: true });
        if (after.status === "PAID") paid += 1;
      } catch (error) {
        this.logger.error(`QPay sweep failed on ${row.qpayInvoiceId}`, error as Error);
      }
    }
    if (paid > 0) this.logger.log(`QPay sweep settled ${paid} of ${rows.length}`);
    return { checked: rows.length, paid };
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
  private async reconcile(
    row: NonNullable<Awaited<ReturnType<QpayRepository["findById"]>>>,
    { recheckExpired = false }: { recheckExpired?: boolean } = {},
  ) {
    // ★ An EXPIRED row is asked about again only when QPay itself calls about
    // it (review of #258): our 30 minutes are not QPay's, and a QR scanned in
    // its last seconds settles after them. A poll never re-asks — the screen
    // has drawn a new QR by then.
    if (row.status !== "PENDING" && !(row.status === "EXPIRED" && recheckExpired)) return row;

    const now = new Date();
    const stale = row.status === "PENDING" && row.expiresAt !== null && row.expiresAt <= now;
    const expire = async () => {
      if (stale) await this.repo.markExpired(row.id);
      return stale ? { ...row, status: "EXPIRED" as const } : row;
    };

    if (!this.isConfigured) return expire();

    // ★ A stale row is checked once before it is expired, not expired blind —
    // a payment that landed at minute 29 would otherwise take the money and
    // open nothing.
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
      return expire();
    }

    const paidRow = checked.rows.find((r) => r.payment_status === "PAID");
    if (!paidRow) return expire();

    /*
     * ★ The amount QPay says was paid must cover the row's — 2026-10-18, the
     * pricing brief: "the backend must independently validate the amount".
     * The invoice carries a fixed amount, so a short payment should not exist;
     * if one is ever reported, nothing opens and the row stays PENDING for a
     * person to look at. Whole tugrik, compared as strings of digits.
     */
    const paidTugrik = Number.parseInt(String(paidRow.payment_amount).split(".")[0] ?? "", 10);
    const owedTugrik = Number.parseInt(row.amount.toFixed(0), 10);
    if (!Number.isFinite(paidTugrik) || paidTugrik < owedTugrik) {
      this.logger.error(
        `QPay reported ${String(paidRow.payment_amount)} paid against ${row.amount.toFixed(2)} on ${row.qpayInvoiceId}; not settled`,
      );
      await this.repo.markForReview(row.id, "AMOUNT_SHORT");
      return { ...row, reviewReason: "AMOUNT_SHORT" as const };
    }

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
    // reconciling against their own bank statement would never find it. A
    // material sale is the platform's too, and follows the same rule.
    //
    // ★★ Exactly one target per row (a CHECK in the database), so exactly
    // one branch runs.
    let credited = true;
    let contractPaymentBefore: { amount: string; groupCount: number } | null = null;
    if (row.subscriptionId) {
      credited = await this.access.markPaid(row.subscriptionId, now);
    } else if (row.contractPaymentId) {
      const result = await this.repo.markContractPaymentPaid(
        row.contractPaymentId,
        now,
        row.amount.toFixed(2),
      );
      credited = result.claimed;
      if (result.claimed) {
        contractPaymentBefore = result.before;
        if (result.overlaps) {
          this.logger.error(
            `Contract payment ${row.contractPaymentId} overlaps another paid period of its contract (QPay ${row.qpayInvoiceId}); refund or credit by hand`,
          );
        }
      }
    } else if (row.materialPurchaseId) {
      // Whole tugrik, parsed from the decimal's own string — never a float.
      const paid = Number.parseInt(row.amount.toFixed(0), 10);
      credited = await this.repo.markMaterialPurchasePaid(row.materialPurchaseId, now, paid);
    }
    // ★ Money moved and nothing was credited: the target was already paid by
    // another QR (review of #258). Never silent — a person refunds it.
    if (!credited) {
      this.logger.error(
        `QPay ${row.qpayInvoiceId} paid ${row.amount.toFixed(2)} for a target already paid; refund by hand`,
      );
      await this.repo.markForReview(row.id, "TARGET_ALREADY_PAID");
    }

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: row.kindergartenId,
      actorUserId: row.createdById,
      actorLabel: row.createdById ? null : "QPay (автомат баталгаажуулалт)",
      objectType: "QpayInvoice",
      objectId: row.id,
      metadata: {
        before: { status: row.status, ...(contractPaymentBefore ? { contractPaymentBefore } : {}) },
        after: {
          subscriptionId: row.subscriptionId,
          contractPaymentId: row.contractPaymentId,
          materialPurchaseId: row.materialPurchaseId,
          amount: row.amount.toFixed(2),
          credited,
        },
        qpayInvoiceId: row.qpayInvoiceId,
        qpayPaymentId: paidRow.payment_id,
      },
    });

    return (await this.repo.findById(row.id)) ?? row;
  }

  /**
   * «Төлбөр шалгах» — the platform operator answering "I paid, check it"
   * (2026-10-20/21, the user). Every QPay attempt, searched by the receipt's
   * «Дугаар» or the payer's phone.
   *
   * ★ Superadmin only, 404 for anyone else (§1.7). ★★ No child: no name, no
   * id, and the payer's phone masked here — the operator does not read
   * children (`authz/platform-access.service.ts`).
   */
  async listForOperator(actor: Actor, query: ListOperatorQpayQuery) {
    this.platform.assertSuperAdmin(actor);
    const q = query.q?.trim() ?? "";
    // A receipt number is 4–8 hex characters; a phone is digits (an 8-digit
    // number is both, and either may match).
    const hex = q.toLowerCase();
    const numberPrefix = /^[0-9a-f]{4,8}$/.test(hex) ? hex : null;
    const digits = q.replace(/\D/g, "");
    const phoneDigits = digits.length >= 4 && /^[\d\s+()-]+$/.test(q) ? digits : null;
    // A search that can match nothing answers nothing, not every row.
    if (q && !numberPrefix && !phoneDigits) {
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    }

    const { rows, total } = await this.repo.listForOperator({
      numberPrefix,
      phoneDigits,
      status: query.status ?? null,
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: rows.map(operatorView),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Asks QPay again about one attempt and settles it if paid — the same
   * `reconcile` the callback runs, EXPIRED included, since a family that
   * paid after our 30 minutes and whose callback never came is exactly who
   * calls the operator.
   */
  async recheckForOperator(actor: Actor, id: string) {
    this.platform.assertSuperAdmin(actor);
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException();

    if (row.status === "PENDING" || row.status === "EXPIRED") {
      if (!this.isConfigured) {
        throw new BadRequestException("QPay холболт тохируулагдаагүй байна.");
      }
      const after = await this.reconcile(row, { recheckExpired: true });
      // Who asked — the settlement itself is audited as the payer's.
      await this.audit.append({
        action: "UPDATE",
        kindergartenId: row.kindergartenId,
        actorUserId: actor.userId,
        objectType: "QpayInvoice",
        objectId: row.id,
        metadata: {
          recheck: true,
          before: { status: row.status },
          after: { status: after.status },
          qpayInvoiceId: row.qpayInvoiceId,
        },
      });
    }

    const latest = await this.repo.findForOperator(id);
    if (!latest) throw new NotFoundException();
    return operatorView(latest);
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

/** «99••••12» — the first two and last two digits; never the whole number. */
export function maskPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "").slice(-8);
  if (digits.length < 4) return null;
  return `${digits.slice(0, 2)}${"•".repeat(digits.length - 4)}${digits.slice(-2)}`;
}

const TERM_NUMERALS = ["I", "II", "III"];

/** One attempt as «Төлбөр шалгах» shows it — `apps/web/lib/platform-qpay.ts`. */
function operatorView(row: OperatorQpayRow) {
  const targetId = row.subscriptionId ?? row.materialPurchaseId ?? row.contractPaymentId ?? row.id;
  const kind = row.subscriptionId ? "ACCESS_FEE" : row.materialPurchaseId ? "MATERIAL" : "CONTRACT";
  const paid = row.status === "PAID";

  let periodLabel: string | null = null;
  let validUntil: Date | null = null;
  if (row.subscription) {
    const term = row.subscription.termNumber;
    periodLabel =
      row.subscription.period === "TERM" && term
        ? `${row.subscription.schoolYear.name}, ${TERM_NUMERALS[term - 1] ?? term} улирал`
        : row.subscription.schoolYear.name;
    validUntil = row.subscription.expiresAt;
  } else if (row.contractPayment) {
    const day = (date: Date) => date.toISOString().slice(0, 10);
    periodLabel = `${day(row.contractPayment.coversFrom)} – ${day(row.contractPayment.coversTo)}`;
    validUntil = row.contractPayment.coversTo;
  } else if (row.materialPurchase) {
    periodLabel = row.materialPurchase.material.title;
  }

  return {
    id: row.id,
    number: targetId.slice(0, 8).toUpperCase(),
    kind,
    status: row.status,
    needsReview: row.reviewReason !== null,
    reviewReason: row.reviewReason,
    amount: row.amount.toFixed(2),
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    kindergarten: row.kindergarten,
    payerPhone: maskPhone(row.createdBy?.phone),
    periodLabel,
    // Only once paid: an unpaid row's frozen date would read as a promise.
    validUntil: paid && validUntil ? validUntil.toISOString().slice(0, 10) : null,
  };
}
