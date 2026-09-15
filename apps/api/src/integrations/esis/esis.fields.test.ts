import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ESIS_RESOURCE_CATALOG } from "./esis.catalog";
import { ESIS_ENDPOINTS } from "./esis.endpoints";
import { ESIS_DISCOVERED_SHAPE, ESIS_FIELDS, esisFieldsFor, ingestedFieldNames } from "./esis.fields";
import { ESIS_READ_PARAMS, ESIS_WRITE_RESOURCES } from "./esis.dto";
import {
  ESIS_REFUSED_FIELDS,
  esisDiscoveredSchema,
  esisStudentCheckSchema,
  esisStudentContactSchema,
} from "./esis.schemas";
import {
  ESIS_READABLE_KEYS,
  ESIS_READERS,
  esisReaderParams,
  type EsisReadableKey,
} from "./esis.service";

/**
 * The schema that actually validates a reader's rows, for the three readers
 * whose `parse` override bypasses `ESIS_READERS[key].schema` entirely.
 *
 * ★ Added 2026-09-15. `studentCheck`, `studentContacts` and `teacherCheck` all
 * read `schema: esisDiscoveredSchema` — the same value every true passthrough
 * has — but `getList`'s `parse ?? esisListParser(schema)` means their `parse`
 * override runs *instead of* `esisListParser(schema)`, and each override still
 * validates every row against a hand-written schema of its own:
 * `esisStudentCheckSchema` for the two check services, `esisStudentContactSchema`
 * for contacts. Keying the exemption below on `.schema` identity alone would
 * have silently stopped checking these three — exactly the class of defect
 * this file exists to catch. See the note beside `studentCheck` in
 * `esis.service.ts`.
 */
