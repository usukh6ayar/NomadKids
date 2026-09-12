import { Injectable, NotFoundException } from "@nestjs/common";
import type { Actor } from "./actor";
import { hasRoleIn } from "./actor";
import { Role } from "../domain/enums";
import { AuthzRepository } from "./authz.repository";

/**
 * Authorization for kindergarten-scoped resources — groups, school years,
 * users, configuration. The counterpart to `ChildAccessService`, which covers
 * child-scoped ones.
 *
 * Both throw **404**. See docs/SECURITY.md §5.4 for why the rule is uniform
 * rather than 403-for-role-gates: two rules cannot be applied consistently
 * across dozens of endpoints, and the difference between the codes is exactly
 * what an attacker enumerates.
 *
 * Every method takes the kindergarten id from the **resource**, never from the
 * request. A handler that passes a body-supplied id has not authorized
 * anything — it has asked the caller to authorize themselves.
 */
@Injectable()
export class TenantAccessService {
  constructor(private readonly repo: AuthzRepository) {}

  /** Throws 404 unless the actor administers this kindergarten. */
  assertAdmin(actor: Actor, kindergartenId: string): void {
    if (!hasRoleIn(actor, Role.ADMIN, kindergartenId)) throw new NotFoundException();
  }

  /**
   * Throws 404 unless the actor holds any active membership here.
   *
   * Enough for reading kindergarten-level reference data — the group list, the
   * current school year, the development domains — which teachers and parents
   * legitimately need to render anything at all.
   */
  assertMember(actor: Actor, kindergartenId: string): void {
    if (!actor.memberships.some((m) => m.kindergartenId === kindergartenId)) {
      throw new NotFoundException();
    }
  }

  /** Throws 404 unless the actor is a teacher or an admin here. */
  assertStaff(actor: Actor, kindergartenId: string): void {
    const ok = actor.memberships.some(
      (m) =>
        m.kindergartenId === kindergartenId && (m.role === Role.TEACHER || m.role === Role.ADMIN),
    );
    if (!ok) throw new NotFoundException();
  }

  /**
   * Throws 404 unless the actor may work on the kitchen's records here.
   *
   * ★ A predicate of its own rather than widening `assertStaff`.
   *
   * `assertStaff` means TEACHER or ADMIN and gates the teacher's whole
   * surface — notices, observations, a child's development record. A cook
   * needs the weekly menu and the meal register; adding COOK to `assertStaff`
   * to give them that would also give them every child's file, because a
   * hundred call sites read "staff" as "may do the teaching work".
   *
   * The teacher keeps the menu too: they serve it and they mark who ate.
   */
  assertCanManageMeals(actor: Actor, kindergartenId: string): void {
    const ok = actor.memberships.some(
      (m) =>
        m.kindergartenId === kindergartenId &&
        (m.role === Role.COOK || m.role === Role.TEACHER || m.role === Role.ADMIN),
    );
    if (!ok) throw new NotFoundException();
  }

  /**
   * Throws 404 unless the actor may **write** the weekly menu.
   *
   * ★ COOK and TEACHER only — narrower than `assertCanManageMeals`, which stays
   * COOK/TEACHER/ADMIN and is what *reading* the menu with its allergy warnings
   * goes through.
   *
   * Client, 2026-09-11: "Багш болон тогооч засаж болдог … нягтлан, удирдлага,
   * эцэг эх оруулсан цэсүүдийг зүгээр харна." A director reads the week and its
   * warnings and no longer edits it; the people who cook the food and the people
   * who serve it are the two who enter it.
   *
   * ★★ This is a capability an ADMIN used to have and now does not, which is
   * the kind of change that gets quietly reverted by the next person who reads
   * `assertCanManageMeals` and assumes the two should match. They should not:
   * one answers "may you see what is being served", the other "may you decide".
   *
   * Approving (`assertCanManageKitchen`, COOK/ADMIN) is untouched — signing off
   * what the kitchen is about to cook is a different act from planning it, and
   * the client's sentence was about who enters the menu.
   */
  assertCanEditMenu(actor: Actor, kindergartenId: string): void {
    const ok = actor.memberships.some(
      (m) =>
        m.kindergartenId === kindergartenId && (m.role === Role.COOK || m.role === Role.TEACHER),
    );
    if (!ok) throw new NotFoundException();
  }

