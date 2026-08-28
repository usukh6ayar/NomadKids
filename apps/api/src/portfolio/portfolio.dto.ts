import { z } from "zod";
import { dateOfBirthSchema, sexSchema } from "../children/children.dto";

/**
 * Portfolio request schemas.
 *
 * Every field is optional: the portfolio is filled in over years, and a PATCH
 * carries only what changed. Nullable where the UI offers a "clear" action.
 */

const text = (max: number) => z.string().max(max).nullable().optional();

/**
 * ★ These schemas are `.strict()`: an unknown field is a 400, not a silent
 * strip.
 *
 * Zod's default is to drop unrecognised keys, which for most endpoints is the
 * safe behaviour — a client sending `kindergartenId` in a body should have it
 * ignored rather than obeyed. Here it is wrong: the reference system answers
 * "Энэ талбарыг засах эрхгүй" and names the field, because a portfolio save
 * that silently discards half the form looks to the user like it worked.
 *
 * It also keeps the two-voices check honest. Stripping would remove
 * `teacherNote` from a guardian's payload before the service ever saw it, and
 * the guardian would get a cheerful 200 for a write that never happened.
 */
export const updateAboutMeSchema = z
  .object({
    introduction: text(2000),
    nameMeaning: text(1000),
    memorableSayings: text(2000),
    dream: text(1000),
    distinguishingTraits: text(2000),
    // Added 2026-08-28, on the client's instruction — not in RFP §4.1.
    clanName: text(200),
    nickname: text(200),
    birthplace: text(200),
    bloodType: text(10),
    eyeColor: text(50),
    /** Plausible ranges for a 2–5 year old, with room either side. */
    heightCm: z.coerce.number().min(30).max(200).nullable().optional(),
    weightKg: z.coerce.number().min(2).max(100).nullable().optional(),
    recordedOn: z.coerce.date().nullable().optional(),
    /**
     * ★ `Child`'s own columns, writable from this endpoint on top of
     * `ChildProfile`'s — a deliberate, client-confirmed reversal of the rule
     * `ChildrenService.update`'s own doc comment names: the reference suite's
     * `test_a_guardian_cannot_edit_their_own_child` asserted a guardian may
     * read but not edit these. That test governed `PATCH /children/:id`,
     * which still enforces it unchanged (`assertCanRecord`, staff only) —
     * this is a second, narrower path, added 2026-08-28, that reaches only
     * these four fields rather than `nationalId`/`healthNotes`/`status`,
     * and reuses `assertCanAccess` the same way every other about-me field
     * already does.
     */
    lastName: z.string().min(1).max(100).optional(),
    firstName: z.string().min(1).max(100).optional(),
    dateOfBirth: dateOfBirthSchema.optional(),
    sex: sexSchema.optional(),
  })
  .strict();
export type UpdateAboutMeDto = z.infer<typeof updateAboutMeSchema>;

/**
 * Age-profile fields.
 *
 * ★ `parentNote` and `teacherNote` are both accepted by the schema and then
 * checked against the actor's relationship to the child in the service. The
 * schema cannot make that call — it does not know who is asking — and rejecting
 * one here would mean two places deciding the same thing.
 */
export const updateAgeProfileSchema = z
  .object({
    favoriteColor: text(100),
    favoriteFood: text(200),
    favoriteToy: text(200),
    favoriteBook: text(200),
    favoriteSong: text(200),
    favoriteStory: text(200),
    favoriteActivity: text(200),
    personality: text(2000),
    emotionalTraits: text(2000),
    familyMembers: text(2000),
    learningInterest: text(2000),
    newSkills: text(2000),
    parentNote: text(2000),
    teacherNote: text(2000),
  })
  .strict();
export type UpdateAgeProfileDto = z.infer<typeof updateAgeProfileSchema>;

export const updateBirthdayNoteSchema = z
  .object({ note: z.string().max(2000).nullable() })
  .strict();
export type UpdateBirthdayNoteDto = z.infer<typeof updateBirthdayNoteSchema>;

/** Ages 2–5 — RFP §4.3. Anything else is a 400, not a silent no-op. */
export const ageParamSchema = z.object({
  id: z.uuid(),
  age: z.coerce
    .number()
    .int()
    .min(2, "Нас 2–5 хооронд байх ёстой")
    .max(5, "Нас 2–5 хооронд байх ёстой"),
});
export type AgeParams = z.infer<typeof ageParamSchema>;
