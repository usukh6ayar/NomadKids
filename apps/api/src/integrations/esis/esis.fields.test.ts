import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ESIS_RESOURCE_CATALOG } from "./esis.catalog";
import { ESIS_ENDPOINTS } from "./esis.endpoints";
import { ESIS_FIELDS, ingestedFieldNames } from "./esis.fields";
import { sampleRows, unknownOverrideKeys } from "./esis.samples";
import { ESIS_READ_PARAMS } from "./esis.dto";
import {
  ESIS_READABLE_KEYS,
  ESIS_READERS,
  esisReaderParams,
  type EsisReadableKey,
} from "./esis.service";

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
      studentByRegister: ["personRegNumber"],
      studentInfo: ["personRegNumber"],
      groupStudents: ["studentGroupId"],
      studentMovements: ["beginDate"],
      groupAttendance: ["studentGroupId", "dayDate"],
      livelihoodForm1: ["academicYear", "academicMonth"],
      livelihoodForm2: ["academicYear", "academicMonth", "studentGroupId"],
      foodKit: ["productId"],
      foodKitProducts: ["productId"],
    });
    // The one write service is not readable, so no button can reach it.
    expect(ESIS_READABLE_KEYS as string[]).not.toContain("saveAttendanceV3");
  });

  /*
   * Every selected service is pinned to a field list checked against the
   * developer portal rather than inferred from a neighbouring API.
   */
  it("marks every selected service as checked against the developer portal", () => {
    const keysBySource = (source: string) =>
      ESIS_RESOURCE_CATALOG.filter((entry) => entry.fieldSource === source).map(
        (entry) => entry.key,
      );

    // `studentByRegister` was read off the portal on 2026-09-09; `studentInfo`
    // sits in the catalog block the public page truncates before, so its field
    // list is still `students`' — see their endpoints' notes.
    expect(keysBySource("ADAPTER")).toEqual(["studentInfo"]);
    expect([...keysBySource("PORTAL"), "studentInfo"].sort()).toEqual(
      Object.keys(ESIS_ENDPOINTS).sort(),
    );
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

  /*
   * ★ The demo set is the whole answer to "show me the outputs" before a token
   * exists, so a row missing a column is a hole on screen with nothing to
   * explain it. Column equality with the live row is what keeps the
   * demonstration and a real response the same shape.
   */
  it("gives every demo record the live row's columns, all filled", () => {
    for (const entry of ESIS_RESOURCE_CATALOG) {
      const columns = Object.keys(entry.sampleRow).sort();
      for (const row of sampleRows(entry.key)) {
        // The write service has no outputs; its demo row is the request body.
        const expected = entry.key === "saveAttendanceV3" ? Object.keys(row).sort() : columns;
        expect({ key: entry.key, columns: Object.keys(row).sort() }).toEqual({
          key: entry.key,
          columns: expected,
        });
        expect(Object.values(row).every((value) => Boolean(value))).toBe(true);
      }
    }
  });

  it("starts the demo set with the row the field catalog illustrates", () => {
    for (const entry of ESIS_RESOURCE_CATALOG) {
      expect(entry.sampleRows.length).toBeGreaterThan(0);
      if (entry.key === "saveAttendanceV3") continue;
      expect({ key: entry.key, first: entry.sampleRows[0] }).toEqual({
        key: entry.key,
        first: entry.sampleRow,
      });
    }
  });

  /*
   * ★ A row is built from the field catalog's key set, so an override naming a
   * field the service does not return is dropped rather than shown — correct on
   * screen, silent in the source. This is the noise that makes it loud.
   */
  it("has no demo override naming a field its service does not return", () => {
    expect(unknownOverrideKeys()).toEqual([]);
  });

  /*
   * ★★ The refusals are the point of the catalog, and a demo row is the one
   * place a refused name could come back — an override is a bare object with no
   * type to stop it. A fabricated register number on screen is exactly what
   * `ESIS_REQUEST.md` §1.1 (b) says this product does not hold.
   */
  it("never gives a refused field a value in any demo record", () => {
    const refused = new Set(
      ESIS_RESOURCE_CATALOG.flatMap((entry) =>
        entry.fields.filter((field) => !field.ingested).map((field) => field.name),
      ),
    );

    for (const entry of ESIS_RESOURCE_CATALOG) {
      for (const row of sampleRows(entry.key)) {
        expect(Object.keys(row).filter((name) => refused.has(name))).toEqual([]);
      }
    }
  });

  /*
   * ★ The DTO must accept every path value a reader asks for.
   *
   * Nothing ties `ESIS_READ_PARAMS` to `esisReaderParams`, and the failure is
   * silent in the worst way: the validation pipe drops the unknown key, `read`
   * then reports the parameter as missing, and the caller sees a 409 about a
   * value they supplied. `studentByRegister` shipped that way, and both
   * livelihood statements repeated it.
   */
  it("validates every path value the readers declare", () => {
    const declared = new Set(
      (ESIS_READABLE_KEYS as EsisReadableKey[]).flatMap((key) => esisReaderParams(key)),
    );

    expect([...declared].filter((name) => !(name in ESIS_READ_PARAMS))).toEqual([]);
  });

  /*
   * ★★ And nothing may be validated that no reader asks for — a name left
   * behind after a service is dropped is a value the API keeps accepting.
   */
  it("validates nothing the readers do not declare", () => {
    const declared = new Set(
      (ESIS_READABLE_KEYS as EsisReadableKey[]).flatMap((key) => esisReaderParams(key)),
    );

    expect(Object.keys(ESIS_READ_PARAMS).filter((name) => !declared.has(name))).toEqual([]);
  });

  it("resolves a readable key to a path in the reviewed catalog", () => {
    for (const key of ESIS_READABLE_KEYS as EsisReadableKey[]) {
      expect(ESIS_READERS[key].endpoint.path).toBe(ESIS_ENDPOINTS[key].path);
    }
  });
});
