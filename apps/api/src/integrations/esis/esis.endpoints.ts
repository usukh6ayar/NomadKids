/**
 * ESIS v2 services used by NomadKids.
 *
 * Source: https://developerv2.esis.edu.mn/api/structure, reviewed 2026-09-09.
 * Keep the API id beside the path: access is granted per service in the ESIS
 * developer portal, so an operator needs both when requesting or auditing a
 * token's scope.
 */
export interface EsisEndpoint {
  /**
   * The portal's own id for the service, or `null` when it is not yet read.
   */
  apiId: number | null;
  slug: string;
  method: "GET" | "POST";
  path: string;
}

const endpoint = <T extends EsisEndpoint>(value: T): T => value;

export const ESIS_ENDPOINTS = {
  organization: endpoint({
    apiId: 59,
    slug: "API-000158",
    method: "GET",
    path: "/svc/api/hub/v2/organization/info",
  }),
  /*
   * The kindergarten's buildings — RFP §3.2's premises, as the ministry keeps
   * them.
   *
   * ★ `room/list` (api-29) is its companion and **is now here too** — added
   * 2026-09-10 at the client's request for "сургалтын орчны ерөнхий
   * мэдээллүүд". This note used to say a room list was the seating plan and
   * would "join the catalog the day a screen needs it"; that day is this one,
   * and the note is rewritten rather than left to contradict the entry six
   * lines below it. See `rooms`.
   */
  buildings: endpoint({
    apiId: 100004874669798,
    slug: "api-28",
    method: "GET",
    path: "/svc/api/hub/v2/building/list",
  }),
  academicYearStatuses: endpoint({
    apiId: 61,
    slug: "API-000160",
    method: "GET",
    path: "/svc/api/hub/v2/academic/year/statuses",
  }),
  groups: endpoint({
    apiId: 100004874669811,
    slug: "api-40",
    method: "GET",
    path: "/svc/api/hub/v2/group/list",
  }),
  students: endpoint({
    apiId: 100004874669777,
    slug: "api-8",
    method: "GET",
    path: "/svc/api/hub/v2/students/list",
  }),
  /**
   * One child, found by the register number the operator types.
   *
   * ★ **This does not weaken `ESIS_REQUEST.md` §1.1 (b).** That paragraph
   * refuses to *receive and keep* register numbers: `personRegNumber` is a
   * refused output on every roster service and is stored nowhere. Here the
   * number travels the other way — authorised staff already has the child's
   * registration document in front of them and types it in to find the ESIS
   * record. We send it, we never save it, and the response is minimised by the
   * API-000144-specific field list.
   *
   * API-000144 was checked against the public developer portal on 2026-09-09.
   * Its second required input, `institutionId`, is added as the query parameter
   * by `EsisService.getList`, as it is for every institution-scoped reader.
   */
  studentByRegister: endpoint({
    apiId: 45,
    slug: "API-000144",
    method: "GET",
    path: "/svc/api/hub/v2/student/:personRegNumber",
  }),
  /**
   * One child's record, by the register number the kindergarten already holds.
   *
   * ★ Path from the client, 2026-09-09; the public catalog page truncates
   * before the суралцагч block, so the field list below is our parsing schema's
   * rather than the portal's — marked `ADAPTER` for that reason.
   *
   * ★★ It does not weaken `ESIS_REQUEST.md` §1.1 (b) any more than
   * `studentByRegister` does. The number travels *to* ESIS: it is the child's
   * own регистр, already on their record here because this product collects it
   * (the roster has a Регистр column). `personRegNumber` stays a refused output,
   * and `read` keeps the value out of the audit row.
   */
  studentInfo: endpoint({
    apiId: 147,
    slug: "API-000147",
    method: "GET",
    path: "/svc/api/hub/v2/student/info/:personRegNumber",
  }),
  groupStudents: endpoint({
    apiId: 100004874669783,
    slug: "api-13",
    method: "GET",
    path: "/svc/api/hub/v2/group/student/list/:studentGroupId",
  }),
  studentMovements: endpoint({
    apiId: 100004874669778,
    slug: "2",
    method: "GET",
    path: "/svc/api/hub/v2/student/movement/v2/:beginDate",
  }),
  teachers: endpoint({
    apiId: 100004874669812,
    slug: "api-41",
    method: "GET",
    path: "/svc/api/hub/v2/teacher/list",
  }),
  staff: endpoint({
    apiId: 55,
    slug: "API-000154",
    method: "GET",
    path: "/svc/api/hub/v2/school/staff",
  }),
  groupAttendance: endpoint({
    apiId: 100004874669792,
    slug: "api-22",
    method: "GET",
    path: "/svc/api/hub/v2/group/list/attendance/:studentGroupId/:dayDate",
  }),
  saveAttendanceV3: endpoint({
    apiId: 171,
    slug: "API-000269",
    method: "POST",
    path: "/svc/api/hub/v2/group/school/attendance/save/v3",
  }),
  foodProductTypes: endpoint({
    apiId: 111,
    slug: "API-000210",
    method: "GET",
    path: "/svc/api/hub/v2/cook/product/type",
  }),
  foodMaterialGroups: endpoint({
    apiId: 112,
    slug: "API-000211",
    method: "GET",
    path: "/svc/api/hub/v2/cook/materialGroup",
  }),
  foodMaterials: endpoint({
    apiId: 123,
    slug: "API-000222",
    method: "GET",
    path: "/svc/api/hub/v2/cook/material",
  }),
  foodProducts: endpoint({
    apiId: 124,
    slug: "API-000223",
    method: "GET",
    path: "/svc/api/hub/v2/cook/product",
  }),
  foodProductMaterials: endpoint({
    apiId: 125,
    slug: "API-000224",
    method: "GET",
    path: "/svc/api/hub/v2/cook/productMaterials",
  }),
  /*
   * The two "төвлөрүүлэх орлого" statements — `нэмэлт.md`'s food income, as the
   * ministry keeps it.
   *
   * ★ Read services only. The catalog also has `POST /cook/form1/…/save` and
   * its form-2 twin, and neither is here: filing a school's income return is a
   * decision an accountant makes against their own ledger, and nothing in this
   * product is close to being the thing that files it. When it is, they get
   * added the way `saveAttendanceV3` was — as inputs, next to the read.
   */
  livelihoodForm1: endpoint({
    apiId: 130,
    slug: "API-000229",
    method: "GET",
    path: "/svc/api/hub/v2/cook/form1/school/list/:academicYear/:academicMonth",
  }),
  livelihoodForm2: endpoint({
    apiId: 132,
    slug: "API-000231",
    method: "GET",
    path: "/svc/api/hub/v2/cook/form2/school/list/:academicYear/:academicMonth/:studentGroupId",
  }),
  foodKit: endpoint({
    apiId: 126,
    slug: "API-000225",
    method: "GET",
    path: "/svc/api/hub/v2/cook/kit/:productId",
  }),
  foodKitProducts: endpoint({
    apiId: 127,
    slug: "API-000226",
    method: "GET",
    path: "/svc/api/hub/v2/cook/kit/product/:productId",
  }),
  /*
   * ────────────────────────────────────────────────────────────────────────
   * Суралцагчийн нэмэлт мэдээлэл — added 2026-09-10 at the client's request.
   *
   * ★ **These seven are not in the portal's public catalog page.** That page
   * renders only the Хоол, Багш and Байгууллага sections; the Суралцагч
   * section needs a signed-in session, so the paths below come from the
   * client's own list rather than from `developerv2.esis.edu.mn/api/structure`.
   * `slug: "UNLISTED"` and `apiId: null` say exactly that on the operator
   * screen ("ID тодруулах"), because access is granted per service id and the
   * id is the one thing our side cannot supply.
   *
   * ★★ **Three of them are writes**, which is a change of policy this file
   * recorded twice before: `saveAttendanceV3` was the only write we carried,
   * and the food form1/form2 saves were refused because "nothing in this
   * product is close to being the thing that files it". The client asked for
   * these three with their read pairs on 2026-09-10 — the product *is* the
   * thing that records a child's guardians and household — so they are here
   * with screens that send them, which is the condition the refusal named.
   * ────────────────────────────────────────────────────────────────────────
   */

  /**
   * Whether ESIS already holds this child.
   *
   * ★ **UNVERIFIED, and marked so on purpose.** The client asked for this path
   * and asked for it to be checked; the public catalog's only `check` service
   * is `api-11` `HUB_SERVICE_SCHOOL_SEARCH_TEACHER_CHECK_UPDATE` at
   * `/teacher/check/:personId` — the *teacher* check, not this. The student
   * section is not publicly rendered, so "absent from the portal page" is not
   * evidence of absence. It is carried with the source marked `ADAPTER` and
   * the catalog note saying the portal name is unconfirmed; the first live
   * call against a real token settles it.
   */
  studentCheck: endpoint({
    apiId: null,
    slug: "UNLISTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/check/:personId",
  }),
  /**
   * Every guardian contact the institution holds, for the whole roster.
   *
   * ★ **POST, and it is a read.** The ministry's own service list
   * (`all-services.xlsx`, row 34, "Гэр бүлийн мэдээлэл лавлах") says POST, and
   * a live probe against the real hub on 2026-09-11 settles it rather than
   * leaving two sources disagreeing:
   *
   * ```
   * GET  /svc/api/hub/v2/stdnt/all/contacts → 404 "Зам олдсонгүй: GET"
   * POST /svc/api/hub/v2/stdnt/all/contacts → 403 "Энэ API-д хандах эрх байхгүй"
   * ```
   *
   * A nonsense path returns the same 404 and every other real service returns
   * the same 403, so the pair is conclusive: the route does not exist for GET
   * and does exist for POST. It was carried as GET from the client-supplied
   * list #90 worked from — that list is the older source.
   *
   * ★★ `direction` in `esis.catalog.ts` is derived from **readability**, not
   * from this field, precisely so that a lookup issued over POST is not
   * reported to the operator as data flowing NomadKids → ESIS.
   */
  studentContacts: endpoint({
    apiId: null,
    slug: "UNLISTED",
    method: "POST",
    path: "/svc/api/hub/v2/stdnt/all/contacts",
  }),
  studentContactsSave: endpoint({
    apiId: null,
    slug: "UNLISTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/contacts/save",
  }),
  /** One child's household statistics — өрхийн мэдээлэл. */
  studentStatistics: endpoint({
    apiId: null,
    slug: "UNLISTED",
    method: "GET",
    path: "/svc/api/hub/v2/stdnt/statistics/info/:personId",
  }),
  studentStatisticsSave: endpoint({
    apiId: null,
    slug: "UNLISTED",
    method: "POST",
    path: "/svc/api/hub/v2/stdnt/statistics/info/save",
  }),
  /** One child's living conditions — амьдрах орчин. */
  studentCondition: endpoint({
    apiId: null,
    slug: "UNLISTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/live/condition/:personId",
  }),
  studentConditionSave: endpoint({
    apiId: null,
    slug: "UNLISTED",
    method: "POST",
    path: "/svc/api/hub/v2/condition/save",
  }),

  /*
   * ── Багш ────────────────────────────────────────────────────────────────
   * Both read from the portal's public catalog, so both carry their real
   * slug. The numeric ids are not printed on that page for `api-*` services,
   * which is why `apiId` stays null and the screen says "ID тодруулах".
   */
  teacherAcademicOrg: endpoint({
    apiId: null,
    slug: "api-34",
    method: "GET",
    path: "/svc/api/hub/v2/teacher/academic/org/:personId",
  }),
  teacherMovements: endpoint({
    apiId: null,
    slug: "api-12",
    method: "GET",
    path: "/svc/api/hub/v2/teacher/movements/:beginDate",
  }),

  /*
   * ── Бүлэг ───────────────────────────────────────────────────────────────
   * ★ The client asked for a "татах, илгээх" pair on the group screen. There
   * is no group *write* service in the portal's catalog, so nothing is
   * invented to fill the second half: this is the read that the ahead-of-time
   * question ("what will next year's groups be?") actually needs, and it is
   * what `POST /v1/groups/:id/promotions` has been missing a source for.
   */
  groupsNextYear: endpoint({
    apiId: null,
    slug: "API-000113",
    method: "GET",
    path: "/svc/api/hub/v2/group/next/academicYear",
  }),

  /*
   * ── Хөтөлбөр ────────────────────────────────────────────────────────────
   * Four services in one chain: программ → үе шат → төлөвлөгөө → хичээл. Each
   * takes the ids the one above it returns, which is why they get a screen of
   * their own (`/admin/curriculum`) rather than four unrelated panels.
   */
  programs: endpoint({
    apiId: null,
    slug: "api-42",
    method: "GET",
    path: "/svc/api/hub/v2/program/list",
  }),
  programStages: endpoint({
    apiId: null,
    slug: "api-43",
    method: "GET",
    path: "/svc/api/hub/v2/program/stage/list/:programOfStudyId",
  }),
  programPlans: endpoint({
    apiId: null,
    slug: "api-2",
    method: "GET",
    path: "/svc/api/hub/v2/program/stage/plan/list/:programOfStudyId/:programStageId",
  }),
  programCourses: endpoint({
    apiId: null,
    slug: "api-44",
    method: "GET",
    path: "/svc/api/hub/v2/program/stage/plan/course/list/:programOfStudyId/:programStageId/:programPlanId",
  }),

  /*
   * ── Сургалтын орчин ─────────────────────────────────────────────────────
   * The premises beyond the building: its rooms, the institution's academic
   * units, and the subject areas its programmes draw on.
   */
  rooms: endpoint({
    apiId: null,
    slug: "api-29",
    method: "GET",
    path: "/svc/api/hub/v2/room/list",
  }),
  academicOrg: endpoint({
    apiId: null,
    slug: "api-26",
    method: "GET",
    path: "/svc/api/hub/v2/academic/org",
  }),
  subjectAreas: endpoint({
    apiId: null,
    slug: "api-27",
    method: "GET",
    path: "/svc/api/hub/v2/subject/area",
  }),
} as const;

export function esisPath(template: string, values: Record<string, string | number>): string {
  const path = Object.entries(values).reduce(
    (path, [name, value]) => path.replace(`:${name}`, encodeURIComponent(String(value))),
    template,
  );
  const missing = path.match(/:[A-Za-z][A-Za-z0-9_]*/)?.[0];
  if (missing) throw new Error(`Missing ESIS path parameter ${missing.slice(1)}`);
  return path;
}