  /**
   * Throws 404 unless the actor may manage the kitchen's production data —
   * ingredients, technology cards, suppliers, food orders and stock.
   *
   * ★ Narrower than `assertCanManageMeals`, deliberately.
   *
   * The weekly menu is a shared screen — the teacher who serves a dish
   * answers for it too, so `assertCanManageMeals` admits TEACHER. Ingredients,
   * recipes, suppliers, orders and the stock ledger are the kitchen's own
   * production data — nobody outside it needs to see what a sack of flour
   * cost or how much sits in the store room, and the client's own line for
   * this role was "шинээр хэт их эрх олгохгүй" (`meals.service.ts`). COOK or
   * ADMIN only.
   */
  assertCanManageKitchen(actor: Actor, kindergartenId: string): void {
    const ok = actor.memberships.some(
      (m) => m.kindergartenId === kindergartenId && (m.role === Role.COOK || m.role === Role.ADMIN),
    );
    if (!ok) throw new NotFoundException();
  }

  /**
   * Throws 404 unless the actor may read this kindergarten's money.
   *
   * ★ **This kindergarten's**, which is the distinction the role turns on.
   *
   * `/kindergartens/:id/funding` is one kindergarten's tariffs, monthly
   * calculation and what the state actually paid — the accountant's job.
   * `/platform/revenue` is the operator's income across every kindergarten and
   * how the partners divide it, and it stays behind `isSuperAdmin`
   * (`PlatformAccessService`): an accountant employed by one kindergarten has
   * no business reading another's takings, let alone the platform's.
   *
   * The admin keeps it: they had it before this role existed and the client
   * asked for existing permissions to be left alone.
   */
  assertCanReadFinance(actor: Actor, kindergartenId: string): void {
    if (!this.canReadFinance(actor, kindergartenId)) throw new NotFoundException();
  }

  /**
   * The same question as a boolean, for the places that must branch rather
   * than throw.
   *
   * ★ Added for invoicing (`нэмэлт.md` §7, §8), where one endpoint serves two
   * audiences: an accountant listing a month's invoices, and a parent opening
   * their own child's. The parent's path cannot use `assertCanReadFinance` —
   * they are not staff — so the invoice service asks this first and falls back
   * to `ChildAccessService` for the guardian chain. Exposing the predicate is
   * what keeps that decision inside `authz/` (CLAUDE.md §1.1) instead of a
   * service re-deriving "is this person an accountant" from `memberships`.
   */
  canReadFinance(actor: Actor, kindergartenId: string): boolean {
    return actor.memberships.some(
      (m) =>
        m.kindergartenId === kindergartenId &&
        (m.role === Role.ACCOUNTANT || m.role === Role.ADMIN),
    );
  }

  /**
   * Throws 404 unless the actor may **change** this kindergarten's money —
   * issue an invoice, record a payment, reverse one.
   *
   * ★ Identical to `canReadFinance` today, and deliberately a separate method.
   *
   * `нэмэлт.md` §13 lists the accountant's surface as read-and-write, so both
   * predicates currently name ACCOUNTANT and ADMIN. They are split because the
   * next narrowing anybody asks for is on this side — "an accountant may raise
   * an invoice but only an admin may reverse a payment" is exactly the kind of
   * rule a kindergarten adds after its first mistaken refund. With one shared
   * method that change means auditing every call site to work out which ones
   * meant *write*; with two it is a one-line edit here.
   */
  assertCanManageFinance(actor: Actor, kindergartenId: string): void {
    const ok = actor.memberships.some(
      (m) =>
        m.kindergartenId === kindergartenId &&
        (m.role === Role.ACCOUNTANT || m.role === Role.ADMIN),
    );
    if (!ok) throw new NotFoundException();
  }

