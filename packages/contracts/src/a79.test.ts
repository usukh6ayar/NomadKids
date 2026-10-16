import { describe, expect, it } from "vitest";
import { A79_LEVELS, a79LevelForAge, observationA79LinksSchema } from "./a79";

describe("А/79 criteria", () => {
  it("carries the document's 37 + 41 + 46 + 49 = 173 criteria", () => {
    expect(A79_LEVELS.map((level) => level.criteria.length)).toEqual([37, 41, 46, 49]);
  });

  it("puts a child's age on a level, clamped to I…IV", () => {
    expect([null, 1, 2, 3, 4, 5, 7].map(a79LevelForAge)).toEqual([
      "I",
      "I",
      "I",
      "II",
      "III",
      "IV",
      "IV",
    ]);
  });

  it("refuses a criterion number the level does not have, and a criterion twice", () => {
    const link = (number: number) => ({ level: "I", number, status: "INDEPENDENT" });
    expect(observationA79LinksSchema.safeParse({ links: [link(37)] }).success).toBe(true);
    expect(observationA79LinksSchema.safeParse({ links: [link(38)] }).success).toBe(false);
    expect(observationA79LinksSchema.safeParse({ links: [link(3), link(3)] }).success).toBe(false);
  });
});
