import { Role } from "../domain/enums";

/**
 * The authenticated user, as every authorization decision sees them.
 *
 * Built fresh from the database on each request by `ActorService`. It is
 * deliberately NOT reconstructed from the JWT: the token carries only `userId`
 * and `sessionId`, so revoking a teacher's group assignment or a parent's
 * guardianship takes effect on the next request rather than whenever the token
 * happens to expire. CLAUDE.md §1.3.
 */
export interface Actor {
  readonly userId: string;
  readonly sessionId: string;
  readonly memberships: readonly ActorMembership[];
}

export interface ActorMembership {
  readonly id: string;
  readonly kindergartenId: string;
  readonly role: Role;
}

/** Kindergartens where the actor holds an active membership of any role. */
export function actorKindergartenIds(actor: Actor): string[] {
  return unique(actor.memberships.map((m) => m.kindergartenId));
}

/** Kindergartens where the actor holds a specific role. */
export function kindergartenIdsForRole(actor: Actor, role: Role): string[] {
  return unique(actor.memberships.filter((m) => m.role === role).map((m) => m.kindergartenId));
}

export function hasRole(actor: Actor, role: Role): boolean {
  return actor.memberships.some((m) => m.role === role);
}

export function hasRoleIn(actor: Actor, role: Role, kindergartenId: string): boolean {
  return actor.memberships.some((m) => m.role === role && m.kindergartenId === kindergartenId);
}

/** Membership ids for the actor's teacher roles — the join into GroupTeacher. */
export function teacherMembershipIds(actor: Actor): string[] {
  return actor.memberships.filter((m) => m.role === Role.TEACHER).map((m) => m.id);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
