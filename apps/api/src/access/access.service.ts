import {
  FIRST_TERM_PROMO,
  firstTermPromoOpen,
  localDate,
  type AccessPeriod,
} from "@kinder/contracts";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import type { Actor } from "../authz/actor";
import { childKindergartenIds } from "../authz/child-access";
import { loadEnv } from "../config/env";
import { AccessRepository } from "./access.repository";

/** «I-р улирал» is the school year's first term. */
const PROMO_TERM_NUMBER = 1;

/**
 * The portal access fee — one child, one school year (client, 2026-09-01), or
 * one term (#211, the user 2026-10-12).
 *
 * ★ `assertCanViewFinance`, not `assertCanAccess`, and both halves of that
 * choice are load-bearing.
 *
 * It **excludes teachers**, who pass `canAccessChild` for their own group: a
 * family's subscription is the family's business and the office's, never the
 * classroom's — the same §13 reasoning that keeps a teacher out of a child's
 * invoices. And it is **not fee-gated**, which is what stops the gate closing
 * its own exit: a guardian who has not paid meets a 402 everywhere else and
 * must still reach the screen that takes their money.
 */
@Injectable()
export class AccessService {
  private readonly feeAmount = loadEnv().ACCESS_FEE_AMOUNT;
  private readonly termFeeAmount = loadEnv().ACCESS_FEE_TERM_AMOUNT;

  constructor(
    private readonly repo: AccessRepository,
    private readonly childAccess: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /** Whether the deployment charges at all. "0" means the gate does not exist. */
  get isCharging(): boolean {
    return this.feeAmount !== "0";
  }

  /** Whether a term can be bought instead of the year (#211). */
  private get sellsTerms(): boolean {
    return this.isCharging && this.termFeeAmount !== "0";
  }

  /**
   * What the unlock screen shows: is a fee owed for this child, how much for
   * the year and for a term, and what is paid.
   */
  async statusForChild(actor: Actor, childId: string) {
    const facts = await this.childAccess.assertCanViewFinance(actor, childId);

    if (!this.isCharging) {
      return { required: false, active: true, amount: null, termAmount: null, subscription: null };
    }

    const day = today();
    const covering = await this.repo.findActiveCovering(facts.childId, day);
    const year = await this.currentYear(facts);
    // «I-р улирал» is offered through 2026-11-30 and not after (2026-10-18).
    const termOnSale = Boolean(year) && this.sellsTerms && firstTermPromoOpen(localDate());
    const subscription =
      covering ?? (year ? await this.repo.findForChildYear(facts.childId, year.id) : null);

    return {
      required: true,
      active: covering !== null,
      amount: this.feeAmount,
      termAmount: termOnSale ? this.termFeeAmount : null,
      subscription: subscription && view(subscription),
    };
  }

  /**
   * The subscription a payment would settle — created on demand rather than
   * ahead of time.
   *
   * ★ Raised lazily, at the moment a family first looks at the screen, not by
   * a sweep over every enrolled child. A row that exists for a family who never
   * opens the portal is a debt the system invented on its own.
   *
   * ★★ A paid row covering today is returned whatever period was asked: there
   * is nothing to buy, and `QpayService` refuses to draw a QR for it. A YEAR
   * row and a TERM row are separate rows with their own QR, so choosing the
   * other period never re-prices a QR already in a parent's hand.
   */
  async ensureForChild(actor: Actor, childId: string, period: AccessPeriod = "YEAR") {
    const facts = await this.childAccess.assertCanViewFinance(actor, childId);
    if (!this.isCharging) {
      throw new BadRequestException("Энэ системд хандалтын төлбөр тогтоогүй байна.");
    }

    const day = today();
    const covering = await this.repo.findActiveCovering(facts.childId, day);
    if (covering) return covering;

    const kindergartenId = [...childKindergartenIds(facts)][0];
    if (!kindergartenId) throw new NotFoundException();

    const year = await this.repo.currentSchoolYear(kindergartenId);
    if (!year) {
      throw new BadRequestException(
        "Цэцэрлэгт идэвхтэй хичээлийн жил тохируулаагүй байна. Захиргаанд хандана уу.",
      );
    }

    /*
     * ★ «I-р улирал» — a fixed last day, 2026-11-30 (the client's brief,
     * 2026-10-18). Bought on 18 October or 29 November, it ends on 30
     * November: never the purchase day plus three months, never the
     * kindergarten's own term (a solo workspace has none), and no past month
     * is charged on top. From 1 December it is not sold, by any path — QPay
     * reaches this method too — and nothing replaces it but the year.
     * A term already paid keeps the day it was paid to (`findActiveCovering`
     * above).
     */
    if (period === "TERM") {
      if (!this.sellsTerms) {
        throw new BadRequestException("Улирлаар төлөх боломжгүй. Жилээр төлнө үү.");
      }
      if (!firstTermPromoOpen(localDate())) {
        throw new BadRequestException(
          `${FIRST_TERM_PROMO.label}-ын төлбөр ${FIRST_TERM_PROMO.endsOn.replaceAll("-", ".")}-нд дууссан. Жилээр төлнө үү.`,
        );
      }
      const existing = await this.repo.findForChildTerm(facts.childId, year.id, PROMO_TERM_NUMBER);
      if (existing) return existing;

      return this.issue(actor, facts.childId, kindergartenId, {
        schoolYearId: year.id,
        period: "TERM",
        termNumber: PROMO_TERM_NUMBER,
        amount: this.termFeeAmount,
        expiresAt: new Date(`${FIRST_TERM_PROMO.endsOn}T00:00:00.000Z`),
        label: `${year.name}, ${FIRST_TERM_PROMO.label}`,
      });
    }

    const existing = await this.repo.findForChildYear(facts.childId, year.id);
    if (existing) return existing;

    return this.issue(actor, facts.childId, kindergartenId, {
      schoolYearId: year.id,
      period: "YEAR",
      termNumber: null,
      amount: this.feeAmount,
      // Frozen from the school year at issue — shortening the year later must
      // not cut access somebody already paid for.
      expiresAt: year.endsOn,
      label: year.name,
    });
  }

  private async issue(
    actor: Actor,
    childId: string,
    kindergartenId: string,
    row: {
      schoolYearId: string;
      period: AccessPeriod;
      termNumber: number | null;
      amount: string;
      expiresAt: Date;
      label: string;
    },
  ) {
    const { label, ...data } = row;
    const created = await this.repo.create({ kindergartenId, childId, ...data });

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "AccessSubscription",
      objectId: created.id,
      childId,
      metadata: { schoolYear: label, period: row.period, amount: row.amount },
    });

