import { describe, expect, it } from "vitest";
import { allergenMatches, findAllergenWarnings } from "./allergen-match";

describe("allergenMatches", () => {
  it("ignores case and surrounding space", () => {
    expect(allergenMatches("Самар", "самар")).toBe(true);
    expect(allergenMatches("  сүү  ", "сүү")).toBe(true);
  });

  it("matches when either string contains the other", () => {
    expect(allergenMatches("сүүтэй", "сүү")).toBe(true);
    expect(allergenMatches("сүү", "сүүтэй будаа")).toBe(true);
  });

  /**
   * ★ The case that made a plain substring check wrong, and the reason this
   * function is not a one-liner.
   *
   * **самар** (nut) becomes **самрын** in the genitive and the second *а*
   * elides, so "самрын тос" does not contain "самар". Mongolian is
   * agglutinative and suffixation routinely changes the stem, so this is the
   * ordinary case rather than an edge one — and it is precisely the case the
   * feature exists for. Written as an assertion first; the implementation
   * failed it, which is how the elision was found at all.
   */
  it("matches across Mongolian suffixation, where the stem changes", () => {
    expect(allergenMatches("самрын тос", "самар")).toBe(true);
    expect(allergenMatches("самар", "самрын тос")).toBe(true);
    expect(allergenMatches("загасны шөл", "загас")).toBe(true);
  });

  it("does not match unrelated words", () => {
    expect(allergenMatches("өндөг", "сүү")).toBe(false);
    expect(allergenMatches("мах", "загас")).toBe(false);
  });

  /**
   * ★★ A one-character allergen would substring-match nearly every tag, and a
   * warning on every dish is noise that teaches people to ignore warnings. Short
   * strings compare exactly.
   */
  it("does not let a short string match everything", () => {
    expect(allergenMatches("самар", "с")).toBe(false);
    expect(allergenMatches("с", "с")).toBe(true);
    // Two characters is still below the stem length, so it compares exactly
    // rather than prefix-matching every word that starts with them.
    expect(allergenMatches("самар", "са")).toBe(false);
  });

  /**
   * ★★ The trade, stated as a test so nobody "fixes" it later.
   *
   * A stem match fires on сүү/сүүж — milk against hip — and that is accepted on
   * purpose. A false positive costs ten seconds of reading; a false negative
   * feeds a child something that stops their breathing. The warning names both
   * words so a human dismisses it at a glance.
   */
  it("accepts a false positive rather than risk a miss", () => {
    expect(allergenMatches("сүүжний мах", "сүү")).toBe(true);
  });

  it("treats an empty string as no allergen at all", () => {
    expect(allergenMatches("", "самар")).toBe(false);
    expect(allergenMatches("самар", "   ")).toBe(false);
  });
});

describe("findAllergenWarnings", () => {
  const child = { id: "c1", lastName: "Ганболд", firstName: "Батбаяр" };

  it("names the dish, the tag and the allergy it matched", () => {
    const warnings = findAllergenWarnings(
      [{ name: "Самартай салат", allergenTags: ["самар"] }],
      [{ childId: "c1", allergen: "самар", severity: "SEVERE", child }],
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      childId: "c1",
      childName: "Ганболд Батбаяр",
      dishName: "Самартай салат",
      allergenTag: "самар",
      allergen: "самар",
      severity: "SEVERE",
    });
  });

  /**
   * ★★★ Severe first. A teacher scanning a long list before lunch must meet
   * anaphylaxis before a mild reaction, whatever order the dishes were typed
   * in.
   */
  it("orders severe warnings first", () => {
    const warnings = findAllergenWarnings(
      [
        { name: "Сүүтэй будаа", allergenTags: ["сүү"] },
        { name: "Самартай бялуу", allergenTags: ["самар"] },
      ],
      [
        { childId: "c1", allergen: "сүү", severity: "MILD", child },
        { childId: "c2", allergen: "самар", severity: "SEVERE", child: { ...child, id: "c2" } },
      ],
    );

    expect(warnings[0]!.severity).toBe("SEVERE");
    expect(warnings[1]!.severity).toBe("MILD");
  });

  it("warns once per matching pair, not once per dish", () => {
    const warnings = findAllergenWarnings(
      [
        { name: "Сүүтэй будаа", allergenTags: ["сүү"] },
        { name: "Сүүтэй цай", allergenTags: ["сүү"] },
      ],
      [{ childId: "c1", allergen: "сүү", severity: "MODERATE", child }],
    );

    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.dishName)).toEqual(["Сүүтэй будаа", "Сүүтэй цай"]);
  });

  it("is quiet when nothing matches", () => {
    expect(
      findAllergenWarnings(
        [{ name: "Ногоотой шөл", allergenTags: ["лууван"] }],
        [{ childId: "c1", allergen: "самар", severity: "SEVERE", child }],
      ),
    ).toEqual([]);
  });

  it("is quiet when a dish carries no tags at all", () => {
    expect(
      findAllergenWarnings(
        [{ name: "Ус", allergenTags: [] }],
        [{ childId: "c1", allergen: "самар", severity: "SEVERE", child }],
      ),
    ).toEqual([]);
  });
});