const PARSED_BY_OVERRIDE: Partial<Record<EsisReadableKey, z.ZodObject<z.ZodRawShape>>> = {
  studentCheck: esisStudentCheckSchema,
  teacherCheck: esisStudentCheckSchema,
  studentContacts: esisStudentContactSchema,
};

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
      const reader = ESIS_READERS[key as EsisReadableKey] as { schema: unknown; parse?: unknown };
      const overrideSchema = PARSED_BY_OVERRIDE[key as EsisReadableKey];

      /*
       * ★ Pass-through readers are exempt, and the exemption is the feature
       * rather than a hole in it — widened 2026-09-15 from "the six services
       * that answered 203 for every child" to every reader with no domain
       * consumer, per `esis.service.test.ts`'s "declared-schema boundary".
       *
       * This assertion pins a *declared* field list against a *declared*
       * schema, so it is asserted only for the seven readers that still hand-
       * write one. `esisDiscoveredSchema` has no `.shape` to compare against —
       * asking it this question is a category error, not a failure.
       *
       * What replaces the check for a passthrough is the assertion below,
       * which is the one that actually matters for it: that it cannot leak an
       * identifier we refused.
       *
       * ★★ **Keying this on `.schema` identity alone is wrong** — found
       * 2026-09-15. `studentCheck`, `studentContacts` and `teacherCheck` all
       * read `schema: esisDiscoveredSchema` but are not passthroughs: their
       * `parse` override runs instead of `esisListParser(schema)` and still
       * validates every row against a hand-written schema (`PARSED_BY_OVERRIDE`
       * above). A reader with a `parse` override is therefore never exempt
       * here, even when `.schema` says `esisDiscoveredSchema` — only a reader
       * with *neither* a `parse` override *nor* a declared schema is a true
       * passthrough.
       */
      if (reader.parse === undefined && reader.schema === esisDiscoveredSchema) continue;

      const schema = (overrideSchema ?? reader.schema) as z.ZodObject<z.ZodRawShape>;

      expect({ key, fields: [...ingestedFieldNames(key)].sort() }).toEqual({
        key,
        fields: Object.keys(schema.shape).sort(),
      });
    }
  });

  /*
   * The passthrough's own guarantee.
   *
   * ★ Every other schema refuses a civil id by simply not naming it, and the
   * test above is what proves each one still does. `esisDiscoveredSchema` keeps
   * whatever ESIS sends, so omission cannot be its defence — the refusal has to
   * run, and this is what proves it runs.
   *
   * ★★ A widened schema elsewhere is a bug. A passthrough that forwarded a
   * child's civil id would be a breach of what `ESIS_REQUEST.md` §1.1 (b)
   * promises the ministry, so it is asserted directly rather than inferred.
   */
  it("strips every refused identifier from a discovered-shape row", () => {
    expect(ESIS_DISCOVERED_SHAPE.size).toBeGreaterThan(0);

    const row = {
      personId: 9129027526058,
      studentAllergyId: 5,
      allergenName: "Сүү",
      ...Object.fromEntries(ESIS_REFUSED_FIELDS.map((name) => [name, "leaked"])),
    };

    const parsed = esisDiscoveredSchema.parse(row) as Record<string, unknown>;

    for (const name of ESIS_REFUSED_FIELDS) {
      expect({ name, present: name in parsed }).toEqual({ name, present: false });
    }
    // …while everything the service actually carries survives.
    expect(parsed).toMatchObject({ studentAllergyId: 5, allergenName: "Сүү" });
  });

  /*
   * ★ A discovered service declares the anchor and nothing else. If somebody
   * later writes a guessed field list for one of these, this fails — which is
   * the whole point of the set existing rather than the guesses being quietly
   * added back.
   */
  it("declares only the anchor for a service whose contract is unseen", () => {
    for (const key of ESIS_DISCOVERED_SHAPE) {
      expect({ key, fields: ingestedFieldNames(key) }).toEqual({ key, fields: ["personId"] });
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
      /*
       * ★ Added 2026-09-14. `studentContacts` was declared parameterless and
       * listed as an institution-level preview, because the catalog described
       * it as the whole roster's guardians. It is a per-child lookup: without a
       * `personId` in its POST body it answers `400 personId шаардлагатай`.
       * This assertion is what will now fail if that is ever undone.
       */
      studentContacts: ["personId"],
      studentStatistics: ["personId"],
      studentCondition: ["personId"],
      teacherAcademicOrg: ["personId"],
      teacherMovements: ["beginDate"],
      programStages: ["programOfStudyId"],
      programPlans: ["programOfStudyId", "programStageId"],
      programCourses: ["programOfStudyId", "programStageId", "programPlanId"],

      /*
       * ── Added 2026-09-14 ──────────────────────────────────────────────
       *
       * ★ `workerInfo` takes `primaryNidNumber` — a **worker's** register
       * number, not a child's. It is the second personal identifier a reader
       * accepts, and `esis-admin.service.ts` keeps it out of the audit row
       * alongside `personRegNumber`; `REDACTED_READ_PARAMS` is the list.
       */
      studentAllergy: ["personId"],
      studentProhibitedFood: ["personId"],
      studentDisability: ["personId"],
      studentAssessments: ["personId"],
      studentMeasurements: ["personId"],
      studentSurgery: ["personId"],
      studentIncident: ["personId"],
      studentScreening: ["personId"],
      vaccineHistory: ["personId"],
      vaccinePlan: ["personId"],
      groupMeasurements: ["studentGroupId"],
      schoolAttendance: ["academicYear", "dayDate"],
      workerInfo: ["primaryNidNumber"],
      teacherProfile: ["personId"],
      teacherCheck: ["personId"],
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
      // The ten added 2026-09-14. Each is reached from an explicit operator
      // action; none may be pulled by the generic "ESIS-ээс татах" button.
      "studentAllergySave",
      "studentProhibitedFoodSave",
      "studentDisabilitySave",
      "studentAssessmentsSave",
      "studentMeasurementSave",
      "studentSurgerySave",
      "studentIncidentSave",
      "studentAttachmentSave",
      "groupMeasurementsSave",
      "studentScreeningSave",
    ]) {
      expect(ESIS_READABLE_KEYS as string[]).not.toContain(key);
    }
  });

  /*
   * Every write in the catalogue is reachable, or deliberately is not.
   *
   * ★ Added 2026-09-15, after ten writes were added to `ESIS_ENDPOINTS`, given
   * `EsisService` methods, given `send()` field lists and put in a role's
   * service list — and were still **unreachable**, because `POST …/esis/write`
   * validates its `resource` against `ESIS_WRITE_RESOURCES` and nothing had
   * added them there. The route rejected them at schema validation with no
   * hint that the method existed one layer down.
   *
   * ★★ Wiring a service touches seven files and this was the seventh. A count
   * assertion would not have caught it — the catalogue was complete, the tests
   * were green, and the only symptom was a button that could never work. So
   * the check is "can this be called?", asked of every write there is.
   *
   * ★★★ `studentAttachmentSave` is the one deliberate exclusion, and it is
   * named rather than filtered by a rule: it sends a child's medical document
   * to a third party, which CLAUDE.md §1.4 makes a consent decision rather
   * than a route. Adding a second exclusion should require editing this line.
   */
  it("makes every write reachable, except the one held back on purpose", () => {
    const writes = Object.keys(ESIS_ENDPOINTS).filter((key) => key.endsWith("Save"));
    const reachable = new Set<string>(ESIS_WRITE_RESOURCES);

    expect(writes.filter((key) => !reachable.has(key))).toEqual(["studentAttachmentSave"]);

    // And nothing is routable that the catalogue does not carry.
    expect([...reachable].filter((key) => !writes.includes(key))).toEqual([]);
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
        "studentContactsSave",
        "studentStatisticsSave",
        "studentConditionSave",
        "groupsNextYear",
        "programStages",
        "programPlans",
        "programCourses",
        /*
         * ── Added 2026-09-14 ────────────────────────────────────────────
         *
         * ★ The six reads whose contract has never been seen: they answered
         * 203 for every child on this institution, so nothing is declared and
         * `esisFieldsFor` reads their columns off the first real record.
         * `ADAPTER` is the honest badge for a list that does not exist yet.
         *
         * ★★ The ten writes, because an input contract cannot be observed by
         * reading. They mirror their own reads and are settled by the first
         * real send — the position `saveAttendanceV3` has always been in.
         */
        "studentAllergy",
        "studentProhibitedFood",
        "studentDisability",
        "studentSurgery",
        "studentIncident",
        "studentScreening",
        "studentAllergySave",
        "studentProhibitedFoodSave",
        "studentDisabilitySave",
        "studentAssessmentsSave",
        "studentMeasurementSave",
        "studentSurgerySave",
        "studentIncidentSave",
        "studentAttachmentSave",
        "groupMeasurementsSave",
        "studentScreeningSave",
      ].sort(),
    );

    /*
     * ★ `LIVE` — added 2026-09-14, and it is nine of the eighteen that used to
     * be `ADAPTER`. Each was compared with a real response from institution
     * 42778, and **every one of them was wrong**: `rooms` and `academicOrg`
     * required an id ESIS does not send and failed outright, and the other
     * seven parsed while silently discarding the payload.
     *
     * That is the argument for the third value existing. `ADAPTER` was being
     * read as "not confirmed yet" when it meant "invented", and one badge for
     * both left nothing on the operator screen to tell a verified field list
     * from an unverified one.
     *
     * ★★ What stays `ADAPTER` is what still cannot be checked: the four writes,
     * whose inputs no read reveals; the three curriculum drill-downs, which
     * need ids this institution's single programme does not produce;
     * `groupsNextYear`, which answers 203 here; and `studentInfo`, whose
     * section the catalog page truncates before.
     */
    expect(keysBySource("LIVE").sort()).toEqual(
      [
        "studentCheck",
        "studentContacts",
        "studentStatistics",
        "studentCondition",
        "teacherAcademicOrg",
        /* Added 2026-09-14 — each captured from a real response. */
        "studentAssessments",
        "studentMeasurements",
        "vaccineCatalog",
        "vaccineHistory",
        "vaccinePlan",
        "groupMeasurements",
        "screeningQuestions",
        "schoolAttendance",
        "workerInfo",
        "teacherProfile",
        "teacherCheck",
        "teacherMovements",
        "programs",
        "rooms",
        "academicOrg",
        "subjectAreas",
      ].sort(),
    );
    expect(
      [...keysBySource("PORTAL"), ...keysBySource("LIVE"), ...keysBySource("ADAPTER")].sort(),
    ).toEqual(Object.keys(ESIS_ENDPOINTS).sort());
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

  /*
   * ★ A declared service that sends something we never declared.
   *
   * Before 2026-09-15 this was unobservable: the hand-written schema dropped
   * the key long before a field list was built. Now the row survives, so the
   * column has to appear — otherwise the payload carries a value the screen
   * refuses to admit exists, which is the defect this whole change removes.
   */
  it("shows an undeclared field that a declared service actually sent", () => {
    const fields = esisFieldsFor("organization", [
      { institutionId: 42778, institutionName: "Дэгдээхий үрс", unexpectedFromEsis: "x" },
    ]);

    const names = fields.map((field) => field.name);
    expect(names).toContain("unexpectedFromEsis");
    // Declared columns keep their order and come first.
    expect(names.slice(0, ingestedFieldNames("organization").length)).toEqual(
      ESIS_FIELDS.organization.map((field) => field.name),
    );
  });

  /*
   * ★★ …and a declared column survives a response that omitted it. This is the
   * half that must not regress: columns cannot depend on the data, or an
   * outage and an empty value look identical.
   */
  it("keeps a declared column that the response did not carry", () => {
    const fields = esisFieldsFor("organization", [{ institutionId: 42778 }]);
    expect(fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(ESIS_FIELDS.organization.map((field) => field.name)),
    );
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

/**
 * Nothing here may invent an ESIS value — 2026-09-14.
 *
 * ★ The catalog used to carry `sample` on every field, `sampleRow` per service
 * and `sampleRows` for a whole demo roster, and `ESIS_DEMO_MODE=true` served
 * committed fixtures instead of calling the ministry. All of it existed so the
 * screens could be shown before the token had scope; institution 42778 answers
 * now, and the client's instruction was plain — "ene esis ni real zuil shuu …
 * demo ugugdul ntr ywuulj tenegtewee".
 *
 * ★★ These tests exist because deleting code does not keep it deleted. The
 * cheapest way to fix an empty-looking screen is to reintroduce exactly one
 * fallback "just for the demo", and the next reader cannot tell which values
 * on their screen came from the ministry. Structure is what makes that a test
 * failure rather than a judgement call.
 */
describe("no fabricated ESIS data", () => {
  /*
   * ★ The assertion is about *values*, not about the key set.
   *
   * `summary` is allowed and is not a sample: it carries a column's position
   * in the table's reading order, which is a decision about layout, not a
   * claim about what ESIS returned. `omitReason` is allowed for the same kind
   * of reason — it cites the document that refuses the field.
   *
   * What must never come back is a key holding a *value a service might have
   * returned*. `sample` was exactly that, so the test names the keys a field
   * may carry rather than checking for one forbidden name: a future
   * `example`, `demo` or `placeholder` fails here without anybody remembering
   * to add it to a list.
   */
  it("gives no field an invented value", () => {
    const allowed = new Set(["name", "label", "io", "ingested", "omitReason", "summary"]);

    for (const entry of ESIS_RESOURCE_CATALOG) {
      for (const field of entry.fields) {
        const unexpected = Object.keys(field).filter((key) => !allowed.has(key));
        expect(unexpected, `${entry.key}.${field.name}`).toEqual([]);
      }
    }
  });

  it("publishes no demo row on any catalog entry", () => {
    for (const entry of ESIS_RESOURCE_CATALOG) {
      const keys = Object.keys(entry);
      expect(keys.filter((key) => /^sample/i.test(key)), entry.key).toEqual([]);
      expect(keys.filter((key) => /^(demo|mock|fixture)/i.test(key)), entry.key).toEqual([]);
    }
  });

  /*
   * ★ The transport has one mode. `EsisResponse.source` is narrowed to `"LIVE"`
   * in `esis.types.ts`, so a second transport cannot be added without widening
   * it back — which is a change a reviewer sees. This pins the runtime half:
   * every service reachable here is one the client will actually call.
   */
  it("routes every readable service through the live client", () => {
    for (const key of ESIS_READABLE_KEYS) {
      expect(ESIS_READERS[key].endpoint.path, key).toMatch(/^\/svc\//);
    }
  });
});
