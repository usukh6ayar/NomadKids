import { Role } from "../domain/enums";
import { Actor, hasRoleIn, kindergartenIdsForRole } from "./actor";

/**
 * ★ The most important logic in the system.
 *
 * Pure functions, no database access — the caller loads the facts, these decide.
 * That split exists so the rules can be tested exhaustively without fixtures,
 * and so there is exactly one place where "may this person see this child" is
 * answered. If this logic existed in two places, the web app and the future
 * mobile client would eventually disagree, and RFP §21 would fail.
 *
 * docs/SECURITY.md §5.
 */

/** The child facts an access decision needs. Loaded by ChildAccessService. */
export interface ChildAccessFacts {
  readonly childId: string;
  /**
   * The denormalised "currently attending" pointer. Consulted ONLY when the
   * child has no enrollments at all — see `childKindergartenIds`.
   */
  readonly childKindergartenId: string;
  /** Every enrollment ever, including ended ones. Order irrelevant. */
  readonly enrollments: readonly EnrollmentFact[];
  /** Guardianships that are not soft-deleted. `canView` may be false. */
  readonly guardianships: readonly GuardianshipFact[];
  /**
   * Group ids the actor is actively assigned to teach (`endedOn IS NULL`,
   * not soft-deleted), restricted to their teacher memberships.
   */
  readonly actorActiveTeachingGroupIds: readonly string[];
}

export interface EnrollmentFact {
  readonly groupId: string;
  readonly kindergartenId: string;
}

export interface GuardianshipFact {
  readonly guardianUserId: string;
  readonly canView: boolean;
}

/**
 * Every kindergarten this child has ever been enrolled in.
 *
 * ★ This is the function that makes a transfer safe. Deriving the set from
 * enrollment *history* rather than `Child.kindergartenId` means a teacher keeps
 * access to the observations they wrote themselves after the child moves on.
 *
 * **The one exception**, kept deliberately (D8): a child with *no enrollments
 * at all* falls back to `childKindergartenId`, so the staff who just registered
 * a child are not locked out of the record they are still filling in.
 *
 * Two properties of that exception matter, and both are tested:
 *
 *  - The trigger is `enrollments.length === 0`, **not** "no active enrollment".
 *    Using the latter would silently re-grant the current kindergarten access
 *    to every archived child — a far wider hole that looks nearly identical in
 *    review.
 *  - It is a fallback, never an addition. The two sets are never unioned, so it
 *    cannot widen access for a child that has history.
 */
export function childKindergartenIds(facts: ChildAccessFacts): Set<string> {
  if (facts.enrollments.length > 0) {
    return new Set(facts.enrollments.map((e) => e.kindergartenId));
  }
  return new Set([facts.childKindergartenId]);
}

/** Is this actor an active guardian of this child, with viewing rights? */
export function isGuardianOf(actor: Actor, facts: ChildAccessFacts): boolean {
  return facts.guardianships.some((g) => g.guardianUserId === actor.userId && g.canView);
}

/**
 * Is this actor a teacher currently assigned to a group the child is (or was)
 * enrolled in?
 *
 * Reads the child's whole enrollment history, so a teacher does not lose their
 * own records when a child changes group. Revocation works because
 * `actorActiveTeachingGroupIds` excludes assignments with `endedOn` set.
 */
export function isAssignedTeacherOf(facts: ChildAccessFacts): boolean {
  if (facts.actorActiveTeachingGroupIds.length === 0) return false;
  const assigned = new Set(facts.actorActiveTeachingGroupIds);
  return facts.enrollments.some((e) => assigned.has(e.groupId));
}

/** Is this actor an admin of a kindergarten the child belongs to? */
export function isAdminOver(actor: Actor, facts: ChildAccessFacts): boolean {
  const childKgs = childKindergartenIds(facts);
  return kindergartenIdsForRole(actor, Role.ADMIN).some((id) => childKgs.has(id));
}

