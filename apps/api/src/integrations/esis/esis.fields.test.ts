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
      // Added 2026-09-10. The curriculum chain is the reason `programStageId`
      // and `programPlanId` exist: each service takes the ids the one above it
      // returned, which is what makes it a drill-down rather than four panels.
      studentCheck: ["personId"],
      studentStatistics: ["personId"],
      studentCondition: ["personId"],
      teacherAcademicOrg: ["personId"],
      teacherMovements: ["beginDate"],
      programStages: ["programOfStudyId"],
      programPlans: ["programOfStudyId", "programStageId"],
      programCourses: ["programOfStudyId", "programStageId", "programPlanId"],
    });
    /*
     * The write services are not readable, so no read button can reach one.
     * ★ There are four now, not one — 2026-09-10. The three суралцагч saves
     * travel with their reads, and this is the assertion that keeps them off
     * the generic "ESIS-ээс татах" path they have no business on.
     */
    for (const key of [
      "saveAttendanceV3",
      "studentContactsSave",
      "studentStatisticsSave",
      "studentConditionSave",
    ]) {
      expect(ESIS_READABLE_KEYS as string[]).not.toContain(key);
    }
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

    /*
     * ★ `ADAPTER` was one key until 2026-09-10 and is eighteen now.
     *
     * `studentInfo` sits in the catalog block the public page truncates before.
     * The seventeen added that day are the same situation twice over: the
     * суралцагч services are in a section the page does not render without a
     * session, and the ten listed under an `api-nn` slug are named on the page
     * without their output fields being published. In both cases the column
     * names are this adapter's, and the operator screen says so.
     *
     * The set is pinned rather than counted, so a service quietly demoted from
     * PORTAL to ADAPTER still fails here.
     */
    expect(keysBySource("ADAPTER").sort()).toEqual(
      [
        "studentInfo",
        "studentCheck",
        "studentContacts",
        "studentContactsSave",
        "studentStatistics",
        "studentStatisticsSave",
        "studentCondition",
        "studentConditionSave",
        "teacherAcademicOrg",
        "teacherMovements",
        "groupsNextYear",
        "programs",
        "programStages",
        "programPlans",
        "programCourses",
        "rooms",
        "academicOrg",
        "subjectAreas",
      ].sort(),
    );
    expect([...keysBySource("PORTAL"), ...keysBySource("ADAPTER")].sort()).toEqual(
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
        /*
         * A write service has no outputs; its demo row is the request body.
         *
         * ★ Keyed off `direction` rather than the name `saveAttendanceV3` —
         * 2026-09-10. It was the only write for as long as there was one, and
         * naming it worked until three суралцагч saves arrived and this test
         * failed for each of them in turn. The catalog already knows which
         * way a service points; asking it means the next write needs no edit
         * here at all.
         */
        const isWrite = entry.direction === "NOMADKIDS_TO_ESIS";
        const expected = isWrite ? Object.keys(row).sort() : columns;
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
      // Same reasoning as the test above: a write service's `sampleRow` is
      // empty by construction, because `sampleRow` keeps outputs only.
      if (entry.direction === "NOMADKIDS_TO_ESIS") continue;
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

/**
 * Which way a service moves data, and why that is not the HTTP verb.
 *
 * ★ `studentContacts` is the service that separated the two. The ministry's
 * own list calls it "Гэр бүлийн мэдээлэл **лавлах**" — a lookup — and answers
 * it only over POST. A live probe on 2026-09-11 settled it: GET returns the
 * same 404 a nonsense path returns, POST returns the same 403 every other real
 * service returns.
 *
 * Before that, `direction` was derived from `method`, so writing the truth
 * down would have reported a read-only service to the operator as one that
 * writes into ESIS — on the screen an operator checks before granting access.
 */
describe("ESIS data direction", () => {
  it("keeps the guardian-contact lookup a POST", () => {
    expect(ESIS_ENDPOINTS.studentContacts.method).toBe("POST");
  });

  it("still calls that lookup a read", () => {
    const entry = ESIS_RESOURCE_CATALOG.find((row) => row.key === "studentContacts");

    expect(entry?.readable).toBe(true);
    expect(entry?.direction).toBe("ESIS_TO_NOMADKIDS");
  });

  /*
   * ★★ The invariant the fix rests on: direction follows the reader table, so
   * a service reads if and only if something here can parse its rows. A future
   * read added over POST inherits the right answer; a write can never claim to
   * be a read without a schema to back it.
   */
  it("derives direction from the reader table, not the verb", () => {
    const readable = new Set<string>(ESIS_READABLE_KEYS);

    for (const entry of ESIS_RESOURCE_CATALOG) {
      expect(entry.direction, entry.key).toBe(
        readable.has(entry.key) ? "ESIS_TO_NOMADKIDS" : "NOMADKIDS_TO_ESIS",
      );
    }
  });
});
