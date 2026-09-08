import { describe, expect, it } from "vitest";
import {
  editableAgeProfileFields,
  isPortfolioAge,
  rejectedAgeProfileFields,
  SHARED_AGE_FIELDS,
} from "./portfolio-fields";

/**
 * The two-voices rule from RFP §4.3, in isolation.
 *
 * These are the exact cases the reference suite asserts
 * (`test_guardian_may_write_only_the_parent_note`,
 * `test_teacher_may_write_only_the_teacher_note`).
 */

describe("editableAgeProfileFields", () => {
  it("gives a guardian the shared fields plus parentNote", () => {
    const fields = editableAgeProfileFields(true);
    expect(fields.has("dream")).toBe(true);
    expect(fields.has("parentNote")).toBe(true);
    expect(fields.has("teacherNote")).toBe(false);
    for (const shared of SHARED_AGE_FIELDS) expect(fields.has(shared)).toBe(true);
  });

  it("gives a teacher the shared fields plus teacherNote", () => {
    const fields = editableAgeProfileFields(false);
    expect(fields.has("teacherNote")).toBe(true);
    expect(fields.has("parentNote")).toBe(false);
    for (const shared of SHARED_AGE_FIELDS) expect(fields.has(shared)).toBe(true);
  });
});

describe("rejectedAgeProfileFields", () => {
  it("rejects a guardian writing teacherNote", () => {
    expect(rejectedAgeProfileFields({ teacherNote: "оролдлого" }, true)).toEqual(["teacherNote"]);
  });

  it("rejects a teacher writing parentNote", () => {
    expect(rejectedAgeProfileFields({ parentNote: "оролдлого" }, false)).toEqual(["parentNote"]);
  });

  it("accepts a guardian writing shared fields and their own note", () => {
    expect(
      rejectedAgeProfileFields(
        {
          favoriteColor: "Хөх",
          characterTraits: ["Тайван"],
          kindergartenSkillNotes: { current: "Өдөр бүр давтаж байна" },
          parentNote: "Тэмдэглэл",
        },
        true,
      ),
    ).toEqual([]);
  });

  it("names every offending field rather than only the first", () => {
    // The caller should learn what was wrong in one round trip.
    const rejected = rejectedAgeProfileFields({ teacherNote: "a", nonsense: "b" }, true);
    expect(rejected.sort()).toEqual(["nonsense", "teacherNote"]);
  });

  it("rejects a field that exists on no side", () => {
    expect(rejectedAgeProfileFields({ kindergartenId: "escalation" }, false)).toEqual([
      "kindergartenId",
    ]);
  });
});

describe("isPortfolioAge", () => {
  it("accepts 2 through 5", () => {
    for (const age of [2, 3, 4, 5]) expect(isPortfolioAge(age)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const age of [0, 1, 6, 7, -1, 99]) expect(isPortfolioAge(age)).toBe(false);
  });
});
