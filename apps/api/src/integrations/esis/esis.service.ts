import { Injectable } from "@nestjs/common";
import { EsisClient } from "./esis.client";
import { EsisConfig } from "./esis.config";
import { ESIS_ENDPOINTS, esisPath } from "./esis.endpoints";
import {
  esisAttendanceUploadSchema,
  esisFoodDiscountStudentSchema,
  esisGroupSchema,
  esisListParser,
  esisOrganizationSchema,
  esisStaffSchema,
  esisStudentSchema,
  esisTeacherSchema,
  esisCheckParser,
  esisContactsParser,
  esisDiscoveredSchema,
  esisStudentAllergyUploadSchema,
  esisStudentProhibitedFoodUploadSchema,
  esisStudentDisabilityUploadSchema,
  esisStudentAssessmentUploadSchema,
  esisStudentMeasurementUploadSchema,
  esisStudentSurgeryUploadSchema,
  esisStudentIncidentUploadSchema,
  esisGroupMeasurementUploadSchema,
  esisStudentScreeningUploadSchema,
  type EsisStudentAllergyUpload,
  type EsisStudentProhibitedFoodUpload,
  type EsisStudentDisabilityUpload,
  type EsisStudentAssessmentUpload,
  type EsisStudentMeasurementUpload,
  type EsisStudentSurgeryUpload,
  type EsisStudentIncidentUpload,
  type EsisGroupMeasurementUpload,
  type EsisStudentScreeningUpload,
  esisStudentContactsUploadSchema,
  esisStudentStatisticsUploadSchema,
  esisStudentConditionUploadSchema,
  type EsisAttendanceUpload,
  type EsisStudentContactsUpload,
  type EsisStudentStatisticsUpload,
  type EsisStudentConditionUpload,
} from "./esis.schemas";
import type { EsisRequest, EsisResponse } from "./esis.types";
import {
  groupCreatePayloadSchema,
  groupDeletePayloadSchema,
  groupInstructorPayloadSchema,
  groupUpdatePayloadSchema,
} from "./esis-group-writes";

/**
 * Every ESIS service this product may read, and how its rows are parsed.
 *
 * ★ **A hand-written schema is the exception, not the rule** — 2026-09-15.
 *
 * `z.object()` drops what it does not name. Nine of thirty-six hand-written
 * readers named the wrong things, parsed happily and threw the ministry's real
 * payload away; a screen drew an empty column and it read as "this institution
 * has no data" (`ESIS_API_READINESS.md` §1.1). Two more were still doing it on
 * 2026-09-15.
 *
 * So a declared schema now exists only where a TypeScript file reads a named
 * property off the row — seven readers, listed and asserted in
 * `esis.service.test.ts`. There the field names are load-bearing and a silent
 * rename must break the build. Everywhere else `esisDiscoveredSchema` keeps
 * whatever arrived, and `esisFieldsFor` reads the columns off the response.
 *
 * ★★ The credential refusals still run. `esisDiscoveredSchema` strips them by
 * name, because a passthrough cannot express "I did not ask for that" by
 * omission — see `ESIS_DESTROYED_FIELDS`. Register numbers and civil ids
 * survive this parse since 2026-09-15 and are gated per caller instead — see
 * `ESIS_IDENTIFIER_FIELDS`.
 *
 * ★★★ **`groupAttendance` was declared as an eighth exception until
 * 2026-09-15, on the assumption that attendance reconciliation read its named
 * fields.** No such consumer exists — `attendance.service.ts` reads `groups`,
 * `groupStudents` and writes through `saveAttendance`, never this reader — so
 * it moved here with the rest. It was also the most fragile of the eight:
 * `esisAttendanceSchema` required `dayDate` and `attendanceReasonCode` as
 * non-nullable strings, unlike its siblings in this file that were hardened
 * after a live `null` in a required field threw away a whole list
 * (`group/list`'s `instructorId`, `teacher/list`'s `subjectDepartmentId`).
 * `groupAttendance` is reachable by a teacher through `GET …/esis/resource`,
 * so a `null` there would have landed on a real screen as "хариу гэрээнд
 * тохирохгүй" instead of a day's attendance.
 */
