import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ESIS_RESOURCE_CATALOG } from "./esis.catalog";
import { ESIS_ENDPOINTS } from "./esis.endpoints";
import { ESIS_FIELDS, ingestedFieldNames } from "./esis.fields";
import { ESIS_READABLE_KEYS, ESIS_READERS, type EsisReadableKey } from "./esis.service";

/**
 * The field catalog is what an operator checks against the ministry's own
 * portal, so it has to be true rather than merely present.
 *
 * ★ The first test is the load-bearing one. A field marked `ingested` that the
 * schema does not parse renders as a permanently empty column — the screen
 * would be claiming we collect something we discard. The reverse, a parsed
 * field missing from the catalog, is worse: a value shown to an operator that
 * no document accounts for. Set equality catches both, and it catches them at
 * the moment somebody edits one file and not the other.
 */
describe("ESIS field catalog", () => {
  it("matches the parsing schema key for key", () => {
    for (const key of ESIS_READABLE_KEYS) {
      const schema = ESIS_READERS[key].schema as z.ZodObject<z.ZodRawShape>;

      expect({ key, fields: [...ingestedFieldNames(key)].sort() }).toEqual({
        key,
        fields: Object.keys(schema.shape).sort(),
      });
    }
  });

  it("covers every catalog service, including the attendance POST", () => {
    expect(Object.keys(ESIS_FIELDS).sort()).toEqual(Object.keys(ESIS_ENDPOINTS).sort());
    expect(ESIS_RESOURCE_CATALOG.every((entry) => entry.fields.length > 0)).toBe(true);
  });

  it("never ingests a civil id, a register number or a provider password", () => {
    const refused = [
      "civilId",
      "personRegNumber",
      "microsoftPassword",
      "googlePassword",
      "microsoftEmailPass",
      "googleEmailPass",
      "username",
    ];

    for (const entry of ESIS_RESOURCE_CATALOG) {
      for (const field of entry.fields) {
        if (refused.includes(field.name)) {
          expect({ key: entry.key, name: field.name, ingested: field.ingested }).toEqual({
            key: entry.key,
            name: field.name,
            ingested: false,
          });
        }
      }
    }
  });

  it("gives every refused field a reason that names its source document", () => {
    const omitted = ESIS_RESOURCE_CATALOG.flatMap((entry) =>
      entry.fields.filter((field) => !field.ingested),
    );

    expect(omitted.length).toBeGreaterThan(0);
    expect(omitted.every((field) => field.omitReason?.includes("ESIS_REQUEST.md"))).toBe(true);
  });

  it("declares the path values each readable service needs", () => {
    const params = Object.fromEntries(
      ESIS_RESOURCE_CATALOG.filter((entry) => entry.params.length > 0).map((entry) => [
        entry.key,
        entry.params,
      ]),
    );

    expect(params).toEqual({
      groupStudents: ["studentGroupId"],
      studentMovements: ["beginDate"],
      groupAttendance: ["studentGroupId", "dayDate"],
      foodKit: ["productId"],
      foodKitProducts: ["productId"],
    });
    // The one write service is not readable, so no button can reach it.
    expect(ESIS_READABLE_KEYS as string[]).not.toContain("saveAttendanceV3");
  });

  it("marks every selected service as checked against the developer portal", () => {
    const portal = ESIS_RESOURCE_CATALOG.filter((entry) => entry.fieldSource === "PORTAL").map(
      (entry) => entry.key,
    );

    expect(portal.sort()).toEqual(Object.keys(ESIS_ENDPOINTS).sort());
  });

  /*
   * ★ The samples exist to demonstrate the screen before a token is issued,
   * which makes "could this be mistaken for a real ESIS response?" the only
   * question that matters about them. A sample on a refused field would be a
   * fabricated register number or password rendered on screen — precisely the
   * thing the refusal list exists to say this product does not hold.
   */
  it("gives every ingested field a sample and every refused field none", () => {
    for (const entry of ESIS_RESOURCE_CATALOG) {
      for (const field of entry.fields) {
        expect({ key: entry.key, name: field.name, hasSample: field.sample !== undefined }).toEqual(
          {
            key: entry.key,
            name: field.name,
            hasSample: field.ingested,
          },
        );
      }
    }
  });

  it("builds a sample row with exactly the live row's columns", () => {
    for (const entry of ESIS_RESOURCE_CATALOG) {
      expect({ key: entry.key, columns: Object.keys(entry.sampleRow).sort() }).toEqual({
        key: entry.key,
        columns: [...ingestedFieldNames(entry.key)].sort(),
      });
      // No column may be blank, or the demonstration shows a hole.
      expect(Object.values(entry.sampleRow).every((value) => Boolean(value))).toBe(true);
    }
  });

  it("resolves a readable key to a path in the reviewed catalog", () => {
    for (const key of ESIS_READABLE_KEYS as EsisReadableKey[]) {
      expect(ESIS_READERS[key].endpoint.path).toBe(ESIS_ENDPOINTS[key].path);
    }
  });
});
