import { describe, expect, it } from "vitest";
import { esisResourceKeySchema } from "@kinder/contracts";
import { ESIS_ENDPOINTS } from "./esis.endpoints";

/**
 * The catalogue and the shared enum must name the same services.
 *
 * ★ This exists because the same defect shipped twice. `foodDiscountStudents`
 * was in `ESIS_ENDPOINTS` and not in `esisResourceKeySchema` for a day in
 * September 2026; on 2026-09-19 six more were — `groupCreate`, `groupUpdate`,
 * `groupInstructor`, `studentAwards`, `studentSearch` and
 * `buildingByRegisterNumber` — and that time it reached production.
 *
 * The failure mode is what makes it worth a dedicated test rather than a
 * comment. `key` is read by `esisOverviewSchema.endpoints`, and Zod rejects the
 * **entire** payload when one array element fails, so a single unlisted service
 * blanks the whole ESIS panel with a generic "Алдаа гарлаа". The request
 * answers 200 throughout, which is why the first investigation went looking at
 * authentication instead.
 *
 * Neither existing test could catch it: the api's catalog test asks for a
 * role's scoped list, and the web's schema tests parse fixtures rather than the
 * real catalogue.
 */
describe("the ESIS catalogue and the contracts enum", () => {
  const catalogKeys = Object.keys(ESIS_ENDPOINTS).sort();
  const enumKeys = [...esisResourceKeySchema.options].sort();

  it("accepts every key the catalogue serves", () => {
    const rejected = catalogKeys.filter((key) => !esisResourceKeySchema.safeParse(key).success);
    expect(rejected).toEqual([]);
  });

  it("has no enum member the catalogue no longer serves", () => {
    // The reverse direction: a key removed from the catalogue and left here is
    // dead surface that a client can still ask for.
    const orphaned = enumKeys.filter((key) => !(key in ESIS_ENDPOINTS));
    expect(orphaned).toEqual([]);
  });

  it("holds both lists at the same length", () => {
    // A count assertion on its own would be passed by one addition and one
    // removal cancelling out, so it sits after the two set comparisons rather
    // than instead of them.
    expect(enumKeys).toHaveLength(catalogKeys.length);
  });
});
