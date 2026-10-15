import { Injectable, NotFoundException } from "@nestjs/common";
import { localDate } from "@kinder/contracts";
import { AuthzRepository } from "./authz.repository";
import { loadEnv } from "../config/env";
import type { Actor } from "./actor";
import { isPortalAccessBlocked, PaymentRequiredException } from "./portal-access";
import {
  canAccessChild,
  canAdministerChild,
  canArchiveChild,
  canContributeChildHealth,
  canContributeMediaForChild,
  canObserveChild,
  canReadChildCard,
  canReadChildHealth,
  canReadObservations,
  canRecordChildHealth,
  canRecordForChild,
  canViewChildFinance,
  isFormerTeacherOf,
  isGuardianOf,
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

  private async assertFeePaid(
    actor: Actor,
    facts: ChildAccessFacts,
    options: { gateSoloStaff?: boolean } = {},
  ): Promise<void> {
    if (!this.feeConfigured) return;

    // ★ `expiresAt` is a DATE column, and Prisma keys a Date by its UTC day —
    // which is yesterday in Ulaanbaatar until 08:00. `new Date()` here left a
    // fee that ran out yesterday open until eight in the morning (2026-10-16).
    const today = new Date(`${localDate()}T00:00:00.000Z`);
    const active = await this.repo.loadPortalAccessActive(facts.childId, today);
    const blocked = isPortalAccessBlocked(actor, facts, { required: true, active }, options);
    if (blocked === "guardian") {
      throw new PaymentRequiredException(
        "Энэ хүүхдийн мэдээллийг үзэхийн тулд энэ хичээлийн жилийн хандалтын төлбөрийг төлнө үү.",
      );
    }
    if (blocked === "soloStaff") {
      throw new PaymentRequiredException(
        "Энэ хүүхдийн эцэг эх хандалтын төлбөрөө төлөөгүй байна. Төлбөр төлөгдсөний дараа хүүхдийн бүртгэл, ажиглалт нээгдэнэ.",
      );
    }
  }

  /**
   * Throws 404 unless the actor is this child's own guardian — and 402 if the
   * portal fee is due, exactly as reading the child would.
   *
   * ★ Narrower than `assertCanAccess`, which also admits the child's teacher
   * and the kindergarten's admin. Some things only a family may do on a
   * child's behalf — writing to the administration as that child's parent
   * (`FeedbackService.create`) is one — and a person who is PARENT somewhere
   * and ADMIN here must not pass by holding the wrong role in the right place.
   */
  async assertIsGuardian(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts || !isGuardianOf(actor, facts)) throw new NotFoundException();
    await this.assertFeePaid(actor, facts);
    return facts;
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
   * Throws 404 unless the actor may write about this child — and, unlike
   * `assertCanRecord`, does **not** stop a solo teacher whose family has not
   * paid yet: inviting that family is how the fee ever gets paid (the user,
   * 2026-10-11). A guardian is still gated as on every other route.
   */
  async assertCanInviteGuardian(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts || !canRecordForChild(actor, facts)) throw new NotFoundException();
    await this.assertFeePaid(actor, facts, { gateSoloStaff: false });
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

  /**
   * The per-purpose reads and writes of the PE/music teacher and the doctor
   * (2026-10-15). Each is the existing rule *plus* that role, never a role on
   * its own — and every one goes through the same fee gate as the rest.
   */

  /** The child's card: readers, a specialist of their group, the doctor. */
  async assertCanReadCard(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    return this.assertGated(actor, childId, canReadChildCard);
  }

  /** Observations about the child: readers plus a specialist of their group. */
  async assertCanReadObservations(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    return this.assertGated(actor, childId, canReadObservations);
  }

  /**
   * Reading observations, for the list and the detail only: everyone
   * `assertCanReadObservations` admits, **plus** a teacher of a group the child
   * has left, who reads the staff notes they wrote and nothing else
   * (`isFormerTeacherOf`, the user 2026-10-16). `onlyOwn` tells the caller to
   * narrow the read to those notes.
   *
   * ★ Never the check for anything that writes, nor for `listTypes` — a
   * previous teacher's reach is these two reads.
   */
  async assertCanReadObservationsOrOwn(
    actor: Actor,
    childId: string,
  ): Promise<{ facts: ChildAccessFacts; onlyOwn: boolean }> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts) throw new NotFoundException();
    const full = canReadObservations(actor, facts);
    if (!full && !isFormerTeacherOf(facts)) throw new NotFoundException();
    await this.assertFeePaid(actor, facts);
    return { facts, onlyOwn: !full };
  }

  /** Filing or editing a staff observation: writers plus a specialist. */
  async assertCanObserve(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    return this.assertGated(actor, childId, canObserveChild);
  }

  /** The health record: readers plus the doctor. */
  async assertCanReadHealth(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    return this.assertGated(actor, childId, canReadChildHealth);
  }

  /** Writing the health record: writers plus the doctor. */
  async assertCanRecordHealth(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    return this.assertGated(actor, childId, canRecordChildHealth);
  }

  /** The health routes a family also writes to: contributors plus the doctor. */
  async assertCanContributeHealth(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    return this.assertGated(actor, childId, canContributeChildHealth);
  }

  private async assertGated(
    actor: Actor,
    childId: string,
    allowed: (actor: Actor, facts: ChildAccessFacts) => boolean,
  ): Promise<ChildAccessFacts> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts || !allowed(actor, facts)) throw new NotFoundException();
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
   * Throws 404 unless the actor may archive this child — `canArchiveChild`.
   * No fee gate: an unpaid child in a solo teacher's workspace must still be
   * removable by the teacher who added them.
   */
  async assertCanArchive(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts || !canArchiveChild(actor, facts)) throw new NotFoundException();
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