  /**
   * Whether the actor may read a member of staff's own file — experience,
   * certificates, grades. Order А/261, criterion 51.
   *
   * ★ **A predicate, not an assertion, because two audiences reach it.**
   *
   * The kindergarten's administrator reads anybody's file: they typed it, they
   * report it to the ministry, and they answer for it. A member of staff reads
   * their **own** and nobody else's — a teacher has no business knowing which
   * grade the teacher next door holds, and "everyone is staff, so everyone
   * sees it" is how a personnel file becomes a staff-room noticeboard.
   *
   * Split from `assertStaff` for exactly that reason: this is the one place
   * where "is a colleague" is not the question and "is this person" is.
   */
  canReadStaffRecords(actor: Actor, kindergartenId: string, subjectUserId: string): boolean {
    if (actor.userId === subjectUserId) {
      // Still scoped: a person reads their own file *at a kindergarten they
      // belong to*, so a stale id in a URL cannot fetch a record filed by an
      // employer they have since left.
      return actor.memberships.some((m) => m.kindergartenId === kindergartenId);
    }
    return this.isAdmin(actor, kindergartenId);
  }

  assertCanReadStaffRecords(actor: Actor, kindergartenId: string, subjectUserId: string): void {
    if (!this.canReadStaffRecords(actor, kindergartenId, subjectUserId)) {
      throw new NotFoundException();
    }
  }

  /**
   * Throws 404 unless the actor may **write** a staff file.
   *
   * ★ Administrator only — deliberately narrower than reading it.
   *
   * Criterion 51 is about data the kindergarten submits to the ministry, and a
   * record somebody wrote about themselves is not evidence of anything. A
   * teacher who has earned a new grade brings the certificate to the office;
   * the administrator records it and can be asked what they saw. This is the
   * same split `createAllergy` makes between who is told and who records.
   */
  assertCanManageStaffRecords(actor: Actor, kindergartenId: string): void {
    if (!this.isAdmin(actor, kindergartenId)) throw new NotFoundException();
  }

