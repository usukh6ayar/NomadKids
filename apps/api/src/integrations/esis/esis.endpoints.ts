/**
 * ESIS v2 services used by NomadKids.
 *
 * Source: https://developerv2.esis.edu.mn/api/structure, reviewed 2026-09-09.
 * Keep the API id beside the path: access is granted per service in the ESIS
 * developer portal, so an operator needs both when requesting or auditing a
 * token's scope.
 *
 * ★ **Every id here is now a real one** — the seventeen that read `null` until
 * 2026-09-14 were filled in from the deployment's own request register
 * (`esis.requests.ts`), matched by the portal's own name for each service. The
 * type stays nullable on purpose: the next service the client asks for arrives
 * before its request does, and `null` is how the operator screen says "this
 * scope has not been requested yet" rather than showing a wrong number.
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
   *
   * ★★★ **`apiId` was 147 and was wrong**, corrected 2026-09-14 from the
   * deployment's own request register (`esis.requests.ts`). 147 there is "Сүү
   * хөтөлбөрийн гүйцэтгэл хадгалах" and is *pending*; "Сурагчийн ерөнхий
   * мэдээлэл" — this service's catalog name, verbatim — is **48**, approved.
   * The 147 was read off the slug `API-000147`, and the slug is not the id:
   * `studentByRegister` is 45/API-000144 and `organization` is 59/API-000158.
   * Keep the two numbers separate.
   */
  studentInfo: endpoint({
    apiId: 48,
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
  /*
   * Мэргэшлийн зэргийн хүсэлт — the two reads, wired 2026-09-22 at the client's
   * instruction to use these services.
   *
   * ★ **Both live-probed before being written** (`scripts/esis-degree-probe.ts`).
   * Each answers `203 {"RESPONSE_MESSAGE":"Хүсэлтэд тохирох утга
   * олдсонгүй.","RESULT":""}` for an unknown `requestId` — access granted, id
   * not found. That is what separates them from 119, which answers `403` and is
   * dropped: the client, 2026-09-22, "ene ni ajillahgui gsen ug orhi
   * ashiglahgui".
   *
   * ★★ **No hand-written row schema, and that is deliberate.** Neither has ever
   * been seen with a populated `RESULT`, because nothing in this product can
   * produce a `requestId` yet. `esisDiscoveredSchema` passes through whatever
   * the ministry sends, so the field names come off the wire the first time a
   * real request is read rather than out of documentation this token cannot
   * reach — the developer portal is behind a login. That is the
   * eleven-of-thirty-six-readers-were-fiction failure, avoided by not writing
   * the list at all.
   *
   * ★★★ 170 carries `institutionId` **in the path as well as the query**, which
   * is how the ministry publishes it. `getList` fills the path copy; the query
   * copy is the one every other service gets. Tidying one away would be a guess
   * about which the gateway reads.
   */
  degreeDecisions: endpoint({
    apiId: 167,
    slug: "API-000265",
    method: "GET",
    path: "/svc/api/hub/v2/degree/request/decisions/:requestId",
  }),
  degreeHistory: endpoint({
    apiId: 170,
    slug: "API-000268",
    method: "GET",
    path: "/svc/api/hub/v2/degree/history/v2/:institutionId/:requestId",
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
  /**
   * Which children the state subsidises the meals of — `нэмэлт.md` §3.
   *
   * ★ Added 2026-09-14, from the portal's approved list. It is the answer to
   * the half of §3 that CLAUDE.md §7 records as **partial**: `dependsOnMeals`
   * weights a funding rule, but nothing said *which children* the subsidy
   * covers, so a per-child split by source could not be computed at all. This
   * service is the ministry's own answer, and it is the authority — a
   * kindergarten does not decide who qualifies.
   *
   * ★★ It returns fewer rows than the roster: 65 against 83 on this
   * institution, of which 31 carry `isFoodDiscount: "Тийм"`. A child absent
   * from the response is **not** a child without a discount — it is a child
   * the ministry has not assessed. The two must never be collapsed; see
   * `esis.fields.ts` for what is ingested and `нэмэлт.md` §3.
   */
  foodDiscountStudents: endpoint({
    apiId: 128,
    slug: "API-000227",
    method: "GET",
    path: "/svc/api/hub/v2/cook/levelHood/students",
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
   * `slug: "UNLISTED"` still says exactly that.
   *
   * ★★★ **The ids arrived on 2026-09-14.** This note used to say `apiId: null`
   * was "the one thing our side cannot supply" — the deployment's own request
   * register supplies it (`esis.requests.ts`), matched by the portal's own
   * service name, and all seven are Зөвшөөрөгдсөн there. The slug stays
   * `UNLISTED` because the *catalog page* still does not render them: the id
   * being known and the service being publicly documented are two facts, and
   * only the first one changed.
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
   * ★ **The service is granted; the path is still unverified.** Those are two
   * separate claims and 2026-09-14 settled only the first: the request
   * register has "Суралцагчийн бүртгэлтэй эсэх шалгах" as
   * `100004874669785`, approved, so the service exists and this deployment may
   * call it. Nothing in that register carries a *path*.
   *
   * ★★ So the rest of the original note stands. The public catalog's only
   * `check` service is `api-11` `HUB_SERVICE_SCHOOL_SEARCH_TEACHER_CHECK_UPDATE`
   * at `/teacher/check/:personId` — the *teacher* check, not this — and the
   * student section is not publicly rendered, so "absent from the portal page"
   * is not evidence of absence. The path below is the client's. `fieldSource`
   * stays `ADAPTER` and the first live call against a real token settles it.
   */
  studentCheck: endpoint({
    apiId: 100004874669785,
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
    apiId: 102,
    slug: "UNLISTED",
    method: "POST",
    path: "/svc/api/hub/v2/stdnt/all/contacts",
  }),
  studentContactsSave: endpoint({
    apiId: 101,
    slug: "UNLISTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/contacts/save",
  }),
  /** One child's household statistics — өрхийн мэдээлэл. */
  studentStatistics: endpoint({
    apiId: 87,
    slug: "UNLISTED",
    method: "GET",
    path: "/svc/api/hub/v2/stdnt/statistics/info/:personId",
  }),
  studentStatisticsSave: endpoint({
    apiId: 86,
    slug: "UNLISTED",
    method: "POST",
    path: "/svc/api/hub/v2/stdnt/statistics/info/save",
  }),
  /** One child's living conditions — амьдрах орчин. */
  studentCondition: endpoint({
    apiId: 92,
    slug: "UNLISTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/live/condition/:personId",
  }),
  studentConditionSave: endpoint({
    apiId: 71,
    slug: "UNLISTED",
    method: "POST",
    path: "/svc/api/hub/v2/condition/save",
  }),

  /*
   * ── Багш ────────────────────────────────────────────────────────────────
   * Both read from the portal's public catalog, so both carry their real slug.
   * The numeric ids are not printed on that page for `api-*` services — they
   * come from the deployment's request register instead (`esis.requests.ts`,
   * 2026-09-14), which is the one place that lists an `api-*` service's id
   * beside its name.
   */
  teacherAcademicOrg: endpoint({
    apiId: 100004874669804,
    slug: "api-34",
    method: "GET",
    path: "/svc/api/hub/v2/teacher/academic/org/:personId",
  }),
  teacherMovements: endpoint({
    apiId: 100004874669782,
    slug: "api-12",
    method: "GET",
    path: "/svc/api/hub/v2/teacher/movements/:beginDate",
  }),

  /*
   * ── Бүлэг ───────────────────────────────────────────────────────────────
   * ★ The client asked for a "татах, илгээх" pair on the group screen. This is
   * the read half: the ahead-of-time question ("what will next year's groups
   * be?") that `POST /v1/groups/:id/promotions` has been missing a source for.
   *
   * ★★ **The write half exists after all** — 2026-09-14. This note used to say
   * "there is no group *write* service in the portal's catalog, so nothing is
   * invented to fill the second half", and the ministry's own granted-service
   * list (`apis-granted.xlsx`) has three:
   *
   *   150  POST /svc/api/hub/v2/student/group/info/create    бүлэг нэмэх
   *   152  POST /svc/api/hub/v2/student/group/info/update    бүлэг засах, устгах
   *   162  POST /svc/api/hub/v2/group/instructor/save        бүлгийн багш тохируулах
   *
   * All three are approved for this deployment. The claim was about the public
   * *catalog page*, which does not render them, and it was written as though it
   * were about the ministry — which is exactly the kind of sentence that stops
   * anyone looking again. They are not wired yet; that is a separate decision
   * from whether they exist, and this note now only says the second thing.
   */
  groupsNextYear: endpoint({
    apiId: 14,
    slug: "API-000113",
    method: "GET",
    path: "/svc/api/hub/v2/group/next/academicYear",
  }),

  /*
   * The write half the note above says exists. Spec №3б.
   *
   * ★ `slug: "GRANTED"` rather than an `API-000…` string, the same value
   * `studentAwards` carries: these three are in the ministry's granted-service
   * export (`apis-granted.xlsx`) with an id, a method and a URL, and the public
   * catalogue page does not render them — so there is no portal slug to copy,
   * and inventing one would make `esis.requests.ts`'s join look sounder than
   * it is.
   *
   * ★★ **No `…Save` suffix**, and that is load-bearing rather than taste.
   * `esis.fields.test.ts` treats a `…Save` key as reachable through
   * `POST …/esis/write` — the immediate route whose `@Roles` includes TEACHER,
   * because the three child-record saves behind it are a teacher's own fields.
   * These go through the approval harness and a director instead; naming them
   * `…Save` would either fail that test or be "fixed" by putting an unapproved
   * group write behind a teacher's button.
   *
   * ★★★ The request fields are **not known yet**. The portal does not document
   * these services and the ministry's export carries only id, method and URL —
   * so `ESIS_FIELDS` holds an empty list for each until the live probe reads
   * them out of the service's own `400`, the way `studentContacts`'s
   * `{ personId }` body was read on 2026-09-14.
   */
  groupCreate: endpoint({
    apiId: 150,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/group/info/create",
  }),
  groupUpdate: endpoint({
    apiId: 152,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/group/info/update",
  }),
  groupInstructor: endpoint({
    apiId: 162,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/group/instructor/save",
  }),

  /*
   * ── Хөтөлбөр ────────────────────────────────────────────────────────────
   * Four services in one chain: программ → үе шат → төлөвлөгөө → хичээл. Each
   * takes the ids the one above it returns, which is why they get a screen of
   * their own (`/admin/curriculum`) rather than four unrelated panels.
   */
  programs: endpoint({
    apiId: 100004874669813,
    slug: "api-42",
    method: "GET",
    path: "/svc/api/hub/v2/program/list",
  }),
  programStages: endpoint({
    apiId: 100004874669814,
    slug: "api-43",
    method: "GET",
    path: "/svc/api/hub/v2/program/stage/list/:programOfStudyId",
  }),
  programPlans: endpoint({
    apiId: 100004874669773,
    slug: "api-2",
    method: "GET",
    path: "/svc/api/hub/v2/program/stage/plan/list/:programOfStudyId/:programStageId",
  }),
  programCourses: endpoint({
    apiId: 100004874669815,
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
    apiId: 100004874669799,
    slug: "api-29",
    method: "GET",
    path: "/svc/api/hub/v2/room/list",
  }),
  academicOrg: endpoint({
    apiId: 100004874669796,
    slug: "api-26",
    method: "GET",
    path: "/svc/api/hub/v2/academic/org",
  }),
  subjectAreas: endpoint({
    apiId: 100004874669797,
    slug: "api-27",
    method: "GET",
    path: "/svc/api/hub/v2/subject/area",
  }),

  /*
   * ════════════════════════════════════════════════════════════════════════
   * Эрүүл мэнд, вакцин, хэмжилт, эрт илрүүлэг, багшийн бүртгэл
   * Added 2026-09-14 from the ministry's own granted-service export
   * (`apis-granted.xlsx`): 84 approved services, each with its id, method and
   * **full URL**. Every path below is copied from that column, not inferred.
   *
   * ★ The `:personid` spelling the export uses for two of them (97, 99) is the
   * ministry's placeholder notation, not a key we have to match — the value is
   * positional in the URL. All of them are named `personId` here so one param
   * name serves the whole block.
   *
   * ★★ `slug: "GRANTED"` — these are not on the portal's public catalog page,
   * which renders only the Хоол, Багш and Байгууллага sections. `UNLISTED`
   * (used by the 2026-09-10 block) meant "the client gave us this path and
   * nothing corroborates it". These are different: the ministry published them
   * in a signed export. The slug records which document a reviewer should open.
   * ════════════════════════════════════════════════════════════════════════
   */

  /*
   * ── Эрүүл мэнд: харах ───────────────────────────────────────────────────
   * ★ Five of these seven answered `203` for **all 83 children** on
   * institution 42778, so their output fields have never been seen. They are
   * wired with `esisDiscoveredSchema` and the screen reads the contract off
   * the first real response — see `ESIS_DISCOVERED_SHAPE`. The alternative was
   * five more invented field lists, which is the exact defect eleven other
   * services were found to have on the day these were added.
   *
   * `studentAssessments` and `studentMeasurements` are the two that did
   * answer, so those two carry real declared fields.
   */
  studentAllergy: endpoint({
    apiId: 97,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/allergy/:personId",
  }),
  studentProhibitedFood: endpoint({
    apiId: 98,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/prohibited/:personId",
  }),
  studentDisability: endpoint({
    apiId: 96,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/disability/:personId",
  }),
  studentAssessments: endpoint({
    apiId: 95,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/assessments/:personId",
  }),
  studentMeasurements: endpoint({
    apiId: 99,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/measure/:personId",
  }),
  studentSurgery: endpoint({
    apiId: 94,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/surgery/:personId",
  }),
  studentIncident: endpoint({
    apiId: 93,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/incident/:personId",
  }),

  /*
   * ── Эрүүл мэнд: илгээх ──────────────────────────────────────────────────
   * ★ **These eight input contracts are unproven, and nothing can prove them
   * short of sending one.** A read reveals an output shape; nothing reveals an
   * input shape. Each `send()` list in `esis.fields.ts` mirrors its own read
   * where that read has been observed, and follows the sibling saves'
   * convention where it has not.
   *
   * That is the same position `saveAttendanceV3` and the three суралцагч saves
   * are already in, and it is why every write in this product is behind an
   * explicit operator action rather than a background sync: an unproven
   * contract must not be able to fire by accident. `fieldSource` stays
   * `ADAPTER` for all eight, which is the honest badge.
   */
  studentAllergySave: endpoint({
    apiId: 77,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/allergy/info/save",
  }),
  studentProhibitedFoodSave: endpoint({
    apiId: 76,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/prohibit/info/save",
  }),
  studentDisabilitySave: endpoint({
    apiId: 78,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/disability/info/save",
  }),
  studentAssessmentsSave: endpoint({
    apiId: 79,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/assessments/info/save",
  }),
  studentMeasurementSave: endpoint({
    apiId: 75,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/measure/info/save",
  }),
  studentSurgerySave: endpoint({
    apiId: 81,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/surgery/info/save",
  }),
  studentIncidentSave: endpoint({
    apiId: 82,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/incident/info/save",
  }),
  /**
   * A file attached to a health examination.
   *
   * ★ **The most constrained write in the catalogue.** It sends a child's
   * medical document to a third party, and CLAUDE.md §1.4 makes files the most
   * carefully handled thing in this product — private bucket, random storage
   * key, no direct URL, a check before every read.
   *
   * It is wired so the catalogue is complete and the grant is visible, and it
   * has **no screen**. Giving it one is a consent decision (`ConsentRecord`
   * already models photo consent for exactly this reason), not a button.
   */
  studentAttachmentSave: endpoint({
    apiId: 84,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/attachment/save",
  }),

  /*
   * ── Вакцин ──────────────────────────────────────────────────────────────
   * ★ **SCREAMING_SNAKE_CASE**, alone in this catalogue: `VACCINE_NAME`,
   * `APPROVED_DATE`, `PERSON_ID`. These come from the immunisation registry
   * rather than from ESIS's own tables, which is also why they behave
   * differently — see below.
   *
   * ★★ **The service is intermittent, and an empty answer does not mean the
   * child is unvaccinated.** On 2026-09-14 `vaccine/history/9129027526058`
   * returned 17 real doses, and a repeat of the same call an hour later
   * returned `203 Хүсэлтэд тохирох утга олдсонгүй` — same child, same token,
   * same institution. Both shapes below were captured from the successful
   * call.
   *
   * So this is the `foodDiscountStudents` rule again, and for a sharper
   * reason: a missing вакцины бүртгэл rendered as "no vaccinations" would be a
   * clinical claim about a child, drawn from a service that was simply not
   * answering. The panel must say *мэдээлэл ирсэнгүй*, never *вакцин хийлгээгүй*.
   */
  vaccineCatalog: endpoint({
    apiId: 62,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/vaccine/list",
  }),
  vaccineHistory: endpoint({
    apiId: 63,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/vaccine/history/:personId",
  }),
  vaccinePlan: endpoint({
    apiId: 64,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/vaccine/plan/:personId",
  }),

  /*
   * ── Өсөлт, хэмжилт бүлгээр ──────────────────────────────────────────────
   * ★ The read returns **one row per child in the group**, with every
   * measurement field null when the child has not been measured — 14 rows for
   * бага бүлэг, all null. That shape is the feature: it is a nurse's worksheet
   * for a measuring session, not a list of results, and it is what makes the
   * bulk save its natural pair.
   */
  groupMeasurements: endpoint({
    apiId: 109,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/measurements/v2/:studentGroupId",
  }),
  groupMeasurementsSave: endpoint({
    apiId: 108,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/measure/info/bulk/save",
  }),

  /*
   * ── Эрт илрүүлэг ────────────────────────────────────────────────────────
   * The ministry's own screening instrument for the дунд бүлэг (and years 1, 6
   * and 10). `screeningQuestions` returns **25 questions** and is the
   * instrument itself — nothing here invents a question to sit beside them.
   *
   * ★ `studentScreening` answered `203` for all 19 middle-group children, so
   * its answer shape is discovered rather than declared, like the five health
   * reads above.
   */
  screeningQuestions: endpoint({
    apiId: 195,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/survey/list",
  }),
  studentScreening: endpoint({
    apiId: 194,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/screening/:personId",
  }),
  studentScreeningSave: endpoint({
    apiId: 190,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/screening/sub",
  }),

  /*
   * ── Багш, ажилтныг бүртгэх ──────────────────────────────────────────────
   * The three reads behind "багшийг яаж бүртгэх": find the person, confirm
   * they belong to this institution, then fill their record.
   */
  /**
   * One worker, by the register number an operator types.
   *
   * ★ **Not institution-scoped, and that is the whole risk.** It sits under
   * `/svc/api/public/` and takes no `institutionId`; every register number
   * tried on 2026-09-14 resolved, including staff of other institutions. So it
   * answers for any worker in the national education database, and
   * `teacher/check` — which *is* scoped — constrains the flow but not the
   * lookup.
   *
   * ★★ The register number travels **to** ESIS and is stored nowhere, exactly
   * as for `studentByRegister`: `ESIS_REQUEST.md` §1.1 (b) refuses to *receive
   * and keep* register numbers, and this sends one an operator already holds.
   * `civilId` and `personRegNumber` come back in the response and are refused
   * there. `esis-admin.service.ts` keeps the typed value out of the audit row
   * while still recording that a lookup happened.
   */
  /*
   * ★ `slug` corrected 2026-09-18 from `"GRANTED"` to the portal's own
   * `API-000148`, found by `scripts/esis-portal-reconcile.ts`. It was a
   * placeholder for "granted but the public catalogue page does not render it",
   * and the page does render this one — the reconcile script now says so.
   */
  workerInfo: endpoint({
    apiId: 49,
    slug: "API-000148",
    method: "GET",
    path: "/svc/api/public/worker/info/:primaryNidNumber",
  }),
  teacherProfile: endpoint({
    apiId: 100004874669800,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/teacher/profile/:personId",
  }),
  /**
   * Whether this person is a teacher **at this institution**.
   *
   * Returns `["false"]` — a scalar in a one-element array, read by
   * `esisCheckParser` alongside `student/check`'s bare string. Requires
   * `institutionId`; without it, `400 institutionId дутуу байна`.
   */
  teacherCheck: endpoint({
    apiId: 100004874669781,
    slug: "api-11",
    method: "GET",
    path: "/svc/api/hub/v2/teacher/check/:personId",
  }),

  /*
   * ── Ирцийн өдрийн нэгдсэн дүн ───────────────────────────────────────────
   * ★ One row **per group**, not per child: `status` ("Бүртгээгүй"), and the
   * day's counts by reason. It is how an administrator sees which groups have
   * not registered attendance yet, and how a `saveAttendanceV3` push is
   * verified from the ministry's side rather than from ours.
   *
   * ★★ `:daydate` is the export's spelling. The value is `YYYY-MM-DD`.
   */
  schoolAttendance: endpoint({
    apiId: 11,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/attendance/school/:academicYear/:dayDate",
  }),

  /*
   * ── Six granted services that were still uncalled, closed 2026-09-17 ────
   * Plan `2026-09-16-esis-sync-tiers.md` Task 9. Four are decided below; the
   * other two (167, 170) have no path here at all — `esis.requests.ts`'s
   * `ESIS_DISPOSITIONS` records why they stay unwired rather than a path
   * nobody calls.
   */

  /**
   * A child's titles, awards and degrees — api 85.
   *
   * ★ Per-child, institution-scoped like every `stdnt/…` and `student/…`
   * reader beside it — proven live, 2026-09-17: `400 institutionId дутуу
   * байна` without the query param, `203` with a real `personId` and no
   * matching record on institution 42778. Gated by `assertCanReadEsisChild`
   * exactly like `studentAllergy` and its neighbours, since its param is
   * `personId`.
   */
  studentAwards: endpoint({
    apiId: 85,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/stdnt/awards/:personId",
  }),
  /**
   * One child, found by the civil registry number an operator types.
   *
   * ★ Api 100004874669784, "Суралцагчийн мэдээлэл хайх /УБЕГ -аас татаж
   * шинэчлэх/" in the request register — a lookup against the state civil
   * registry, not this deployment's own roster. Institution-scoped, proven
   * live 2026-09-17: `400 institutionId дутуу байна` without the query
   * param, `200` with a real civil id and the full API-000144-shaped record.
   *
   * ★★ **`studentByRegister` is the precedent, followed exactly**: the civil
   * id travels *to* ESIS, sent because an operator already holds it, and is
   * never received and kept — `ESIS_REQUEST.md` §1.1 (b). `read` keeps it out
   * of the audit row the same way (`REDACTED_READ_PARAMS`).
   */
  studentSearch: endpoint({
    apiId: 100004874669784,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/student/search/:civilId",
  }),
  /**
   * One building, by the kindergarten's own government register number.
   *
   * ★ Api 186, "Байгууллагын барилга байгууламж" — **live-probed 2026-09-17**,
   * because the granted-service export lists this one with brace
   * placeholders (`{registerNumber}`) and an `OPEN` subsystem tag, unlike
   * every other row here. Neither turned out to matter: a live call under the
   * standard `/svc/api/hub/v2/` root, with the value substituted the way
   * `esisPath` already does it, answered the standard envelope —
   * `203 Хүсэлтэд тохирох утга олдсонгүй` for a made-up register number,
   * exactly the shape every other "no match" answer here has, not a routing
   * error. A nonsense path segment answers a *different* 404 (`Зам
   * олдсонгүй`), which is what makes the 203 above evidence the route is
   * real rather than a coincidence. The brace notation was the export's
   * documentation style, not a second grammar to support.
   *
   * ★★ **The plan that asked for this probe also said `organization/info`
   * "may carry" the register number this path needs. It does not** —
   * checked against the live response and against `esisOrganizationSchema`,
   * which has never named one. Nothing in this deployment's ESIS reads holds
   * an organisation's own government register number, so it is an
   * operator-typed value here, the same shape `studentByRegister` and
   * `workerInfo` already use for a person's.
   */
  buildingByRegisterNumber: endpoint({
    apiId: 186,
    slug: "GRANTED",
    method: "GET",
    path: "/svc/api/hub/v2/MOF/ORGANIZATION/BUILDING/:registerNumber",
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
