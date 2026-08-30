import { Injectable, NotFoundException } from "@nestjs/common";
import type { Actor } from "./actor";
import { hasRoleIn } from "./actor";
import { Role } from "../domain/enums";

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
    const ok = actor.memberships.some(
      (m) =>
        m.kindergartenId === kindergartenId &&
        (m.role === Role.ACCOUNTANT || m.role === Role.ADMIN),
    );
    if (!ok) throw new NotFoundException();
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

  /** Every kindergarten the actor belongs to, in any role. */
  memberKindergartenIds(actor: Actor): string[] {
    return [...new Set(actor.memberships.map((m) => m.kindergartenId))];
  }
}
