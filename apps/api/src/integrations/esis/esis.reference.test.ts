import { describe, expect, it } from "vitest";
import { ESIS_READABLE_KEYS, ESIS_READERS } from "./esis.service";
import { REFERENCE_RESOURCES, externalIdFor } from "./esis.reference";

/*
 * ★ The list is closed, and the test is what closes it.
 *
 * A resource on this list gets copied monthly whether or not anybody looks at
 * it. That is defensible for a catalogue and indefensible for a child's
 * medical record, so "is this reference data?" must be a decision somebody
 * made rather than a property something acquired.
 */
describe("REFERENCE_RESOURCES", () => {
  it("names only readers that exist", () => {
    for (const entry of REFERENCE_RESOURCES) {
      expect({ key: entry.resource, known: ESIS_READABLE_KEYS.includes(entry.resource) }).toEqual({
        key: entry.resource,
        known: true,
      });
    }
  });

  /*
   * ★★ The scope flag must match the reader, or a national catalogue gets
   * stored once per kindergarten and an institution's rooms get stored as
   * everybody's.
   */
  it("agrees with each reader about whether it is institution-scoped", () => {
    for (const entry of REFERENCE_RESOURCES) {
      const reader = ESIS_READERS[entry.resource] as { institution?: boolean };
      const readerIsScoped = reader.institution !== false;
      expect({ key: entry.resource, scoped: entry.scope === "INSTITUTION" }).toEqual({
        key: entry.resource,
        scoped: readerIsScoped,
      });
    }
  });

  /*
   * ★★★ Nothing per-child is on the list. Named explicitly rather than left to
   * the reviewer's memory: a vaccination history copied monthly for every
   * child is exactly the bulk collection the design forbids.
   */
  it("excludes every per-child service", () => {
    const perChild = REFERENCE_RESOURCES.filter((entry) =>
      ESIS_READERS[entry.resource].endpoint.path.includes(":personId"),
    );
    expect(perChild).toEqual([]);
  });

  /*
   * ★ `studentContacts` carries `personId` in the JSON body, not the path —
   * see its note in `esis.service.ts`. The path check above cannot see it,
   * and it is the richest PII surface in the catalogue, so the guarantee
   * needs a second case that reads `params` and `bodyParams` together.
   */
  it("excludes every reader that takes a personId at all", () => {
    const perChild = REFERENCE_RESOURCES.filter((entry) => {
      const reader = ESIS_READERS[entry.resource] as {
        params?: readonly string[];
        bodyParams?: readonly string[];
      };
      return [...(reader.params ?? []), ...(reader.bodyParams ?? [])].includes("personId");
    });
    expect(perChild).toEqual([]);
  });

  it("gives every row a stable external id", () => {
    expect(externalIdFor("foodProducts", { productId: 12, name: "Будаа" })).toBe("12");
    expect(externalIdFor("rooms", { facilityId: "A-1" })).toBe("A-1");
  });

  /* A row with no recognisable id is skipped, not stored under "undefined". */
  it("returns null when it cannot find an id", () => {
    expect(externalIdFor("foodProducts", { name: "no id here" })).toBeNull();
  });
});
