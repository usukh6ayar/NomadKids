import { describe, expect, it } from "vitest";
import { curriculumCodeAtLevel } from "./curriculum";

/**
 * The client's own examples, 2026-09-11.
 *
 * ★ These are transcriptions of what they sent, not invented cases. The picker
 * showed `ХЭМ1н` where the curriculum says `ХЭМ4.1н`, and the shape of the
 * correction is the whole content of this helper.
 */
describe("curriculumCodeAtLevel", () => {
  it("writes the level into the code, where the curriculum puts it", () => {
    expect(curriculumCodeAtLevel("ХЭМ1н", 4)).toBe("ХЭМ4.1н");
    expect(curriculumCodeAtLevel("ХЭМ2з", 4)).toBe("ХЭМ4.2з");
    expect(curriculumCodeAtLevel("НСХ1а", 3)).toBe("НСХ3.1а");
  });

  /** One row of the curriculum, four codes — that is the point of it. */
  it("gives the same indicator a different code at each level", () => {
    const codes = [1, 2, 3, 4].map((level) => curriculumCodeAtLevel("ХЭМ1н", level));
    expect(codes).toEqual(["ХЭМ1.1н", "ХЭМ2.1н", "ХЭМ3.1н", "ХЭМ4.1н"]);
  });

  /*
    ★ Two-digit standards and multi-letter suffixes survive.

    `ХЭМ` standard 1 runs to fourteen indicators, so the letters reach `о`, and
    a strand with ten standards would write `2`-digit numbers. The parse takes
    the digits as a run rather than a single character for that reason.
  */
  it("keeps a multi-digit standard intact", () => {
    expect(curriculumCodeAtLevel("ХЭМ12а", 2)).toBe("ХЭМ2.12а");
  });

  it("leaves the code alone when no level is known", () => {
    expect(curriculumCodeAtLevel("ХЭМ1н", null)).toBe("ХЭМ1н");
    expect(curriculumCodeAtLevel("ХЭМ1н", undefined)).toBe("ХЭМ1н");
  });

  /*
    A kindergarten may add its own indicators — `CurriculumIndicator.kindergartenId`
    is nullable for that — and nothing obliges those to follow the national
    notation. Splicing a digit into the middle of one would invent a code.
  */
  it("shows a code it cannot parse exactly as it was entered", () => {
    expect(curriculumCodeAtLevel("Бидний код", 3)).toBe("Бидний код");
    expect(curriculumCodeAtLevel("", 3)).toBe("");
    expect(curriculumCodeAtLevel("123", 3)).toBe("123");
  });
});