/** Is this actor an accountant of a kindergarten the child belongs to? */
export function isAccountantOver(actor: Actor, facts: ChildAccessFacts): boolean {
  const childKgs = childKindergartenIds(facts);
  return kindergartenIdsForRole(actor, Role.ACCOUNTANT).some((id) => childKgs.has(id));
}

/**
 * ★ May this actor READ this child's record?
 *
 * The three chains of docs/SECURITY.md §5.1, and nothing else. A role alone is
 * never sufficient: being a teacher lets you use teacher screens, not see every
 * child.
 */
export function canAccessChild(actor: Actor, facts: ChildAccessFacts): boolean {
  return isGuardianOf(actor, facts) || isAssignedTeacherOf(facts) || isAdminOver(actor, facts);
}

/**
 * ★ May this actor read this child's MONEY — invoices, payment history, balance?
 *
 * A second axis from `canAccessChild`, deliberately not built from it.
 * `FINANCE_SCOPE.md` §4.6 / нэмэлт.md §13: an accountant needs every child's
 * invoice but no developmental record, and a teacher — who legitimately passes
 * `canAccessChild` for their own group — needs the opposite: "Багш санхүүгийн
 * бүрэн мэдээллийг харах эрхгүй байна". `isAssignedTeacherOf` is absent from
 * this predicate on purpose; adding it back is the mistake this comment exists
 * to catch. A guardian keeps their access — the money is theirs to owe.
 */
export function canViewChildFinance(actor: Actor, facts: ChildAccessFacts): boolean {
  return isGuardianOf(actor, facts) || isAdminOver(actor, facts) || isAccountantOver(actor, facts);
}

/**
 * ★ May this actor WRITE about this child — observations, assessments, profile
 * edits, media?
 *
 * Deliberately narrower than reading. A guardian may read their own child's
 * portfolio and submit a parent observation through a dedicated endpoint, but
 * may not edit the child record, assess, upload to the gallery, or delete
 * anything. The reference suite tests this repeatedly:
 * `test_a_guardian_cannot_edit_their_own_child`,
 * `test_delete_refuses_the_childs_own_guardian`.
 */
export function canRecordForChild(actor: Actor, facts: ChildAccessFacts): boolean {
  return isAssignedTeacherOf(facts) || isAdminOver(actor, facts);
}

/**
 * ★ May this actor add a photograph to this child's album?
 *
 * Wider than `canRecordForChild` and narrower than nothing: **staff, plus this
 * child's own guardians.**
 *
 * RFP §2.3 gives a family "хүүхдийн зураг болон зургийн цомог үүсгэх" in as many
 * words, and §4.4 classifies a photograph as the teacher's, the parent's or
 * joint — a distinction that cannot arise if only staff may upload. The album is
 * a family record, the same argument that makes the portfolio writable by
 * guardians (`portfolio-fields.ts`).
 *
 * ★★ This deliberately does NOT widen anything else. A guardian still may not
 * delete a photograph, set the profile picture, or edit metadata on a
 * photograph somebody else uploaded — `canRecordForChild` still governs all
 * three, and the reference cases `test_delete_refuses_the_childs_own_guardian`
 * and `test_a_guardian_cannot_edit_their_own_child` still hold.
 *
 * The reference system refused guardian uploads outright. That behaviour is
 * overridden here on purpose: the RFP is the final authority (CLAUDE.md
 * precedence) and it is explicit.
 */
export function canContributeMediaForChild(actor: Actor, facts: ChildAccessFacts): boolean {
  return canRecordForChild(actor, facts) || isGuardianOf(actor, facts);
}

/**
 * May this actor administer this child — transfers, guardianship changes,
 * enrollment edits? Admins only.
 */
export function canAdministerChild(actor: Actor, facts: ChildAccessFacts): boolean {
  return isAdminOver(actor, facts);
}

/**
 * Does this actor administer this specific kindergarten? Used for
 * kindergarten-scoped resources that are not attached to a child — groups,
 * school years, configuration.
 */
export function canAdministerKindergarten(actor: Actor, kindergartenId: string): boolean {
  return hasRoleIn(actor, Role.ADMIN, kindergartenId);
}
