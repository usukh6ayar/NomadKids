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
  /**
   * The kind of the child's current kindergarten — only the portal-fee gate
   * reads it (a solo teacher's workspace gates its staff too; see
   * `portal-access.ts`). Never an input to *who may reach* the child.
   */
  readonly childKindergartenKind: "CONTRACTED" | "SOLO_TEACHER";
  /** Every enrollment ever, including ended ones. Order irrelevant. */
  readonly enrollments: readonly EnrollmentFact[];
  /** Guardianships that are not soft-deleted. `canView` may be false. */
  readonly guardianships: readonly GuardianshipFact[];
  /**
   * Group ids the actor is actively assigned to teach (`endedOn IS NULL`,
   * not soft-deleted), restricted to their teacher memberships.
   */
  readonly actorActiveTeachingGroupIds: readonly string[];
  /**
   * Group ids the actor is actively assigned to as a PE or music teacher
   * (`GroupSpecialist`, restricted to PE_TEACHER/MUSIC_TEACHER memberships).
   * ★ A separate list on purpose: nothing that reads the teaching list may
   * ever see these — see `isAssignedSpecialistOf`.
   */
  readonly actorActiveSpecialistGroupIds: readonly string[];
}

export interface EnrollmentFact {
  readonly groupId: string;
  readonly kindergartenId: string;
  /**
   * `status = ACTIVE` — the child attends this group now. A teacher's and a
   * specialist's reach reads it (D2 reversed, 2026-10-16); an admin's does not.
   */
  readonly active: boolean;
}

export interface GuardianshipFact {
  readonly guardianUserId: string;
  readonly canView: boolean;
}

/**
 * Every kindergarten this child has ever been enrolled in.
 *
 * ★ The admin chain's set (and the accountant's and the doctor's). Deriving it
 * from enrollment *history* rather than `Child.kindergartenId` means a
 * kindergarten keeps the records it made after the child moves on. A teacher's
 * reach no longer reads this history — see `isAssignedTeacherOf`.
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

/** Does any of these groups hold an enrollment of the child, active or ended? */
function holdsEnrollment(
  facts: ChildAccessFacts,
  groupIds: readonly string[],
  which: "active" | "ended",
): boolean {
  if (groupIds.length === 0) return false;
  const assigned = new Set(groupIds);
  return facts.enrollments.some(
    (e) => assigned.has(e.groupId) && e.active === (which === "active"),
  );
}

/**
 * Is this actor a teacher currently assigned to the group the child attends
 * **now**?
 *
 * ★ The child's ACTIVE enrollment only — the user, 2026-10-16, reversing
 * SECURITY.md D2. Reading the whole history let the previous group's teacher
 * keep seeing every new note, health record and photograph for as long as
 * they stayed assigned to that group. What a previous teacher keeps is the
 * observations they wrote — `isFormerTeacherOf`, and nothing else.
 *
 * Revocation works because `actorActiveTeachingGroupIds` excludes assignments
 * with `endedOn` set. ★★ `visibleChildrenWhere` is this predicate's
 * list-shaped twin; `authz-consistency.test.ts` keeps them identical.
 */
export function isAssignedTeacherOf(facts: ChildAccessFacts): boolean {
  return holdsEnrollment(facts, facts.actorActiveTeachingGroupIds, "active");
}

/**
 * Did this actor teach the child — assigned (still) to a group whose
 * enrollment of the child has ended — without teaching them now?
 *
 * Grants exactly one thing: reading the observations this actor wrote
 * (`ChildAccessService.assertCanReadObservationsOrOwn`). Never part of any
 * other predicate.
 */
