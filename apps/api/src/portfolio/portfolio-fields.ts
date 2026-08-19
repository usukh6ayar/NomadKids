/**
 * Field-level write rules for the portfolio.
 *
 * ★ Portfolio editing is gated by **read** access, not record access.
 *
 * That is deliberate and verified against the reference system: its
 * `save_about_me`, `save_age_profile` and `save_birthday_note` all call
 * `can_access_child`, not `can_record_for_child`. A guardian is *meant* to
 * contribute to their child's portfolio — it is a family record, not a
 * professional one. Applying the stricter `canRecordForChild` used elsewhere
 * would silently make every parent read-only and quietly remove a feature.
 *
 * Within that, one field-level rule survives from RFP §4.3: the parent's note
 * and the teacher's note are two separate voices in the record, and **neither
 * side may overwrite the other's**.
 */

/** Editable by anyone who can reach the child. */
export const ABOUT_ME_FIELDS = [
  "introduction",
  "nameMeaning",
  "memorableSayings",
  "dream",
  "distinguishingTraits",
  "heightCm",
  "weightKg",
  "recordedOn",
] as const;

/** Age-profile fields both sides may write. */
export const SHARED_AGE_FIELDS = [
  "favoriteColor",
  "favoriteFood",
  "favoriteToy",
  "favoriteBook",
  "favoriteSong",
  "favoriteStory",
  "favoriteActivity",
  "personality",
  "emotionalTraits",
  "familyMembers",
  "learningInterest",
  "newSkills",
] as const;

/** Guardians only. */
export const PARENT_ONLY_AGE_FIELDS = ["parentNote"] as const;

/** Teachers and admins only. */
export const TEACHER_ONLY_AGE_FIELDS = ["teacherNote"] as const;

export type AgeProfileField =
  | (typeof SHARED_AGE_FIELDS)[number]
  | (typeof PARENT_ONLY_AGE_FIELDS)[number]
  | (typeof TEACHER_ONLY_AGE_FIELDS)[number];

/**
 * Which age-profile fields this actor may write.
 *
 * The guardian branch is chosen by *relationship to this child*, not by role:
 * a teacher whose own child attends the same kindergarten writes the parent
 * note for their own child and the teacher note for everyone else's. Keying
 * off `Role.PARENT` instead would get that backwards.
 */
export function editableAgeProfileFields(isGuardian: boolean): Set<string> {
  const fields = new Set<string>(SHARED_AGE_FIELDS);
  for (const field of isGuardian ? PARENT_ONLY_AGE_FIELDS : TEACHER_ONLY_AGE_FIELDS) {
    fields.add(field);
  }
  return fields;
}

/**
 * Fields in `payload` this actor is not permitted to write.
 *
 * Reached only by a crafted request — the UI never renders the other side's
 * note — so the response names the offending fields rather than stripping them
 * silently. A silent strip looks to the caller like a save that worked.
 */
export function rejectedAgeProfileFields(
  payload: Record<string, unknown>,
  isGuardian: boolean,
): string[] {
  const allowed = editableAgeProfileFields(isGuardian);
  return Object.keys(payload).filter((key) => !allowed.has(key));
}

/** Ages 2 to 5 inclusive — RFP §4.3. */
export const PORTFOLIO_AGES = [2, 3, 4, 5] as const;

export function isPortfolioAge(age: number): boolean {
  return PORTFOLIO_AGES.includes(age as (typeof PORTFOLIO_AGES)[number]);
}
