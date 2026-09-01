import { Injectable, NotFoundException } from "@nestjs/common";
import { AuthzRepository } from "./authz.repository";
import { loadEnv } from "../config/env";
import type { Actor } from "./actor";
import { isPortalAccessBlocked, PaymentRequiredException } from "./portal-access";
import {
  canAccessChild,
  canAdministerChild,
  canContributeMediaForChild,
  canRecordForChild,
  canViewChildFinance,
  type ChildAccessFacts,
} from "./child-access";

/**
 * The service every endpoint touching child data calls.
 *
 * ★ These throw `NotFoundException`, never `ForbiddenException`. An
 * unauthorized child and a non-existent child must be indistinguishable — a 403
 * confirms the record exists, which answers "is there a child with id X in this
 * system". Same status, same body, and the response time must not differ
 * either. docs/SECURITY.md §5.4.
 *
 * Usage in a controller is one line:
 *
 *   await this.childAccess.assertCanAccess(actor, childId);
 */
@Injectable()
export class ChildAccessService {
  /**
   * "0" means no gate. Read once at construction: it is a deployment setting,
   * not something an administrator edits at runtime, and re-reading it per
   * request would put a config parse on every child lookup.
   */
  private readonly feeConfigured = loadEnv().ACCESS_FEE_AMOUNT !== "0";

  constructor(private readonly repo: AuthzRepository) {}

  /**
   * Throws 404 unless the actor may READ this child, then **402** if this is
   * one of the child's guardians and the family's portal fee is unpaid.
   *
   * ★ The order matters and is not interchangeable. Authorization first: a
   * stranger must get 404 whether or not anyone has paid, or the fee response
   * becomes an oracle for "is there a child with this id". Only once the
   * actor has been shown to be this child's guardian — someone who already
   * knows the answer — does the 402 become safe to give. See
   * `portal-access.ts`.
   */
  async assertCanAccess(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    const facts = await this.assertCanAccessIgnoringFee(actor, childId);
    await this.assertFeePaid(actor, facts);
    return facts;
  }

  /**
   * The same read check with the fee gate deliberately skipped.
   *
   * Exactly one caller may use this — the unlock screen itself, which has to
   * name the child and quote the amount to a family that has not paid. Every
   * other route must go through `assertCanAccess`, or the gate is decorative.
   */
  async assertCanAccessIgnoringFee(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts || !canAccessChild(actor, facts)) throw new NotFoundException();
    return facts;
  }

  private async assertFeePaid(actor: Actor, facts: ChildAccessFacts): Promise<void> {
    if (!this.feeConfigured) return;

    const active = await this.repo.loadPortalAccessActive(facts.childId, new Date());
    if (isPortalAccessBlocked(actor, facts, { required: true, active })) {
      throw new PaymentRequiredException(
        "Энэ хүүхдийн мэдээллийг үзэхийн тулд энэ хичээлийн жилийн хандалтын төлбөрийг төлнө үү.",
      );
    }
  }

  /**
   * Throws 404 unless the actor may WRITE about this child.
   *
   * Note it is 404 and not 403 even for the child's own guardian, who can
   * demonstrably see the record. Returning 403 here would leak nothing new
   * about *that* child, but it would make the endpoint's behaviour depend on
   * whether the resource exists — and then a 403/404 difference elsewhere
   * becomes an oracle. One rule, applied everywhere, is easier to keep right.
   */
  async assertCanRecord(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts || !canRecordForChild(actor, facts)) throw new NotFoundException();
    await this.assertFeePaid(actor, facts);
    return facts;
  }

  /**
   * Throws 404 unless the actor may add a photograph to this child's album —
   * staff, or one of this child's own guardians. RFP §2.3.
   */
  async assertCanContributeMedia(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts || !canContributeMediaForChild(actor, facts)) throw new NotFoundException();
    await this.assertFeePaid(actor, facts);
    return facts;
  }

  /** Throws 404 unless the actor may administer this child (admins only). */
  async assertCanAdminister(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts || !canAdministerChild(actor, facts)) throw new NotFoundException();
    return facts;
  }

  /**
   * Throws 404 unless the actor may read this child's money — a guardian of
   * theirs, or an admin/accountant of a kindergarten they belong to.
   *
   * ★ Not `assertCanAccess` plus a role check. §13's whole point is that a
   * teacher who legitimately passes `assertCanAccess` for their own group must
   * still be refused here — see `canViewChildFinance`'s own comment.
   */
  async assertCanViewFinance(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts || !canViewChildFinance(actor, facts)) throw new NotFoundException();
    return facts;
  }

  /** Non-throwing variant, for list filtering and conditional UI hints. */
  async canAccess(actor: Actor, childId: string): Promise<boolean> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    return facts !== null && canAccessChild(actor, facts);
  }
}