export function isFormerTeacherOf(facts: ChildAccessFacts): boolean {
  if (isAssignedTeacherOf(facts) || isAssignedSpecialistOf(facts)) return false;
  return (
    holdsEnrollment(facts, facts.actorActiveTeachingGroupIds, "ended") ||
    holdsEnrollment(facts, facts.actorActiveSpecialistGroupIds, "ended")
  );
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
 * Is this actor a PE or music teacher currently assigned to the group the
 * child attends now? The same ACTIVE-enrollment rule as `isAssignedTeacherOf`.
 *
 * ★ Never part of `canAccessChild` or `canRecordForChild`. Those two gate
 * the register, the health record, the meal register, the portfolio — the
 * client's answer (2026-10-15) was a specialist sees their groups' children
 * and writes observations, and nothing else. Each route they need names
 * them through a predicate below; every other route refuses them by default.
 */
export function isAssignedSpecialistOf(facts: ChildAccessFacts): boolean {
  return holdsEnrollment(facts, facts.actorActiveSpecialistGroupIds, "active");
}

/**
 * Is this actor the doctor of a kindergarten the child belongs to?
 *
 * Kindergarten-wide, like the accountant — a doctor sees every child, not a
 * group. ★ Never part of `canAccessChild`: an эмч reads the health record
 * and nothing of the development record (А/261 Annex 2 §1 #11).
 */
export function isDoctorOver(actor: Actor, facts: ChildAccessFacts): boolean {
  const childKgs = childKindergartenIds(facts);
  return kindergartenIdsForRole(actor, Role.DOCTOR).some((id) => childKgs.has(id));
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
 * delete a photograph or edit metadata on a photograph somebody else
 * uploaded — `canRecordForChild` still governs both, and the reference cases
 * `test_delete_refuses_the_childs_own_guardian` and
 * `test_a_guardian_cannot_edit_their_own_child` still hold.
 *
 * ★★★ The **profile picture** moved here on 2026-09-24, at the client's
 * request. It is a choice *among photographs this family may already see*,
 * made from their own child's card, and it writes one id on the child row —
 * not an edit of the record's facts, which stays staff-only. See
 * `MediaService.setAsChildPhoto` and `docs/SECURITY.md` §6.6.
 *
 * The reference system refused guardian uploads outright. That behaviour is
 * overridden here on purpose: the RFP is the final authority (CLAUDE.md
 * precedence) and it is explicit.
 */
export function canContributeMediaForChild(actor: Actor, facts: ChildAccessFacts): boolean {
  return canRecordForChild(actor, facts) || isGuardianOf(actor, facts);
}

/**
 * ★ May this actor open this child's card — name, group, photo?
 *
 * Everyone who reads the child, plus the two roles who reach a child for one
 * purpose: a group's PE/music teacher and the kindergarten's doctor. What the
 * card *contains* differs — `seesFullChildCard` decides that.
 */
export function canReadChildCard(actor: Actor, facts: ChildAccessFacts): boolean {
  return (
    canAccessChild(actor, facts) || isAssignedSpecialistOf(facts) || isDoctorOver(actor, facts)
  );
}

/**
 * Whether the card carries everything — guardians' contacts, the national id,
 * `healthNotes`. A specialist's card does not: a PE teacher has no health
 * reach, and `healthNotes` is health.
 */
export function seesFullChildCard(actor: Actor, facts: ChildAccessFacts): boolean {
  return canAccessChild(actor, facts) || isDoctorOver(actor, facts);
}

/** May this actor read observations about this child? Readers plus specialists. */
export function canReadObservations(actor: Actor, facts: ChildAccessFacts): boolean {
  return canAccessChild(actor, facts) || isAssignedSpecialistOf(facts);
}

/** What `canReadChildFile` needs to know about one of the child's files. */
export interface ChildFileFact {
  /** It is the child's current profile photograph — the card's photo. */
  readonly isProfilePhoto: boolean;
  /** It is attached to an observation, and who filed that observation. */
  readonly observation: { readonly authorId: string | null; readonly source: string } | null;
}

/**
 * ★ May this actor open this one file of the child's (`GET /media/:id`)?
 *
 * Everyone who reads the child — and three narrower readers, each to the
 * file their own reach already shows them (2026-10-16, ultra review of #231
 * and #235; until then all three got 404 for pictures their screens drew):
 *
 *  - the card's readers (a PE/music teacher, the doctor) — the profile
 *    photograph only, never the album;
 *  - a group's PE/music teacher — the photographs on observations, which
 *    `canReadObservations` already gives them;
 *  - a teacher the child has left — the photographs on the staff notes they
 *    filed themselves, the one thing `isFormerTeacherOf` grants.
 *
 * A guardian's narrower view of observation photos is the caller's second
 * check (`MediaRepository.isVisibleToGuardian`), as before.
 */
export function canReadChildFile(
  actor: Actor,
  facts: ChildAccessFacts,
  file: ChildFileFact,
): boolean {
  if (canAccessChild(actor, facts)) return true;
  if (file.isProfilePhoto && canReadChildCard(actor, facts)) return true;
  if (file.observation && isAssignedSpecialistOf(facts)) return true;
  return (
    file.observation !== null &&
    file.observation.source === "TEACHER" &&
    file.observation.authorId === actor.userId &&
    isFormerTeacherOf(facts)
  );
}

/**
 * May this actor file (or edit their own) staff observation about this child?
 * Writers plus specialists — not the doctor, and not a guardian, who has a
 * route of their own.
 */
export function canObserveChild(actor: Actor, facts: ChildAccessFacts): boolean {
  return canRecordForChild(actor, facts) || isAssignedSpecialistOf(facts);
}

/**
 * May this actor edit or archive an existing staff observation as staff?
 *
 * A writer may change any note they can reach; a specialist only a note they
 * filed themselves — the class teacher's notes are not theirs to rewrite.
 */
export function canEditObservationAsStaff(
  actor: Actor,
  facts: ChildAccessFacts,
  observation: { readonly authorId: string | null; readonly source: string },
): boolean {
  if (canRecordForChild(actor, facts)) return true;
  return (
    isAssignedSpecialistOf(facts) &&
    observation.source === "TEACHER" &&
    observation.authorId === actor.userId
  );
}

/** May this actor read this child's health record? Readers plus the doctor. */
export function canReadChildHealth(actor: Actor, facts: ChildAccessFacts): boolean {
  return canAccessChild(actor, facts) || isDoctorOver(actor, facts);
}

/** May this actor write this child's health record? Writers plus the doctor. */
export function canRecordChildHealth(actor: Actor, facts: ChildAccessFacts): boolean {
  return canRecordForChild(actor, facts) || isDoctorOver(actor, facts);
}

/**
 * The health routes a family may also write to — a medication request with
 * its photograph, a measurement taken at home. `canContributeMediaForChild`
 * plus the doctor.
 */
export function canContributeChildHealth(actor: Actor, facts: ChildAccessFacts): boolean {
  return canContributeMediaForChild(actor, facts) || isDoctorOver(actor, facts);
}

/**
 * May this actor administer this child — transfers, guardianship changes,
 * enrollment edits? Admins — and, in a solo workspace, its teacher.
 */
export function canAdministerChild(actor: Actor, facts: ChildAccessFacts): boolean {
  return isAdminOver(actor, facts) || isSoloTeacherOver(actor, facts);
}

/**
 * ★ Is this actor the teacher of the solo workspace the child belongs to?
 *
 * A solo workspace has no director (TEACHER only since 2026-10-14), so the
 * administrator's acts on a child — linking or revoking a guardian, enrolling,
 * ending an enrolment — had nobody to do them: an invitation sent to the
 * wrong person could not be taken back. The user, 2026-10-16: the teacher
 * does them. Their own workspace only; a contracted kindergarten's teacher
 * never passes.
 */
export function isSoloTeacherOver(actor: Actor, facts: ChildAccessFacts): boolean {
  if (facts.childKindergartenKind !== "SOLO_TEACHER") return false;
  if (!childKindergartenIds(facts).has(facts.childKindergartenId)) return false;
  return hasRoleIn(actor, Role.TEACHER, facts.childKindergartenId);
}

/**
 * ★ May this actor archive (soft-delete) this child? An admin of theirs, or a
 * teacher of the group the child attends **now** — the user, 2026-10-14:
 * «Устгах» in the teacher's own roster. Since 2026-10-16 that is exactly
 * `isAssignedTeacherOf`, which reads the ACTIVE enrollment only.
 */
export function canArchiveChild(actor: Actor, facts: ChildAccessFacts): boolean {
  return isAdminOver(actor, facts) || isAssignedTeacherOf(facts);
}

/**
 * Does this actor administer this specific kindergarten? Used for
 * kindergarten-scoped resources that are not attached to a child — groups,
 * school years, configuration.
 */
export function canAdministerKindergarten(actor: Actor, kindergartenId: string): boolean {
  return hasRoleIn(actor, Role.ADMIN, kindergartenId);
}