export const ESIS_READERS = {
  organization: { endpoint: ESIS_ENDPOINTS.organization, schema: esisOrganizationSchema },
  academicYearStatuses: {
    endpoint: ESIS_ENDPOINTS.academicYearStatuses,
    schema: esisDiscoveredSchema,
  },
  groups: { endpoint: ESIS_ENDPOINTS.groups, schema: esisGroupSchema },
  students: { endpoint: ESIS_ENDPOINTS.students, schema: esisStudentSchema },
  /*
   * ★ The register number is a path value the operator types, never a value we
   * store — see the endpoint's own note. It is the only reader whose parameter
   * is a personal identifier, which is why `esis-admin.service.ts` keeps it out
   * of the audit metadata.
   */
  studentByRegister: {
    endpoint: ESIS_ENDPOINTS.studentByRegister,
    schema: esisDiscoveredSchema,
    params: ["personRegNumber"],
  },
  studentInfo: {
    endpoint: ESIS_ENDPOINTS.studentInfo,
    schema: esisDiscoveredSchema,
    params: ["personRegNumber"],
  },
  groupStudents: {
    endpoint: ESIS_ENDPOINTS.groupStudents,
    schema: esisStudentSchema,
    params: ["studentGroupId"],
  },
  studentMovements: {
    endpoint: ESIS_ENDPOINTS.studentMovements,
    schema: esisDiscoveredSchema,
    params: ["beginDate"],
  },
  teachers: { endpoint: ESIS_ENDPOINTS.teachers, schema: esisTeacherSchema },
  staff: { endpoint: ESIS_ENDPOINTS.staff, schema: esisStaffSchema },
  groupAttendance: {
    endpoint: ESIS_ENDPOINTS.groupAttendance,
    schema: esisDiscoveredSchema,
    params: ["studentGroupId", "dayDate"],
  },
  foodProductTypes: {
    endpoint: ESIS_ENDPOINTS.foodProductTypes,
    schema: esisDiscoveredSchema,
    institution: false,
  },
  foodMaterialGroups: {
    endpoint: ESIS_ENDPOINTS.foodMaterialGroups,
    schema: esisDiscoveredSchema,
    institution: false,
  },
  foodMaterials: {
    endpoint: ESIS_ENDPOINTS.foodMaterials,
    schema: esisDiscoveredSchema,
    institution: false,
  },
  foodProducts: {
    endpoint: ESIS_ENDPOINTS.foodProducts,
    schema: esisDiscoveredSchema,
    institution: false,
  },
  // Institution-scoped, like `organization` — the flag defaults to true.
  buildings: { endpoint: ESIS_ENDPOINTS.buildings, schema: esisDiscoveredSchema },
  livelihoodForm1: {
    endpoint: ESIS_ENDPOINTS.livelihoodForm1,
    schema: esisDiscoveredSchema,
    params: ["academicYear", "academicMonth"],
  },
  livelihoodForm2: {
    endpoint: ESIS_ENDPOINTS.livelihoodForm2,
    schema: esisDiscoveredSchema,
    params: ["academicYear", "academicMonth", "studentGroupId"],
  },
  foodProductMaterials: {
    endpoint: ESIS_ENDPOINTS.foodProductMaterials,
    schema: esisDiscoveredSchema,
    institution: false,
  },
  /*
   * ★ Institution-scoped — the flag defaults to true, so it is absent here on
   * purpose. Unlike the reference data above it (`cook/material`,
   * `cook/product`), this list is *this kindergarten's children*, and a call
   * without `institutionId` would either fail or, worse, answer with somebody
   * else's roster.
   */
  foodDiscountStudents: {
    endpoint: ESIS_ENDPOINTS.foodDiscountStudents,
    schema: esisFoodDiscountStudentSchema,
  },
  foodKit: {
    endpoint: ESIS_ENDPOINTS.foodKit,
    schema: esisDiscoveredSchema,
    institution: false,
    params: ["productId"],
  },
  foodKitProducts: {
    endpoint: ESIS_ENDPOINTS.foodKitProducts,
    schema: esisDiscoveredSchema,
    institution: false,
    params: ["productId"],
  },

  /*
   * ── Added 2026-09-10 ────────────────────────────────────────────────────
   * All fourteen are institution-scoped: every one displays
   * `?institutionId=:institutionId` on the developer portal, and the three
   * whose page is not public (`studentCheck`, `studentStatistics`,
   * `studentCondition`) were given with that query by the client. The flag
   * therefore stays at its `true` default — unlike the national food catalog,
   * which rejects the filter.
   */
  /*
   * ★ `parse` overrides the default `esisListParser(schema)` — 2026-09-14.
   *
   * Two services do not put their rows in `RESULT`: `student/check` answers
   * with a bare scalar and `stdnt/all/contacts` with an object of named lists.
   *
   * ★★ **`schema` below is not what parses a row here** — 2026-09-15. It reads
   * `esisDiscoveredSchema`, the same as every reader with no domain consumer,
   * but `studentCheck`, `studentContacts` and `teacherCheck` are not
   * passthroughs: `getList`'s `parse ?? esisListParser(schema)` means the
   * override runs *instead of* `esisListParser(schema)`, and inside each
   * override every row is still validated against a hand-written schema —
   * `esisStudentCheckSchema` for the two check services below,
   * `esisStudentContactSchema` for contacts — with the same "drops what it
   * does not name" guarantee a declared reader has. `esis.fields.test.ts`'s
   * key-for-key check follows the real parsing schema for these three, not
   * this field. Read `schema` here as only "the type `EsisRow<K>` gets."
   */
  studentCheck: {
    endpoint: ESIS_ENDPOINTS.studentCheck,
    schema: esisDiscoveredSchema,
    params: ["personId"],
    parse: esisCheckParser(),
  },
  /*
   * ★★★ `bodyParams` — the only reader that sends one. `personId` travels in
   * the JSON body, not in the path (there is no `:personId` in it) and not in
   * the query. Without it the service answers `400 personId шаардлагатай`,
   * which is what the institution-level dry-run was getting.
   *
   * ★★★★ **Do not read the `esisDiscoveredSchema` line above as "this is a
   * true passthrough."** It is the richest PII surface in this catalogue —
   * guardian phone numbers, emails, job titles — and it stays whitelisted by
   * `esisContactsParser`'s call into `esisStudentContactSchema`. Converting it
   * to an actual passthrough is a real design question (the parser flattens
   * eleven named lists into rows first), not a cleanup, and is out of scope
   * here.
   */
  studentContacts: {
    endpoint: ESIS_ENDPOINTS.studentContacts,
    schema: esisDiscoveredSchema,
    params: ["personId"],
    bodyParams: ["personId"],
    parse: esisContactsParser(),
  },
  studentStatistics: {
    endpoint: ESIS_ENDPOINTS.studentStatistics,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  studentCondition: {
    endpoint: ESIS_ENDPOINTS.studentCondition,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  teacherAcademicOrg: {
    endpoint: ESIS_ENDPOINTS.teacherAcademicOrg,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  teacherMovements: {
    endpoint: ESIS_ENDPOINTS.teacherMovements,
    schema: esisDiscoveredSchema,
    params: ["beginDate"],
  },
  groupsNextYear: {
    endpoint: ESIS_ENDPOINTS.groupsNextYear,
    schema: esisDiscoveredSchema,
  },
  programs: {
    endpoint: ESIS_ENDPOINTS.programs,
    schema: esisDiscoveredSchema,
  },
  programStages: {
    endpoint: ESIS_ENDPOINTS.programStages,
    schema: esisDiscoveredSchema,
    params: ["programOfStudyId"],
  },
  programPlans: {
    endpoint: ESIS_ENDPOINTS.programPlans,
    schema: esisDiscoveredSchema,
    params: ["programOfStudyId", "programStageId"],
  },
  programCourses: {
    endpoint: ESIS_ENDPOINTS.programCourses,
    schema: esisDiscoveredSchema,
    params: ["programOfStudyId", "programStageId", "programPlanId"],
  },
  rooms: {
    endpoint: ESIS_ENDPOINTS.rooms,
    schema: esisDiscoveredSchema,
  },
  academicOrg: {
    endpoint: ESIS_ENDPOINTS.academicOrg,
    schema: esisDiscoveredSchema,
  },
  subjectAreas: {
    endpoint: ESIS_ENDPOINTS.subjectAreas,
    schema: esisDiscoveredSchema,
  },

  /*
   * ── Added 2026-09-14 ──────────────────────────────────────────────────
   *
   * ★ The six on `esisDiscoveredSchema` answered 203 for every child on this
   * institution, so their columns are read off the response rather than
   * declared — see `ESIS_DISCOVERED_SHAPE`. The schema still belongs here
   * because `EsisRow<K>` and the field-catalogue test are keyed off it.
   */
  studentAllergy: {
    endpoint: ESIS_ENDPOINTS.studentAllergy,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  studentProhibitedFood: {
    endpoint: ESIS_ENDPOINTS.studentProhibitedFood,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  studentDisability: {
    endpoint: ESIS_ENDPOINTS.studentDisability,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  studentSurgery: {
    endpoint: ESIS_ENDPOINTS.studentSurgery,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  studentIncident: {
    endpoint: ESIS_ENDPOINTS.studentIncident,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  studentScreening: {
    endpoint: ESIS_ENDPOINTS.studentScreening,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  studentAssessments: {
    endpoint: ESIS_ENDPOINTS.studentAssessments,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  studentMeasurements: {
    endpoint: ESIS_ENDPOINTS.studentMeasurements,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  /*
   * ★ Institution-scoped, all three — the flag defaults to true. `vaccineList`
   * looks like national reference data and is **not** exempt the way the food
   * catalogue is: without `institutionId` it answers `400 institutionId дутуу
   * байна`. Proven live.
   */
  vaccineCatalog: {
    endpoint: ESIS_ENDPOINTS.vaccineCatalog,
    schema: esisDiscoveredSchema,
  },
  vaccineHistory: {
    endpoint: ESIS_ENDPOINTS.vaccineHistory,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  vaccinePlan: {
    endpoint: ESIS_ENDPOINTS.vaccinePlan,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  groupMeasurements: {
    endpoint: ESIS_ENDPOINTS.groupMeasurements,
    schema: esisDiscoveredSchema,
    params: ["studentGroupId"],
  },
  /* The instrument itself: 25 questions, no institution filter accepted. */
  screeningQuestions: {
    endpoint: ESIS_ENDPOINTS.screeningQuestions,
    schema: esisDiscoveredSchema,
    institution: false,
  },
  schoolAttendance: {
    endpoint: ESIS_ENDPOINTS.schoolAttendance,
    schema: esisDiscoveredSchema,
    params: ["academicYear", "dayDate"],
  },
  /*
   * ★ `institution: false` — and it is the only reader in this table where
   * that is a warning rather than a detail. `/svc/api/public/worker/info`
   * takes no institution filter and answers for any worker in the national
   * database, so the scoping that protects every other read does not apply
   * here. `teacherCheck` is what confirms the person belongs to this
   * kindergarten; see the endpoint's note.
   */
  workerInfo: {
    endpoint: ESIS_ENDPOINTS.workerInfo,
    schema: esisDiscoveredSchema,
    institution: false,
    params: ["primaryNidNumber"],
  },
  teacherProfile: {
    endpoint: ESIS_ENDPOINTS.teacherProfile,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  /* Answers `["false"]` — the same scalar parser `studentCheck` uses. */
  teacherCheck: {
    endpoint: ESIS_ENDPOINTS.teacherCheck,
    schema: esisDiscoveredSchema,
    params: ["personId"],
    parse: esisCheckParser(),
  },

  /*
   * ── Closed 2026-09-17, plan `2026-09-16-esis-sync-tiers.md` Task 9 ──────
   * See the endpoint notes in `esis.endpoints.ts` for what each was probed
   * against and what it answered live.
   */
  studentAwards: {
    endpoint: ESIS_ENDPOINTS.studentAwards,
    schema: esisDiscoveredSchema,
    params: ["personId"],
  },
  studentSearch: {
    endpoint: ESIS_ENDPOINTS.studentSearch,
    schema: esisDiscoveredSchema,
    params: ["civilId"],
  },
  buildingByRegisterNumber: {
    endpoint: ESIS_ENDPOINTS.buildingByRegisterNumber,
    schema: esisDiscoveredSchema,
    params: ["registerNumber"],
  },
} as const satisfies Record<
  string,
  {
    // "GET" | "POST": a read is not always a GET. `studentContacts` is a
    // lookup the ministry answers only over POST — see `esis.endpoints.ts`.
    endpoint: { method: "GET" | "POST"; path: string };
    schema: import("zod").ZodType;
    institution?: boolean;
    params?: readonly string[];
    /** Params sent in the JSON body instead of substituted into the path. */
    bodyParams?: readonly string[];
    /** Replaces `esisListParser(schema)` when RESULT is not the row list. */
    parse?: (body: unknown) => unknown[];
  }
>;

/**
 * A service the operator screen may read.
 *
 * Membership of this table — not the HTTP verb — is what makes a service a
 * read; the write services (`*Save`, `saveAttendanceV3`) are absent from it.
 */
export type EsisReadableKey = keyof typeof ESIS_READERS;

export const ESIS_READABLE_KEYS = Object.keys(ESIS_READERS) as EsisReadableKey[];

/**
 * The parsed row type of one readable service.
 *
 * ★ Keeps `read()` generic so `organization()` still returns organisations.
 * Routing every domain method through one table is what made the operator
 * screen possible; it should not cost the type the callers had before.
 */
export type EsisRow<K extends EsisReadableKey> = import("zod").infer<
  (typeof ESIS_READERS)[K]["schema"]
>;

/** Which path values a readable service needs before it can be called. */
export function esisReaderParams(key: EsisReadableKey): readonly string[] {
  return (ESIS_READERS[key] as { params?: readonly string[] }).params ?? [];
}

/**
 * The application-facing entry point to ESIS.
 *
 * Domain methods are limited to services selected from the official ESIS v2
 * catalog. They remove the ESIS envelope and discard fields NomadKids does not
 * need. The attendance workflow resolves external IDs from the live tenant
 * roster; bulk imports remain a separate, operator-approved synchronization
 * concern.
 */
@Injectable()
export class EsisService {
  constructor(
    private readonly client: EsisClient,
    private readonly config: EsisConfig,
  ) {}

  /**
   * Whether this deployment can talk to ESIS at all.
   *
   * ★ Callers must check this rather than catching `not_configured`. An
   * integration that is switched off is an ordinary state — most deployments
   * during rollout — and treating it as an exception makes ordinary operation
   * look like failure in the logs.
   */
  get isConfigured(): boolean {
    return this.config.isConfigured;
  }

  get isAvailable(): boolean {
    return this.config.isAvailable;
  }

  /** Safe to show an operator: no token, not even its length. */
  status(): ReturnType<EsisConfig["describe"]> {
    return this.config.describe();
  }

  /**
   * Low-level escape hatch for a catalog endpoint without a domain method.
   *
   * Pass `parse` to keep response validation at this boundary. New product
   * features should normally use one of the named methods below.
   */
  async request<T = unknown>(options: EsisRequest): Promise<EsisResponse<T>> {
    return this.client.request<T>(options);
  }

  /**
   * Reads one catalog service by key.
   *
   * ★ The operator screen's "ESIS-ээс татах" button needs a resource chosen at
   * runtime, which a set of hand-named methods cannot express. It stays safe
   * because `key` is one of `ESIS_READERS` — a caller cannot reach a path that is
   * not in the reviewed catalog, and `esisPath` still refuses an unresolved
   * parameter rather than calling ESIS with a literal `:studentGroupId`.
   */
  read<K extends EsisReadableKey>(
    key: K,
    params: Record<string, string | number> = {},
    institutionId?: string | number,
  ): Promise<EsisResponse<EsisRow<K>[]>> {
    /*
     * Through `unknown`: inside the generic body `ESIS_READERS[key]` widens to
     * the union of all seventeen readers, which TypeScript will not narrow to
     * `K`'s own entry. The table is keyed by the same `K` that types the return,
     * so the two cannot disagree — `esis.fields.test.ts` re-checks the pairing
     * at runtime for every key.
     */
    const reader = ESIS_READERS[key] as unknown as {
      endpoint: { method: "GET" | "POST"; path: string };
      schema: import("zod").ZodType<EsisRow<K>>;
      institution?: boolean;
      bodyParams?: readonly string[];
      parse?: (body: unknown) => unknown[];
    };

    /*
     * A body param is not a path param: it must not also be substituted into
     * the path, and `esisPath` would leave it there untouched anyway. Splitting
     * them here keeps `getList` from having to know which is which.
     */
    const bodyParams = reader.bodyParams ?? [];
    const body = Object.fromEntries(
      bodyParams.flatMap((name) => (name in params ? [[name, params[name]!] as const] : [])),
    );

    return this.getList(
      key,
      reader.endpoint,
      reader.schema,
      Object.fromEntries(Object.entries(params).filter(([name]) => !bodyParams.includes(name))),
      reader.institution !== false,
      institutionId,
      bodyParams.length > 0 ? body : undefined,
      reader.parse as ((body: unknown) => EsisRow<K>[]) | undefined,
    );
  }

  organization(institutionId: string | number) {
    return this.read("organization", {}, institutionId);
  }

  buildings(institutionId: string | number) {
    return this.read("buildings", {}, institutionId);
  }

  academicYearStatuses(institutionId: string | number) {
    return this.read("academicYearStatuses", {}, institutionId);
  }

  groups(institutionId: string | number) {
    return this.read("groups", {}, institutionId);
  }

  students(institutionId: string | number) {
    return this.read("students", {}, institutionId);
  }

  groupStudents(institutionId: string | number, studentGroupId: string | number) {
    return this.read("groupStudents", { studentGroupId }, institutionId);
  }

  studentMovements(institutionId: string | number, beginDate: string) {
    return this.read("studentMovements", { beginDate }, institutionId);
  }

  teachers(institutionId: string | number) {
    return this.read("teachers", {}, institutionId);
  }

  staff(institutionId: string | number) {
    return this.read("staff", {}, institutionId);
  }

  groupAttendance(
    institutionId: string | number,
    studentGroupId: string | number,
    dayDate: string,
  ) {
    return this.read("groupAttendance", { studentGroupId, dayDate }, institutionId);
  }

  async saveAttendance(input: EsisAttendanceUpload) {
    const parsed = esisAttendanceUploadSchema.parse(input);
    return this.client.request({
      path: ESIS_ENDPOINTS.saveAttendanceV3.path,
      method: ESIS_ENDPOINTS.saveAttendanceV3.method,
      body: parsed,
    });
  }

  foodProductTypes() {
    return this.read("foodProductTypes");
  }

  foodMaterialGroups() {
    return this.read("foodMaterialGroups");
  }

  foodMaterials() {
    return this.read("foodMaterials");
  }

  foodProducts() {
    return this.read("foodProducts");
  }

  foodProductMaterials() {
    return this.read("foodProductMaterials");
  }

  /** Which children the state subsidises the meals of — `нэмэлт.md` §3. */
  foodDiscountStudents(institutionId: string | number) {
    return this.read("foodDiscountStudents", {}, institutionId);
  }

  foodKit(productId: string | number) {
    return this.read("foodKit", { productId });
  }

  foodKitProducts(productId: string | number) {
    return this.read("foodKitProducts", { productId });
  }

  /* ── Суралцагчийн нэмэлт мэдээлэл ─────────────────────────────────────── */

  studentCheck(institutionId: string | number, personId: string | number) {
    return this.read("studentCheck", { personId }, institutionId);
  }

  studentContacts(institutionId: string | number, personId: string | number) {
    return this.read("studentContacts", { personId }, institutionId);
  }

  studentStatistics(institutionId: string | number, personId: string | number) {
    return this.read("studentStatistics", { personId }, institutionId);
  }

  studentCondition(institutionId: string | number, personId: string | number) {
    return this.read("studentCondition", { personId }, institutionId);
  }

  /* ── Багш ─────────────────────────────────────────────────────────────── */

  teacherAcademicOrg(institutionId: string | number, personId: string | number) {
    return this.read("teacherAcademicOrg", { personId }, institutionId);
  }

  teacherMovements(institutionId: string | number, beginDate: string) {
    return this.read("teacherMovements", { beginDate }, institutionId);
  }

  /* ── Бүлэг, хөтөлбөр, орчин ───────────────────────────────────────────── */

  groupsNextYear(institutionId: string | number) {
    return this.read("groupsNextYear", {}, institutionId);
  }

  programs(institutionId: string | number) {
    return this.read("programs", {}, institutionId);
  }

  programStages(institutionId: string | number, programOfStudyId: string | number) {
    return this.read("programStages", { programOfStudyId }, institutionId);
  }

  programPlans(
    institutionId: string | number,
    programOfStudyId: string | number,
    programStageId: string | number,
  ) {
    return this.read("programPlans", { programOfStudyId, programStageId }, institutionId);
  }

  programCourses(
    institutionId: string | number,
    programOfStudyId: string | number,
    programStageId: string | number,
    programPlanId: string | number,
  ) {
    return this.read(
      "programCourses",
      { programOfStudyId, programStageId, programPlanId },
      institutionId,
    );
  }

  rooms(institutionId: string | number) {
    return this.read("rooms", {}, institutionId);
  }

  academicOrg(institutionId: string | number) {
    return this.read("academicOrg", {}, institutionId);
  }

  subjectAreas(institutionId: string | number) {
    return this.read("subjectAreas", {}, institutionId);
  }

  /* ── Added 2026-09-14 ─────────────────────────────────────────────────── */

  studentAllergy(institutionId: string | number, personId: string | number) {
    return this.read("studentAllergy", { personId }, institutionId);
  }

  studentProhibitedFood(institutionId: string | number, personId: string | number) {
    return this.read("studentProhibitedFood", { personId }, institutionId);
  }

  studentDisability(institutionId: string | number, personId: string | number) {
    return this.read("studentDisability", { personId }, institutionId);
  }

  studentAssessments(institutionId: string | number, personId: string | number) {
    return this.read("studentAssessments", { personId }, institutionId);
  }

  studentMeasurements(institutionId: string | number, personId: string | number) {
    return this.read("studentMeasurements", { personId }, institutionId);
  }

  studentSurgery(institutionId: string | number, personId: string | number) {
    return this.read("studentSurgery", { personId }, institutionId);
  }

  studentIncident(institutionId: string | number, personId: string | number) {
    return this.read("studentIncident", { personId }, institutionId);
  }

  studentScreening(institutionId: string | number, personId: string | number) {
    return this.read("studentScreening", { personId }, institutionId);
  }

  vaccineCatalog(institutionId: string | number) {
    return this.read("vaccineCatalog", {}, institutionId);
  }

  vaccineHistory(institutionId: string | number, personId: string | number) {
    return this.read("vaccineHistory", { personId }, institutionId);
  }

  vaccinePlan(institutionId: string | number, personId: string | number) {
    return this.read("vaccinePlan", { personId }, institutionId);
  }

  groupMeasurements(institutionId: string | number, studentGroupId: string | number) {
    return this.read("groupMeasurements", { studentGroupId }, institutionId);
  }

  screeningQuestions() {
    return this.read("screeningQuestions", {});
  }

  schoolAttendance(institutionId: string | number, academicYear: string | number, dayDate: string) {
    return this.read("schoolAttendance", { academicYear, dayDate }, institutionId);
  }

  /**
   * One worker, by the register number an operator typed.
   *
   * ★ No `institutionId` — the service does not take one. Every other read on
   * this class is scoped to a kindergarten by its argument; this one is not,
   * and the caller is responsible for confirming the person belongs here with
   * `teacherCheck` before acting on the answer.
   */
  workerInfo(primaryNidNumber: string) {
    return this.read("workerInfo", { primaryNidNumber });
  }

  teacherProfile(institutionId: string | number, personId: string | number) {
    return this.read("teacherProfile", { personId }, institutionId);
  }

  teacherCheck(institutionId: string | number, personId: string | number) {
    return this.read("teacherCheck", { personId }, institutionId);
  }

  /* ── Closed 2026-09-17 ────────────────────────────────────────────────── */

  studentAwards(institutionId: string | number, personId: string | number) {
    return this.read("studentAwards", { personId }, institutionId);
  }

  /**
   * A child found by the civil registry number an operator types.
   *
   * ★ Institution-scoped, unlike `workerInfo` — see the endpoint's note.
   */
  studentSearch(institutionId: string | number, civilId: string) {
    return this.read("studentSearch", { civilId }, institutionId);
  }

  /**
   * One building, by the kindergarten's own government register number.
   *
   * ★ The number is operator-typed and institution-scoped — see the
   * endpoint's note on why `organization/info` cannot supply it.
   */
  buildingByRegisterNumber(institutionId: string | number, registerNumber: string) {
    return this.read("buildingByRegisterNumber", { registerNumber }, institutionId);
  }

  /*
   * ── The three writes ──────────────────────────────────────────────────────
   *
   * ★ Each parses before it sends, exactly as `saveAttendance` does. The parse
   * is not ceremony: the upload schemas are `.strict()`, so a key this product
   * invented cannot reach the ministry's database — it fails here instead.
   *
   * ★★ `demoFixture` is the endpoint key, so a deployment without a token gets
   * the generic DEMO_SUCCESS envelope rather than a network call. Nothing is
   * sent to ESIS until `ESIS_TOKEN` is set.
   */

  async saveStudentContacts(input: EsisStudentContactsUpload) {
    const parsed = esisStudentContactsUploadSchema.parse(input);
    return this.client.request({
      path: ESIS_ENDPOINTS.studentContactsSave.path,
      method: ESIS_ENDPOINTS.studentContactsSave.method,
      body: parsed,
    });
  }

  async saveStudentStatistics(input: EsisStudentStatisticsUpload) {
    const parsed = esisStudentStatisticsUploadSchema.parse(input);
    return this.client.request({
      path: ESIS_ENDPOINTS.studentStatisticsSave.path,
      method: ESIS_ENDPOINTS.studentStatisticsSave.method,
      body: parsed,
    });
  }

  async saveStudentCondition(input: EsisStudentConditionUpload) {
    const parsed = esisStudentConditionUploadSchema.parse(input);
    return this.client.request({
      path: ESIS_ENDPOINTS.studentConditionSave.path,
      method: ESIS_ENDPOINTS.studentConditionSave.method,
      body: parsed,
    });
  }

  /* ── The ten health writes — added 2026-09-14 ─────────────────────────────
   *
   * ★ Same shape as the three above: parse with a `.strict()` schema, then
   * send. The parse is the guard that matters here, because **none of these
   * input contracts has been confirmed** — a read reveals an output shape and
   * nothing reveals an input shape. Strict means a field this product invented
   * fails in our own validation rather than arriving in the ministry's
   * database.
   *
   * ★★ No caller loops over these. Every one is reached from an explicit
   * operator action on a screen, which is the condition `esis.endpoints.ts`
   * set when it refused the food-income saves: a write gets wired when
   * something here is the thing that files it. An unproven contract behind a
   * background sync would be a different and much worse proposition.
   */

  async saveStudentAllergy(input: EsisStudentAllergyUpload) {
    return this.send(
      ESIS_ENDPOINTS.studentAllergySave,
      esisStudentAllergyUploadSchema.parse(input),
    );
  }

  async saveStudentProhibitedFood(input: EsisStudentProhibitedFoodUpload) {
    return this.send(
      ESIS_ENDPOINTS.studentProhibitedFoodSave,
      esisStudentProhibitedFoodUploadSchema.parse(input),
    );
  }

  async saveStudentDisability(input: EsisStudentDisabilityUpload) {
    return this.send(
      ESIS_ENDPOINTS.studentDisabilitySave,
      esisStudentDisabilityUploadSchema.parse(input),
    );
  }

  async saveStudentAssessment(input: EsisStudentAssessmentUpload) {
    return this.send(
      ESIS_ENDPOINTS.studentAssessmentsSave,
      esisStudentAssessmentUploadSchema.parse(input),
    );
  }

  async saveStudentMeasurement(input: EsisStudentMeasurementUpload) {
    return this.send(
      ESIS_ENDPOINTS.studentMeasurementSave,
      esisStudentMeasurementUploadSchema.parse(input),
    );
  }

  async saveStudentSurgery(input: EsisStudentSurgeryUpload) {
    return this.send(
      ESIS_ENDPOINTS.studentSurgerySave,
      esisStudentSurgeryUploadSchema.parse(input),
    );
  }

  async saveStudentIncident(input: EsisStudentIncidentUpload) {
    return this.send(
      ESIS_ENDPOINTS.studentIncidentSave,
      esisStudentIncidentUploadSchema.parse(input),
    );
  }

  async saveGroupMeasurements(input: EsisGroupMeasurementUpload) {
    return this.send(
      ESIS_ENDPOINTS.groupMeasurementsSave,
      esisGroupMeasurementUploadSchema.parse(input),
    );
  }

  async saveStudentScreening(input: EsisStudentScreeningUpload) {
    return this.send(
      ESIS_ENDPOINTS.studentScreeningSave,
      esisStudentScreeningUploadSchema.parse(input),
    );
  }

  /*
   * ★ `studentAttachmentSave` has no method here, deliberately. It is in the
   * catalogue so the grant is visible, and sending a child's medical document
   * to a third party is a consent decision rather than a call — see the
   * endpoint's note and CLAUDE.md §1.4.
   */

  /*
   * ── Бүлгийн бичих гурав, spec №3б ──────────────────────────────────────
   *
   * ★ These are **not** reachable from `EsisAdminService.write`, and must not
   * become so. That route is the immediate one, open to a teacher, and it
   * takes the payload from the caller. A group write is built from our own
   * `Group` by `esis-group-writes.ts`, stored, shown to a director and only
   * then sent — `esis-write.sender.ts` is the one caller of these three.
   *
   * ★★ The payload is parsed **again** here, after the harness already parsed
   * it at prepare time. That is deliberate rather than redundant: the row has
   * been sitting in a table between those two moments, and this is the layer
   * that must not post a shape nobody checked.
   */
  async sendGroupCreate(body: unknown) {
    return this.send(ESIS_ENDPOINTS.groupCreate, groupCreatePayloadSchema.parse(body));
  }

  /*
   * ★ A delete has its **own** method and its own schema, found the hard way on
   * 2026-09-18: it posts to 152 exactly as an update does, so it was routed
   * through `sendGroupUpdate` — whose `.strict()` update schema then rejected
   * it, because a delete carries no `studentGroupName` and no programme ids.
   * The boundary parse is supposed to catch a shape nobody checked; here it was
   * catching the right shape against the wrong contract.
   */
  async sendGroupDelete(body: unknown) {
    return this.send(ESIS_ENDPOINTS.groupUpdate, groupDeletePayloadSchema.parse(body));
  }

  async sendGroupUpdate(body: unknown) {
    return this.send(ESIS_ENDPOINTS.groupUpdate, groupUpdatePayloadSchema.parse(body));
  }

  async sendGroupInstructor(body: unknown) {
    return this.send(ESIS_ENDPOINTS.groupInstructor, groupInstructorPayloadSchema.parse(body));
  }

  /** One write, parsed and posted. Never retried — see `EsisClient.request`. */
  private send(endpoint: { method: "GET" | "POST"; path: string }, body: unknown) {
    return this.client.request({ path: endpoint.path, method: endpoint.method, body });
  }

  /*
   * ★ `method` is `"GET" | "POST"`, not `"GET"`.
   *
   * A read is not always a GET: `studentContacts` — "Гэр бүлийн мэдээлэл
   * лавлах" — is a lookup the ministry answers only over POST, proven by probe
   * in `esis.endpoints.ts`. Narrowing this to `"GET"` would refuse to compile
   * the moment that fact was written down, which is the wrong way round: the
   * transport is the ministry's to decide, and this signature should be able
   * to express whatever they chose.
   *
   * ★★ **It does want a body, and 2026-09-14 found out which.** The paragraph
   * that stood here said a JSON body was "discoverable only once the service is
   * actually granted — every call currently answers 403". It is granted now,
   * and the answer is `400 personId шаардлагатай`: `studentContacts` is a
   * per-child lookup that takes `{ personId }` in the body. `institutionId`
   * stays in the query, as documented. `bodyParams` on the reader carries it.
   */
  private async getList<T>(
    key: EsisReadableKey,
    endpoint: { method: "GET" | "POST"; path: string },
    schema: import("zod").ZodType<T>,
    pathValues: Record<string, string | number> = {},
    institutionScoped = true,
    institutionId?: string | number,
    body?: Record<string, string | number>,
    parse?: (body: unknown) => T[],
  ): Promise<EsisResponse<T[]>> {
    if (institutionScoped && institutionId === undefined) {
      throw new Error("ESIS institutionId is required for this resource");
    }
    return this.client.request<T[]>({
      path: esisPath(endpoint.path, pathValues),
      method: endpoint.method,
      query: institutionScoped ? { institutionId } : undefined,
      body,
      parse: parse ?? esisListParser(schema),
    });
  }
}