    return created;
  }

  /**
   * Called by `QpayService` once QPay's own check API has confirmed the money.
   * Returns whether this call is the one that activated it.
   */
  async markPaid(subscriptionId: string, paidAt: Date): Promise<boolean> {
    const claimed = await this.repo.claimActive(subscriptionId, paidAt);
    if (!claimed) return false;

    const row = await this.repo.findById(subscriptionId);
    if (row) {
      await this.audit.append({
        action: "UPDATE",
        kindergartenId: row.kindergartenId,
        actorUserId: null,
        actorLabel: "QPay (автомат баталгаажуулалт)",
        objectType: "AccessSubscription",
        objectId: row.id,
        childId: row.childId,
        metadata: { before: { status: "UNPAID" }, after: { status: "ACTIVE" } },
      });
    }
    return true;
  }

  /** The kindergarten's current school year for this child. */
  private async currentYear(facts: Parameters<typeof childKindergartenIds>[0]) {
    const kindergartenId = [...childKindergartenIds(facts)][0];
    if (!kindergartenId) return null;
    return this.repo.currentSchoolYear(kindergartenId);
  }
}

function view(subscription: Awaited<ReturnType<AccessRepository["findForChildYear"]>> & {}) {
  return {
    id: subscription.id,
    status: subscription.status,
    period: subscription.period,
    amount: subscription.amount.toString(),
    expiresAt: subscription.expiresAt,
    paidAt: subscription.paidAt,
    schoolYear: subscription.schoolYear,
    termNumber: subscription.termNumber,
  };
}

/**
 * Today's DATE-column key: UTC midnight of Ulaanbaatar's calendar day. The
 * UTC date alone is yesterday until 08:00 local.
 */
function today(): Date {
  return new Date(`${localDate()}T00:00:00.000Z`);
}
