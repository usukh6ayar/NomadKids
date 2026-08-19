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