  /**
   * Throws 404 unless the actor may address this audience — a notice board
   * post, a survey, anything published *to* families.
   *
   * ★ A teacher writes to their own groups. Only an administrator writes to
   * the kindergarten. Client, 2026-09-10: "багш зөвхөн өөрийн бүлэгтээ л пост
   * оруулна ... Удирдлага л бүх цэцэрлэг болон бүлэг сонгон судалгаа болон
   * пост оруулж болно."
   *
   * ★★ Here, not in the two services that call it.
   *
   * Notices and surveys are the same rule twice, and §1.1 is the reason this
   * is one method rather than two: two copies of "may this person write to
   * that audience" would answer differently the first time either is edited,
   * and a teacher would keep a route into the whole kindergarten through
   * whichever one was missed.
   *
   * ★★★ An empty audience is the kindergarten, and that is what makes the
   * `null` case load-bearing rather than a tidy-up.
   *
   * Both models say "no target rows means everyone" — `targetSchema` for
   * notices, `Survey.groupId: null` for surveys. So a teacher who simply omits
   * the field is asking for the widest audience there is, and refusing it is
   * the whole rule. It cannot be enforced by narrowing the select on the
   * compose screen: the field is optional in both DTOs, and omitting it is
   * exactly what a request that skipped the screen would do.
   *
   * ★★★★ Async, and therefore this service's first DB read.
   *
   * "Which groups does this person teach" is not in the actor — §1.3 keeps
   * roles and kindergartens there and nothing else, because a `GroupTeacher`
   * row revoked this morning must take effect on this request rather than when
   * a token expires. `loadActiveTeachingGroupIds` is the same read the child
   * visibility filter already makes.
   */
  async assertCanAddressAudience(
    actor: Actor,
    kindergartenId: string,
    audience: { groupIds?: (string | null | undefined)[]; childIds?: string[] },
  ): Promise<void> {
    this.assertStaff(actor, kindergartenId);
    if (this.isAdmin(actor, kindergartenId)) return;

    const groupIds = audience.groupIds ?? [];
    const childIds = [...new Set(audience.childIds ?? [])];

    /*
      ★ Two ways to say "the whole kindergarten", and both are refused.

      A `null` group is how a survey says it (`Survey.groupId`); naming nothing
      at all is how a notice says it (`targetSchema`). Written as one condition
      because they are one request — and the second half is the one that would
      be missed: a loop over an empty list runs nothing and reads as if it had
      checked.
    */
    const wide = groupIds.some((id) => !id) || (groupIds.length === 0 && childIds.length === 0);
    if (wide) throw new NotFoundException();

    const teaching = await this.repo.loadActiveTeachingGroupIds(actor);
    const taught = new Set(teaching);

    for (const groupId of groupIds) {
      if (!taught.has(groupId!)) throw new NotFoundException();
    }

    /*
      ★ A named child is narrower than a group, so it is allowed — but only
      when the child is in a group this person actually teaches.

      Counted in one query rather than checked child by child: fifty targets
      would otherwise be fifty round trips (§3.4). A short count means at least
      one child is outside, which is all the caller needs to know.
    */
    if (childIds.length > 0) {
      const inside = await this.repo.countChildrenEnrolledInGroups(childIds, teaching);
      if (inside !== childIds.length) throw new NotFoundException();
    }
  }

  isAdmin(actor: Actor, kindergartenId: string): boolean {
    return hasRoleIn(actor, Role.ADMIN, kindergartenId);
  }

  /**
   * The kindergartens this actor administers.
   *
   * Returns `[]` rather than throwing, because list endpoints scope by it and
   * an empty scope correctly yields an empty list. A repository turning that
   * into `IN ()` matches nothing, which is the right answer — it must never be
   * "optimised" into omitting the filter.
   */
  adminKindergartenIds(actor: Actor): string[] {
    return [
      ...new Set(
        actor.memberships.filter((m) => m.role === Role.ADMIN).map((m) => m.kindergartenId),
      ),
    ];
  }

  /**
   * The kindergartens whose *whole* roster this actor may read — ADMIN and
   * ACCOUNTANT.
   *
   * ★ Added 2026-09-13. The accountant's own screens list every group by name
   * already: `/attendance/register` answers with a `groups` array and
   * `/funding` with a row per class. What they could not do was *choose* one,
   * because `listGroups` narrowed anybody who is not an admin of the
   * kindergarten to the groups they teach — and an accountant teaches none, so
   * the "Бүлэг" select on Ирцийн дэлгэрэнгүй was empty for the one role that
   * screen is built for.
   *
   * The plural of `canReadFinance`, and it lives here for the reason §1.1
   * gives: a service deriving "is this person an accountant" from
   * `memberships` is the second copy of an authorization rule.
   *
   * `[]` rather than a throw, like `adminKindergartenIds` above — a list
   * endpoint scoping by an empty set correctly yields an empty list, and that
   * filter must never be "optimised" into being omitted.
   */
  wholeRosterKindergartenIds(actor: Actor): string[] {
    return [
      ...new Set(
        actor.memberships
          .filter((m) => m.role === Role.ADMIN || m.role === Role.ACCOUNTANT)
          .map((m) => m.kindergartenId),
      ),
    ];
  }

  /** Every kindergarten the actor belongs to, in any role. */
  memberKindergartenIds(actor: Actor): string[] {
    return [...new Set(actor.memberships.map((m) => m.kindergartenId))];
  }
}
