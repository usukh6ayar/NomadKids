import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import type { Actor } from "../authz/actor";
import { childKindergartenIds } from "../authz/child-access";
import { loadEnv } from "../config/env";
import { AccessRepository } from "./access.repository";

/**
 * The portal access fee — one child, one school year (client, 2026-09-01).
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

  constructor(
    private readonly repo: AccessRepository,
    private readonly childAccess: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /** Whether the deployment charges at all. "0" means the gate does not exist. */
  get isCharging(): boolean {
    return this.feeAmount !== "0";
  }

  /**
   * What the unlock screen shows: is a fee owed for this child, how much, and
   * for which school year.
   */
  async statusForChild(actor: Actor, childId: string) {
    const facts = await this.childAccess.assertCanViewFinance(actor, childId);

    if (!this.isCharging) {
      return { required: false, active: true, amount: null, subscription: null };
    }

    const subscription = await this.currentSubscription(facts.childId, facts);
    const active = subscription?.status === "ACTIVE" && subscription.expiresAt >= today();

    return {
      required: true,
      active,
      amount: this.feeAmount,
      subscription: subscription && {
        id: subscription.id,
        status: subscription.status,
        amount: subscription.amount.toString(),
        expiresAt: subscription.expiresAt,
        paidAt: subscription.paidAt,
        schoolYear: subscription.schoolYear,
      },
    };
  }

  /**
   * The subscription a payment would settle — created on demand rather than
   * ahead of time.
   *
   * ★ Raised lazily, at the moment a family first looks at the screen, not by
   * a sweep over every enrolled child. A row that exists for a family who never
   * opens the portal is a debt the system invented on its own.
   */
  async ensureForChild(actor: Actor, childId: string) {
    const facts = await this.childAccess.assertCanViewFinance(actor, childId);
    if (!this.isCharging) {
      throw new BadRequestException("Энэ системд хандалтын төлбөр тогтоогүй байна.");
    }

    const existing = await this.currentSubscription(facts.childId, facts);
    if (existing) return existing;

    const kindergartenId = [...childKindergartenIds(facts)][0];
    if (!kindergartenId) throw new NotFoundException();

    const year = await this.repo.currentSchoolYear(kindergartenId);
    if (!year) {
      throw new BadRequestException(
        "Цэцэрлэгт идэвхтэй хичээлийн жил тохируулаагүй байна. Захиргаанд хандана уу.",
      );
    }

    const created = await this.repo.create({
      kindergartenId,
      childId: facts.childId,
      schoolYearId: year.id,
      amount: this.feeAmount,
      // Frozen from the school year at issue — shortening the year later must
      // not cut access somebody already paid for.
      expiresAt: year.endsOn,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "AccessSubscription",
      objectId: created.id,
      childId: facts.childId,
      metadata: { schoolYear: year.name, amount: this.feeAmount },
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

  /** Finds this child's subscription for the kindergarten's current school year. */
  private async currentSubscription(
    childId: string,
    facts: Parameters<typeof childKindergartenIds>[0],
  ) {
    const kindergartenId = [...childKindergartenIds(facts)][0];
    if (!kindergartenId) return null;

    const year = await this.repo.currentSchoolYear(kindergartenId);
    if (!year) return null;

    return this.repo.findForChildYear(childId, year.id);
  }
}

/** Midnight UTC today, to compare against a DATE column. */
function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
