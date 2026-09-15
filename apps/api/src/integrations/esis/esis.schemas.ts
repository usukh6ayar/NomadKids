import { z } from "zod";

const identifier = z.union([z.string(), z.number()]).transform(String);

/**
 * An id that may be absent.
 *
 * ★ **`.nullable()` as well as `.optional()`, and the difference is not
 * cosmetic** — 2026-09-14. Fourteen fields in this file were written
 * `identifier.optional()`, which accepts a **missing key** and rejects an
 * explicit `null`. ESIS expresses "no value" as `null`, so those fields
 * rejected the one form the ministry actually sends.
 *
 * Two live services were failing outright because of it:
 *
 *   `group/list`     `instructorId: null` in **4 of 4** groups — the group list
 *                    never parsed at all on institution 42778
 *   `teacher/list`   `subjectDepartmentId: null` in 2 of 10 teachers
 *
 * And because `esisListParser` validates the whole `RESULT` array with the row
 * schema, two teachers without a department threw away all ten. One null in one
 * row costs the entire list.
 *
 * ★★ This is a different failure from the invented field names corrected the
 * same day, and it is invisible to the check that caught those: the key **is**
 * present and correctly named, so comparing key sets against a live response
 * finds nothing. Only parsing the response finds it. Prefer this over
 * `identifier.optional()` for every ESIS output; a field that must never be
 * null is `identifier`, with nothing after it.
 */
const nullableIdentifier = identifier.nullable().optional();
const nullableString = z.string().nullable().optional();
/*
 * ★ `nullableNumber` takes the mixed shape too — 2026-09-09.
 *
 * It was a bare `z.number()`, and the note below explains exactly why that
 * fails: one field arriving as `"187"` throws away every row. The demo
 * fixtures are the proof — they are built from the catalog's own sample
 * values, which are strings, so every service with a numeric field answered
 * `INVALID_RESPONSE` in demo mode. That is why the food services were marked
 * `NOT_ENABLED` on the operator screen rather than fixed.
 */
const nullableNumber = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((value) => (value === null || value === undefined ? value : Number(value)));

/**
 * A scalar whose live JSON representation may vary from the catalog type.
 *
 * ★ These two exist because `esisListParser` validates the **whole** `RESULT`
 * array with the row schema: one field arriving as `"12"` where a bare
 * `z.number()` was written throws away every row, and the operator sees
 * "хариу гэрээнд тохирохгүй" on the screen whose entire job is proving the
 * fields are ready. It would surface at the exact moment the token arrives,
 * and no hand-written fixture can catch it, because every fixture is written
 * to match the schema.
 *
 * The portal names a JSON type, but the published samples already contain
 * mixed scalar forms in a few services. `identifier`, `tardyMinutes` and
 * `grossWeight` take this shape for the same reason: accept both, normalise
 * once, and tighten after C4 shows what ESIS sends for the kindergarten scope.
 */
const nullableCount = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((value) => (value === null || value === undefined ? value : Number(value)));

const nullableFlag = z
  .union([z.string(), z.number(), z.boolean()])
  .nullable()
  .optional()
  .transform((value) => (value === null || value === undefined ? value : String(value)));

/**
 * Parse the documented ESIS envelope and return only its RESULT rows.
 *
 * ★ **"No rows" is not a broken contract** — 2026-09-14, from live reads against
 * institution 42778. ESIS answers an empty result with HTTP **203** and a body
 * whose `RESULT` arrives in three different shapes:
 *
 * ```
 * student/allergy/:id      → {"SUCCESS_CODE":203,"RESPONSE_MESSAGE":"…олдсонгүй.","RESULT":""}
 * student/screening/:id    → {…,"RESULT":[]}
 * group/next/academicYear  → {"SUCCESS_CODE":203,"RESPONSE_MESSAGE":"…олдсонгүй"}   ← no RESULT key
 * ```
 *
 * `RESULT: z.array(row)` accepted only the middle one. 203 is `response.ok`, so
 * `EsisClient` handed the other two here, Zod threw, and the operator was told
 * "ESIS response did not match the expected shape" — an `invalid_response`,
 * which that class documents as needing *a developer, not an operator* — when
 * the truth was that this child has no allergy record. `groupsNextYear` shipped
 * and failed exactly this way.
 *
 * ★★ **The discriminator is the shape of `RESULT`, not `SUCCESS_CODE`.** Every
 * empty observed carried 203 and every populated one carried 200, so keying on
 * the code would work today; it would also assert that ESIS keeps using 203 for
 * "no rows", which nothing they publish says. Absent, `null` and `""` are read
 * as "nothing came back". Anything else — an object where a list belongs, a
 * string that is not empty — is still a genuine `invalid_response`, because a
 * contract break must not be able to hide as an empty one.
 *
 * ★★★ **An absent body is empty at the envelope level**, found on 2026-09-15:
 * `teacher/movements` answered `205` with zero bytes, which `EsisClient` hands
 * on as `null`. The shapes above are an empty `RESULT` inside an envelope;
 * this is no envelope at all. It is read as "nothing came back" for the same
 * reason and with the same limit — anything that *is* present and
 * *is not* an envelope still fails.
 */
export function esisListParser<T>(row: z.ZodType<T>): (body: unknown) => T[] {
  const envelope = z.object({
    SUCCESS_CODE: z.number(),
    RESPONSE_MESSAGE: z.string(),
    RESULT: z
      // Ordered: a real list is parsed by the row schema before anything else
      // gets a chance to read it as empty.
      .union([z.array(row), z.literal(""), z.null()])
      .optional()
      .transform((value) => (Array.isArray(value) ? value : [])),
  });
  return (body) => (body === null || body === undefined ? [] : envelope.parse(body).RESULT);
}

/**
 * The identifiers and credentials this product refuses from any ESIS payload.
 *
 * ★ A list, in code, because `esisDiscoveredSchema` below keeps **every** key a
 * service sends. The refusals in `esis.fields.ts` are documentation — they tell
 * a reviewer what we declined — but they are enforced by each hand-written
 * schema simply not naming the field. A passthrough schema has no such
 * accident-proofing, so the refusal has to be executable.
 *
 * `ESIS_REQUEST.md` §1.1 (b) and §1.2. Keep this in step with the `refused`
 * array in `esis.fields.test.ts`.
 */
export const ESIS_REFUSED_FIELDS: readonly string[] = [
  "civilId",
  "personRegNumber",
  "registerNumber",
  "microsoftPassword",
  "googlePassword",
  "microsoftEmailPass",
  "googleEmailPass",
  "username",
];

const REFUSED = new Set(ESIS_REFUSED_FIELDS);

/**
 * A row whose shape ESIS has never shown us.
 *
 * ★ **Why this exists, and why it is not the thing that was just deleted.**
 * Five health services — харшил, хориотой хүнс, хөгжлийн бэрхшээл, мэс засал,
 * осол гэмтэл — answer `203` for all 83 children on institution 42778. Their
 * paths work and their grants are approved, but no row has ever been seen, so
 * nobody can say what fields they carry.
 *
 * On 2026-09-14 eleven services were found to have invented field lists, seven
 * of which parsed and silently discarded the real payload. Writing five more
 * guesses would repeat exactly that, and the guess would be *worse* here: at
 * least those eleven had a portal page behind them.
 *
 * So the contract is discovered instead of declared. The schema keeps whatever
 * arrives; `esis-admin.service.ts` derives the field list from the keys the
 * response actually contained, and the panel renders them. When the first
 * record appears, the operator sees the ministry's own field names, with their
 * values — and that observation is what a hand-written list gets promoted to.
 *
 * ★★ `personId` is asserted because every per-child service in the catalogue
 * returns it and a row without one cannot be attached to a child. Everything
 * else is unconstrained.
 *
 * ★★★ The refusals are enforced here rather than trusted to the field list —
 * this is the one schema that cannot express "I did not ask for that" by
 * omission. A widened schema elsewhere is a bug; a passthrough that leaked a
 * civil id would be a breach.
 */
export const esisDiscoveredSchema = z
  .looseObject({ personId: nullableIdentifier })
  .transform((row) =>
    Object.fromEntries(Object.entries(row).filter(([name]) => !REFUSED.has(name))),
  );

export const esisOrganizationSchema = z.object({
  institutionId: identifier,
  institutionName: z.string(),
  shortName: nullableString,
  longName: nullableString,
  legalName: nullableString,
  legalNameMgl: nullableString,
  propertyTypeName: nullableString,
  institutionTypeId: nullableIdentifier,
  institutionTypeName: nullableString,
  provinceName: nullableString,
  districtName: nullableString,
  subDistrictName: nullableString,
  regionName: nullableString,
  institutionAddress: nullableString,
  institutionClassificationId: nullableIdentifier,
  institutionClassificationName: nullableString,
});

export const esisAcademicYearSchema = z.object({
  academicYear: z.string(),
  currentAcademicYearFlag: z.string(),
  openDate: nullableString,
  closedDate: nullableString,
  academicYearStatus: z.string(),
});

export const esisGroupSchema = z.object({
  institutionId: identifier,
  studentGroupId: identifier,
  studentGroupName: z.string(),
  academicLevel: nullableString,
  academicLevelName: nullableString,
  programOfStudyId: nullableIdentifier,
  programOfStudyName: nullableString,
  programStageId: nullableIdentifier,
  programStageName: nullableString,
  programPlanId: nullableIdentifier,
  programPlanName: nullableString,
  groupTypeCode: nullableString,
  groupTypeName: nullableString,
  groupShiftId: nullableIdentifier,
  groupShiftName: nullableString,
  groupClassificationId: nullableIdentifier,
  groupClassificationName: nullableString,
  groupCategoryCode: nullableString,
  groupCategoryName: nullableString,
  academicGroupId: nullableIdentifier,
  academicGroupName: nullableString,
  instructorId: nullableIdentifier,
  instructorName: nullableString,
  academicYear: z.string(),
});

/** Deliberately excludes civil/register numbers and provider-issued passwords. */
export const esisStudentSchema = z.object({
  institutionId: identifier,
  personId: identifier,
  familyName: nullableString,
  lastName: z.string(),
  firstName: z.string(),
  familyNameMgl: nullableString,
  lastNameMgl: nullableString,
  firstNameMgl: nullableString,
  dateOfBirth: z.string(),
  genderCode: z.string(),
  genderName: nullableString,
  academicLevel: nullableString,
  academicLevelName: nullableString,
  studentGroupId: nullableIdentifier,
  studentGroupName: nullableString,
  programOfStudyId: nullableIdentifier,
  programOfStudyName: nullableString,
  programPlanId: nullableIdentifier,
  /*
   * ★ ESIS does not send this — 2026-09-14, live against institution 42778.
   *
   * Every other `program*Name` has a matching `*Id`, so a plan name was assumed
   * to arrive beside `programPlanId`, and it never does. It stays listed
   * because the roster panel has a column for it and `undefined` is the honest
   * value; what changed is that `esis.fields.ts` no longer claims we ingest it.
   */
  programPlanName: nullableString,
  programStageId: nullableIdentifier,
  programStageName: nullableString,
  microsoftEmail: nullableString,
  googleEmail: nullableString,
  actionDate: nullableString,
  academicYear: nullableString,
  instructorId: nullableIdentifier,
  instructorName: nullableString,
  programStatus: nullableString,
  programStatusName: nullableString,
});

/** API-000144 output after data-minimisation; sensitive upstream keys are ignored. */
export const esisStudentByRegisterSchema = esisStudentSchema.pick({
  institutionId: true,
  personId: true,
  familyName: true,
  firstName: true,
  lastName: true,
  familyNameMgl: true,
  firstNameMgl: true,
  lastNameMgl: true,
  dateOfBirth: true,
  genderCode: true,
  genderName: true,
  academicLevel: true,
  academicLevelName: true,
  studentGroupId: true,
  studentGroupName: true,
  programOfStudyId: true,
  programOfStudyName: true,
  programPlanId: true,
  programPlanName: true,
  microsoftEmail: true,
  googleEmail: true,
  academicYear: true,
});

export const esisMovementSchema = z.object({
  institutionId: identifier,
  studentProgramId: nullableIdentifier,
  academicLevel: nullableString,
  academicLevelName: nullableString,
  studentGroupId: nullableIdentifier,
  studentGroupName: nullableString,
  programOfStudyId: nullableIdentifier,
  programOfStudyName: nullableString,
  programPlanId: nullableIdentifier,
  programPlanName: nullableString,
  programStatusCode: nullableString,
  programStatusName: nullableString,
  approvalStatusCode: nullableString,
  approvalStatusName: nullableString,
  personId: identifier,
  familyName: nullableString,
  lastName: z.string(),
  firstName: z.string(),
  dateOfBirth: z.string(),
  genderCode: z.string(),
  genderName: nullableString,
  actionId: nullableIdentifier,
  actionName: nullableString,
  actionDate: z.string(),
});

/**
 * The name and gender block both person services return.
 *
 * ★ The `…Mgl` variants are not duplicates. ESIS returns the transliterated
 * form in `lastName`/`firstName` and the Mongolian-script form in `lastNameMgl`/
 * `firstNameMgl`, and a Mongolian UI needs the second one — which is why they
 * are kept rather than dropped as redundant.
 */
const personNameFields = {
  familyName: nullableString,
  lastName: z.string(),
  firstName: z.string(),
  familyNameMgl: nullableString,
  firstNameMgl: nullableString,
  lastNameMgl: nullableString,
  genderCode: nullableString,
  genderName: nullableString,
  dateOfBirth: nullableString,
};

/**
 * Official email addresses, kept; the passwords beside them, never.
 *
 * ESIS returns `microsoftEmailPass` and `googleEmailPass` in the same rows.
 * They are absent here on purpose — `ESIS_REQUEST.md` §1.2 declines them, and
 * `esis.fields.ts` lists them as refused so the omission is visible rather
 * than merely silent.
 */
const officialEmailFields = {
  microsoftEmail: nullableString,
  googleEmail: nullableString,
  allEmail: nullableString,
};

/** Deliberately excludes civil/register numbers, provider passwords and usernames. */
export const esisTeacherSchema = z.object({
  institutionId: identifier,
  assignmentId: identifier,
  personId: identifier,
  instructorId: nullableIdentifier,
  displayName: nullableString,
  ...personNameFields,
  positionName: nullableString,
  instructorTypeId: nullableIdentifier,
  instructorTypeName: nullableString,
  subjectDepartmentId: nullableIdentifier,
  subjectDepartmentName: nullableString,
  instructorAvailability: nullableFlag,
  ...officialEmailFields,
});

/** Deliberately excludes civil/register numbers, provider passwords and salary. */
export const esisStaffSchema = z.object({
  institutionId: identifier,
  institutionName: nullableString,
  parentInstitutionId: nullableIdentifier,
  parentInstitutionName: nullableString,
  assignmentId: identifier,
  personId: identifier,
  ...personNameFields,
  positionName: nullableString,
  positionCode: nullableString,
  jobCode: nullableString,
  minor: nullableFlag,
  primaryFlag: nullableFlag,
  educationSectorYears: nullableCount,
  yearsOfService: nullableCount,
  propertyClassificationCode: nullableString,
  propertyClassificationName: nullableString,
  ...officialEmailFields,
});

export const esisAttendanceSchema = z.object({
  academicLevel: nullableString,
  personId: identifier,
  dayDate: z.string(),
  attendanceReasonCode: z.string(),
  attendanceReasonName: nullableString,
  tardyMinutes: z.union([z.string(), z.number()]).transform(Number),
});

export const esisFoodProductTypeSchema = z.object({
  productType: z.string(),
  productTypeName: z.string(),
});

export const esisFoodMaterialGroupSchema = z.object({
  groupId: identifier,
  parentGroupId: identifier.nullable().optional(),
  orgGroup: nullableString,
  groupCode: nullableString,
  groupName: z.string(),
});

export const esisFoodMaterialSchema = z.object({
  materialId: identifier,
  groupId: identifier,
  materialCode: nullableString,
  materialName: z.string(),
  measureCode: z.string(),
  supplierType: nullableString,
  nutrition: nullableNumber,
  calories: nullableNumber,
  proteins: nullableNumber,
  fats: nullableNumber,
  carbohydrate: nullableNumber,
  sequence: nullableCount,
});

export const esisFoodProductSchema = z.object({
  productId: identifier,
  productCode: nullableString,
  productName: nullableString,
  measureCode: nullableString,
  productType: z.string(),
  nutrition: nullableNumber,
  calories: nullableNumber,
  proteins: nullableNumber,
  fats: nullableNumber,
  carbohydrate: nullableNumber,
  hasRecipeFlag: nullableString,
  kitFlag: nullableString,
  sequence: nullableCount,
});

/** `API-000229` — one row: the school's month, and what it owes against it. */
/** `api-28` — one building, with its purpose, capacity and valuation. */
export const esisBuildingSchema = z.object({
  buildingId: identifier,
  buildingName: nullableString,
  createdYear: nullableString,
  buildingPurposeCode: nullableString,
  buildingPurposeName: nullableString,
  standardFlag: nullableFlag,
  buildingPropertyType: nullableIdentifier,
  buildingPropertyTypeName: nullableString,
  normalCapacity: nullableCount,
  totalCapacity: nullableCount,
  firstCost: nullableNumber,
  lastCost: nullableNumber,
  approvalStatusCode: nullableString,
});

export const esisLivelihoodForm1Schema = z.object({
  orgName: nullableString,
  academicYear: nullableString,
  academicMonth: nullableString,
  studentCnt: nullableCount,
  livelihoodCnt: nullableCount,
  livelihoodBudget: nullableNumber,
  livelihoodAmount: nullableNumber,
});

/** `API-000231` — one row per child in a group, with days and money. */
export const esisLivelihoodForm2Schema = z.object({
  orgName: nullableString,
  academicYear: nullableString,
  academicMonth: nullableString,
  studentGroupId: nullableIdentifier,
  studentGroupName: nullableString,
  personId: nullableIdentifier,
  comingDays: nullableCount,
  arrivalDays: nullableCount,
  amountDue: nullableNumber,
  amountPaid: nullableNumber,
  livelihoodDiscount: nullableNumber,
});

/**
 * The state's meal-subsidy list — `нэмэлт.md` §3.
 *
 * ★ `civilId` and `registerNumber` are **absent from this schema on purpose**,
 * which is what actually enforces `ESIS_REQUEST.md` §1.1 (b): zod strips what
 * it does not name, so the two values are gone before any code downstream —
 * including the row projection and the audit log — can see them. The field
 * catalog `drop()`s them for the operator to read; this is the mechanism.
 *
 * ★★ `isFoodDiscount` is the ministry's Mongolian word, kept as it arrives.
 * Interpreting it into a boolean here would bury the mapping in a schema;
 * `foodDiscountByPerson` does it in one named place instead.
 */
export const esisFoodDiscountStudentSchema = z.object({
  personId: identifier,
  lastName: nullableString,
  firstName: nullableString,
  isFoodDiscount: nullableString,
  orgName: nullableString,
  orgProperty: nullableString,
  orderNum: nullableString,
});

export const esisFoodKitSchema = z.object({
  productId: identifier,
  productType: z.string(),
  nutrition: nullableNumber,
  calories: nullableNumber,
  proteins: nullableNumber,
  fats: nullableNumber,
  carbohydrate: nullableNumber,
});

export const esisFoodKitProductSchema = z.object({
  productCode: nullableString,
  productName: nullableString,
  productType: z.string(),
  nutrition: nullableNumber,
  calories: nullableNumber,
  proteins: nullableNumber,
  fats: nullableNumber,
  carbohydrate: nullableNumber,
  orgType: nullableString,
});

export const esisFoodProductMaterialSchema = z.object({
  productMaterialId: identifier,
  productId: identifier,
  groupId: identifier,
  materialId: identifier,
  measureCode: z.string(),
  grossWeight: z.union([z.string(), z.number()]).transform(String),
  netWeight: z.union([z.string(), z.number()]).transform(String),
  sequence: nullableCount,
});

/*
 * ────────────────────────────────────────────────────────────────────────────
 * Added 2026-09-10 — суралцагчийн нэмэлт мэдээлэл, багш, хөтөлбөр, орчин.
 *
 * ★ **Every read schema below is deliberately loose**, and the file's own
 * warning at the top of `nullableCount` says why: `esisListParser` validates
 * the *whole* `RESULT` array with the row schema, so one field arriving in an
 * unexpected shape throws away every row and the operator sees "хариу гэрээнд
 * тохирохгүй" on the screen whose job is proving the fields are ready.
 *
 * That risk is higher here than anywhere else in this file, because the
 * Суралцагч section of the developer portal is not publicly rendered — these
 * field names are read from the client's own URLs and our reading of the
 * domain, not from a published output list. So only the identifiers that name
 * the record are required; everything else is optional and nullable, and the
 * catalog marks the source `ADAPTER` rather than `PORTAL`. Tighten after C4.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Whether ESIS already holds this child.
 *
 * ★ **The path is verified and the shape was wrong** — 2026-09-14. The endpoint
 * note said the first live call would settle the path; it did, and it settled
 * something else too. This schema was a nine-field record — `statusCode`,
 * `studentGroupName`, `enrollmentDate` and the rest — and the service returns a
 * **bare string**:
 *
 * ```
 * GET /svc/api/hub/v2/student/check/:personId?institutionId=42778
 * → 200 {"SUCCESS_CODE":200,"RESPONSE_MESSAGE":"9425579614258 ID дугаартай сурагч байна.","RESULT":"true"}
 * ```
 *
 * Not one of the nine keys exists. The row would have failed on first contact,
 * and no amount of nullability would have saved it, because there was no object
 * to read them from.
 *
 * ★★ The sentence is the other half of the answer, so `RESPONSE_MESSAGE` is
 * carried into the row by `esisCheckParser`. It is the only service here whose
 * envelope says more than its `RESULT`, and throwing it away would leave a
 * screen showing "true" with nothing to say what was true of whom.
 *
 * ★★★ The same shape serves `teacher/check`, which answers `["false"]` — the
 * scalar inside a one-element array. Both are read by the parser below.
 */
export const esisStudentCheckSchema = z.object({
  isRegistered: nullableFlag,
  message: nullableString,
});

/**
 * The two `check` services: a scalar `RESULT` plus the envelope's sentence.
 *
 * ★ Not `esisListParser`. That parser's contract is "`RESULT` is the list of
 * rows", and here `RESULT` is the value of the single field. Widening the
 * shared parser to accept a bare string would have made it accept one for every
 * other service too, and `RESULT: ""` — which twenty services use to mean *no
 * rows* — would have started parsing as a row with an empty value.
 */
export function esisCheckParser(): (body: unknown) => z.infer<typeof esisStudentCheckSchema>[] {
  const envelope = z.object({
    SUCCESS_CODE: z.number(),
    RESPONSE_MESSAGE: z.string(),
    RESULT: z.unknown(),
  });

  return (body) => {
    const { RESULT, RESPONSE_MESSAGE } = envelope.parse(body);
    const value = Array.isArray(RESULT) ? RESULT[0] : RESULT;

    // 203 with nothing in it: the service declined to answer, which is not the
    // same as answering "false" and must not be shown as one.
    if (value === null || value === undefined || value === "") return [];

    return [esisStudentCheckSchema.parse({ isRegistered: value, message: RESPONSE_MESSAGE })];
  };
}

/**
 * One entry from a child's contact record — a guardian, a phone, an address.
 *
 * ★ **Rewritten from live reads, 2026-09-14, and it was wrong twice over.**
 *
 * The old schema was a flat guardian row — `contactId`, `relationTypeName`,
 * `phoneNumber2`, `occupation`, `liveTogetherFlag` — and the catalog described
 * the service as the whole roster's guardians. Neither holds:
 *
 *   1. It is **per child**. With no body it answers
 *      `400 {"RESPONSE_MESSAGE":"personId шаардлагатай"}`.
 *   2. `RESULT` is an **object of named lists**, not a list of rows:
 *      `relInfo`, `relAddress`, `relPhone`, `relEmail`, `relSocial`, `relWeb`,
 *      `contactAddress`, `contactPhone`, `contactEmail`, `contactSocial`,
 *      `contactWeb`, plus `status` and `message`.
 *
 * So `esisListParser` threw on every real call, and the panel's dry-run 400'd
 * before it got that far.
 *
 * ★★ **One row per entry, never merged.** `esisContactsParser` below emits each
 * entry ESIS returned as its own row, tagged with the list it came from. The
 * tempting alternative — join `relPhone` onto `relInfo` by `studentContactId`
 * and show one line per guardian — silently loses a guardian's second number
 * and invents a one-to-one where ESIS models one-to-many. The join key is on
 * the row instead, so a reader can see which guardian a number belongs to.
 *
 * ★★★ `rel*` is the **guardian's** contact point; `contact*` is the **child's
 * own**. They are different records with different id columns
 * (`studentContactPhoneId` against `studentPhoneId`) and are not interchangeable.
 *
 * ★★★★ Six of the eleven lists — `relAddress`, `relSocial`, `relWeb`,
 * `contactAddress`, `contactSocial`, `contactWeb` — were empty for all 83
 * children, so their fields are unknown and none are invented here. An entry
 * from one of them renders under the names below that happen to match and is
 * otherwise blank, which is the honest outcome until a populated record exists.
 *
 * ★★★★★ No register number, no civil id — neither is returned, and the refusal
 * stands anyway (`ESIS_REQUEST.md` §1.1 (b)): a parent's telephone number does
 * not need their national identifier beside it.
 */
export const esisStudentContactSchema = z.object({
  /** Which of the eleven lists the entry came from. Ours, not ESIS's. */
  section: z.string(),
  institutionId: nullableIdentifier,
  personId: nullableIdentifier,
  /** Joins a `rel*` phone or email to the guardian in `relInfo`. */
  studentContactId: nullableIdentifier,
  studentContactPhoneId: nullableIdentifier,
  studentContactEmailId: nullableIdentifier,
  studentPhoneId: nullableIdentifier,
  studentEmailId: nullableIdentifier,
  relationshipType: nullableString,
  familyName: nullableString,
  lastName: nullableString,
  firstName: nullableString,
  dateOfBirth: nullableString,
  jobTitle: nullableString,
  legalEmployerName: nullableString,
  note: nullableString,
  phoneType: nullableString,
  phoneCountryCode: nullableString,
  phoneAreaCode: nullableString,
  phoneNumber: nullableString,
  phoneExtension: nullableString,
  phoneValidity: nullableString,
  legislationCode: nullableString,
  emailType: nullableString,
  emailAddress: nullableString,
  primaryInLdap: nullableFlag,
  primaryFlag: nullableFlag,
});

/** The eleven lists `stdnt/all/contacts` returns, in the order it returns them. */
const CONTACT_SECTIONS = [
  "relInfo",
  "relAddress",
  "relPhone",
  "relEmail",
  "relSocial",
  "relWeb",
  "contactAddress",
  "contactPhone",
  "contactEmail",
  "contactSocial",
  "contactWeb",
] as const;

/**
 * Flattens the contacts envelope into one row per entry.
 *
 * `status` and `message` sit beside the eleven lists in `RESULT` and are not
 * entries; they are skipped rather than parsed into empty rows.
 */
export function esisContactsParser(): (
  body: unknown,
) => z.infer<typeof esisStudentContactSchema>[] {
  const envelope = z.object({
    SUCCESS_CODE: z.number(),
    RESPONSE_MESSAGE: z.string(),
    RESULT: z.union([z.record(z.string(), z.unknown()), z.literal(""), z.null()]).optional(),
  });

  return (body) => {
    const { RESULT } = envelope.parse(body);
    if (!RESULT || typeof RESULT !== "object") return [];

    return CONTACT_SECTIONS.flatMap((section) => {
      const entries = (RESULT as Record<string, unknown>)[section];
      if (!Array.isArray(entries)) return [];
      return entries.map((entry) =>
        esisStudentContactSchema.parse({ ...(entry as object), section }),
      );
    });
  };
}

/**
 * One child's household statistics — өрхийн мэдээлэл.
 *
 * ★ **Every one of the thirteen keys this carried was invented** —
 * `familyMemberCount`, `childrenCount`, `familyTypeId/Name`,
 * `incomeTypeId/Name`, `livelihoodTypeId/Name`, `isHerderFamily`,
 * `isSingleParent`, `hasDisabledMember`, `socialWelfareFlag`, `updatedDate`.
 * All were nullable, so the row parsed and the whole payload was discarded.
 * Corrected 2026-09-14 from a live read.
 *
 * ★★ **What ESIS actually sends is unlabelled**: `infoFlag1`–`infoFlag13`,
 * `infoText4/5/6`, `infoNumber5/6`. The flags carry `"Y"` / `"N"` / `null` and
 * the ministry publishes no legend for which question each number answers.
 *
 * That is why nothing here renames them. The invented schema *was* a legend —
 * `infoFlag1` guessed to be "herder family", say — and a guessed legend is how
 * a screen tells a director that a family is something it has no idea whether
 * they are. The numbered keys travel through as they arrive, are shown as
 * codes, and stay unmapped until the ministry supplies the meanings. There is
 * no `targetModel` for the same reason: nothing here can be stored against a
 * column when nobody can say what it means.
 *
 * ★★★ `infoFlag8` is absent from the live payload. It is listed anyway — the
 * gap is the ministry's, and a schema that renumbered around it would disagree
 * with the next institution that does send it.
 */
export const esisStudentStatisticsSchema = z.object({
  studentStatisticsId: nullableIdentifier,
  institutionId: nullableIdentifier,
  personId: identifier,
  infoFlag1: nullableFlag,
  infoFlag2: nullableFlag,
  infoFlag3: nullableFlag,
  infoFlag4: nullableFlag,
  infoFlag5: nullableFlag,
  infoFlag6: nullableFlag,
  infoFlag7: nullableFlag,
  infoFlag8: nullableFlag,
  infoFlag9: nullableFlag,
  infoFlag10: nullableFlag,
  infoFlag11: nullableFlag,
  infoFlag12: nullableFlag,
  infoFlag13: nullableFlag,
  infoText4: nullableString,
  infoText5: nullableString,
  infoText6: nullableString,
  infoNumber5: nullableCount,
  infoNumber6: nullableCount,
});

/**
 * One child's living conditions — амьдрах орчин.
 *
 * ★ Rewritten 2026-09-14: all fifteen keys it carried were invented, and the
 * service is not the dwelling survey they described. What it returns is where
 * the child lives relative to the institution — `studentLivingPalace`, the
 * distance, and a dormitory block that is empty for a kindergarten and exists
 * because the same service serves schools with boarding.
 *
 * ★★ `annualTuitionFee` arrives here, from a service about living conditions.
 * It is parsed and **not** ingested: a fee the ministry holds is not the fee
 * this kindergarten invoices, and letting the two meet in one screen is how a
 * family gets shown a number nobody here set. See `esis.fields.ts`.
 *
 * ★★★ `studentStatisticId` — singular, no `s` — is not a typo on our side.
 * `studentStatistics` above spells the same id `studentStatisticsId`. The two
 * services disagree, and both spellings are copied as they arrive.
 */
export const esisStudentConditionSchema = z.object({
  studentStatisticId: nullableIdentifier,
  institutionId: nullableIdentifier,
  personId: identifier,
  academicYear: nullableIdentifier,
  studentLivingPalace: nullableString,
  livingPlaceDistance: nullableNumber,
  enrollYear: nullableString,
  annualTuitionFee: nullableNumber,
  dormitoryPropertyType: nullableString,
  dormitoryOwner: nullableString,
  dormitorySchoolId: nullableIdentifier,
  dormitoryId: nullableIdentifier,
});

/**
 * A teacher's заах аргын нэгдэл — the academic unit they belong to.
 *
 * ★ **Rewritten from a live read, 2026-09-14.** Seven of the nine keys here
 * were invented — `academicOrgId/Name`, `parentAcademicOrgId/Name`,
 * `positionName`, `beginDate`, `endDate` — and every one of them was
 * `nullable().optional()`, so Zod accepted the row and threw away the whole
 * payload. The panel drew four empty columns and looked like an institution
 * with no academic units rather than a mapping written against the wrong
 * service. A schema that cannot fail is worse than one that does.
 *
 * `GET /svc/api/hub/v2/teacher/academic/org/:personId?institutionId=` returns
 * the job and the department, and nothing else.
 */
export const esisTeacherAcademicOrgSchema = z.object({
  institutionId: nullableIdentifier,
  personId: identifier,
  jobCode: nullableString,
  jobName: nullableString,
  subjectDepartmentId: nullableIdentifier,
  subjectDepartmentName: nullableString,
});

/**
 * A teacher assignment movement — appointment, transfer, release.
 *
 * ★ Rewritten from a live read, 2026-09-14, for the same reason as the schema
 * above: `movementTypeId/Name`, `positionName`, `beginDate`, `endDate` and
 * `orderNumber` do not exist. The movement itself is `actionId` / `actionName`
 * / `actionDate`, and the row is otherwise a thin copy of the teacher record.
 *
 * ★★ On this institution every `action*` came back null while the names and
 * assignment ids were populated, so the service answers "who holds an
 * assignment" more reliably than "what changed". `esis.fields.ts` says so
 * rather than implying a movement history that may be empty in practice.
 */
export const esisTeacherMovementSchema = z.object({
  institutionId: nullableIdentifier,
  personId: identifier,
  assignmentId: nullableIdentifier,
  assignmentName: nullableString,
  displayName: nullableString,
  instructorId: nullableIdentifier,
  instructorTypeId: nullableIdentifier,
  typeName: nullableString,
  subjectDepartmentId: nullableIdentifier,
  subjectDepartmentName: nullableString,
  instructorAvailability: nullableString,
  actionId: nullableIdentifier,
  actionName: nullableString,
  actionDate: nullableString,
  ...personNameFields,
});

/** A group as it will stand in the next academic year. */
export const esisGroupNextYearSchema = z.object({
  institutionId: nullableIdentifier,
  studentGroupId: nullableIdentifier,
  studentGroupName: nullableString,
  academicYear: nullableIdentifier,
  academicLevel: nullableIdentifier,
  academicLevelName: nullableString,
  programOfStudyId: nullableIdentifier,
  programOfStudyName: nullableString,
  studentCount: nullableCount,
});

/* ── Хөтөлбөрийн шатлал: программ → үе шат → төлөвлөгөө → хичээл ─────────── */

/**
 * One programme of study.
 *
 * ★ `programTypeName` and `activeFlag` were invented; the classification
 * arrives as an id and a name instead, and there is an education-level **code**
 * beside the level name. 2026-09-14, live.
 *
 * ★★ `programClassficationName` is spelled that way by the ministry. It is
 * copied verbatim rather than corrected — a key renamed on our side is a key
 * that does not match the payload.
 */
export const esisProgramSchema = z.object({
  institutionId: nullableIdentifier,
  programOfStudyId: identifier,
  programOfStudyName: nullableString,
  programClassificationId: nullableIdentifier,
  programClassficationName: nullableString,
  educationLevelCode: nullableString,
  educationLevelName: nullableString,
});

export const esisProgramStageSchema = z.object({
  programOfStudyId: nullableIdentifier,
  programStageId: identifier,
  programStageName: nullableString,
  sequence: nullableCount,
  academicLevel: nullableIdentifier,
  academicLevelName: nullableString,
});

export const esisProgramPlanSchema = z.object({
  programOfStudyId: nullableIdentifier,
  programStageId: nullableIdentifier,
  programPlanId: identifier,
  programPlanName: nullableString,
  academicYear: nullableIdentifier,
  activeFlag: nullableFlag,
});

export const esisProgramCourseSchema = z.object({
  programOfStudyId: nullableIdentifier,
  programStageId: nullableIdentifier,
  programPlanId: nullableIdentifier,
  courseId: identifier,
  courseName: nullableString,
  courseCode: nullableString,
  subjectAreaId: nullableIdentifier,
  subjectAreaName: nullableString,
  credit: nullableNumber,
  hours: nullableCount,
});

/* ── Сургалтын орчин ────────────────────────────────────────────────────── */

/**
 * One room, as the ministry keeps it.
 *
 * ★ **This one threw**, and it is the reason the whole catalog was checked
 * against live responses on 2026-09-14. The schema required `roomId`; ESIS
 * calls it `facilityId`. A required key that never arrives fails the row, the
 * row fails the list, and `rooms` is in `ESIS_PREVIEW_RESOURCES` — so the
 * operator's dry-run, the screen whose entire job is proving the fields are
 * ready, reported `invalid_response` on a service that was answering perfectly.
 *
 * ★★ The dimensions are real and separate: `roomWidth`, `roomLength` and
 * `roomHeight` in metres, where the old schema had a single invented `area`.
 * Nothing multiplies them here — a floor area the ministry did not state is a
 * number we would be making up.
 */
export const esisRoomSchema = z.object({
  facilityId: identifier,
  institutionId: nullableIdentifier,
  buildingId: nullableIdentifier,
  buildingPurposeCode: nullableString,
  facilityTypeId: nullableIdentifier,
  classRoomType: nullableString,
  roomName: nullableString,
  roomNumber: nullableString,
  description: nullableString,
  floorNumber: nullableCount,
  roomCapacity: nullableCount,
  roomWidth: nullableNumber,
  roomLength: nullableNumber,
  roomHeight: nullableNumber,
});

/**
 * An academic unit — заах аргын нэгдэл.
 *
 * ★ The second schema that threw, 2026-09-14: it required `academicOrgId` and
 * ESIS sends `subjectDepartmentId`. The unit is named by the same pair
 * `teacherAcademicOrg` uses, which is what makes a teacher joinable to it —
 * the invented `academicOrgId` could never have joined to anything.
 */
export const esisAcademicOrgSchema = z.object({
  institutionId: nullableIdentifier,
  subjectDepartmentId: identifier,
  subjectDepartmentName: nullableString,
  shortName: nullableString,
  institutionTypeId: nullableIdentifier,
  institutionTypeName: nullableString,
  parentGroupId: nullableIdentifier,
  parentGroupName: nullableString,
  managerId: nullableIdentifier,
  managerName: nullableString,
});

/**
 * A subject area.
 *
 * ★ Three of the five keys were invented — `subjectAreaCode`,
 * `parentSubjectAreaId`, `educationLevelName`. What ESIS actually adds is the
 * name in the traditional Mongolian script, which the roster services already
 * carry for people (`familyNameMgl` and its pair) and which this product
 * displays wherever it is offered.
 */
export const esisSubjectAreaSchema = z.object({
  subjectAreaId: identifier,
  subjectAreaName: nullableString,
  subjectAreaNameMgl: nullableString,
});

/* ══ Эрүүл мэнд, вакцин, хэмжилт, эрт илрүүлэг — 2026-09-14 ═══════════════ */

/**
 * One health examination — үзлэг, шинжилгээ.
 *
 * Captured live from institution 42778. `consultationType` and
 * `consultationResult` arrive as codes (`COMPREHENSIVE_PHYSICAL`, `HEALTHY`)
 * with no published legend, so they are carried through as codes rather than
 * translated into labels this side cannot verify.
 *
 * ★ The attachment block is metadata only — `attachmentUrl` is ESIS's own
 * address and is never fetched or proxied from here. CLAUDE.md §1.4 governs
 * files this product serves; a ministry URL shown to staff is a link, not a
 * media object, and it does not enter `MediaFile`.
 */
export const esisStudentAssessmentSchema = z.object({
  studentAssessmentId: nullableIdentifier,
  institutionId: nullableIdentifier,
  personId: identifier,
  consultationType: nullableString,
  consultationSubtype: nullableString,
  consultationDate: nullableString,
  nextConsultationDate: nullableString,
  examinerOrganization: nullableString,
  examinerPerson: nullableString,
  consultationResult: nullableString,
  consultationResultDetail: nullableString,
  treatmentFlag: nullableFlag,
  treatmentDetails: nullableString,
  description: nullableString,
  descriptionUrl: nullableString,
  studentAssessAttachmentId: nullableIdentifier,
  attachmentName: nullableString,
  attachmentUrl: nullableString,
  fileType: nullableString,
  fileSize: nullableCount,
});

/** One child's growth measurement — өсөлт, хөгжил. Captured live. */
export const esisStudentMeasurementSchema = z.object({
  studentMeasurementId: nullableIdentifier,
  institutionId: nullableIdentifier,
  personId: identifier,
  academicYear: nullableIdentifier,
  measurementDate: nullableString,
  height: nullableNumber,
  weight: nullableNumber,
  weightIndex: nullableNumber,
});

/**
 * A group's measurement worksheet — one row per child, nulls where unmeasured.
 *
 * ★ Captured live: 14 rows for бага бүлэг with every measurement field null,
 * and `institutionId` and `personId` null too. So `personId` is **not**
 * required here, unlike every other per-child schema in this file — the row is
 * a slot in a worksheet before it is a record about a person.
 */
export const esisGroupMeasurementSchema = z.object({
  institutionId: nullableIdentifier,
  studentGroupId: nullableIdentifier,
  personId: nullableIdentifier,
  measurementDate: nullableString,
  measurementFlag: nullableFlag,
  reason: nullableString,
  weight: nullableNumber,
  height: nullableNumber,
  waist: nullableNumber,
  hips: nullableNumber,
});

/*
 * ── Вакцин ──────────────────────────────────────────────────────────────────
 * ★ SCREAMING_SNAKE_CASE, alone in this file. These rows come from the
 * immunisation registry behind ESIS rather than from ESIS's own tables, and
 * the naming follows that system. Renaming them to match the house style would
 * mean the schema no longer matches the payload — see `programClassficationName`
 * for the same decision about a ministry typo.
 */

/** The national vaccine catalogue — name and dose only. */
export const esisVaccineCatalogSchema = z.object({
  VACCINE_NAME: nullableString,
  VACCINE_DOSE: nullableString,
});

/** One dose a child has received. Captured live: 17 rows for one child. */
export const esisVaccineHistorySchema = z.object({
  PERSON_ID: nullableIdentifier,
  VACCINE_NAME: nullableString,
  VACCINE_GROUP_TYPE: nullableString,
  VACCINE_DOSE: nullableString,
  APPROVED_DATE: nullableString,
  HOSPITAL_NAME: nullableString,
  SERIAL_NUMBER: nullableString,
  STATUS: nullableString,
  OBJECT_VERSION_NUMBER: nullableCount,
  CREATED_BY: nullableString,
  CREATION_DATE: nullableString,
  LAST_UPDATED_BY: nullableString,
  LAST_UPDATE_DATE: nullableString,
});

/**
 * One scheduled future dose — товлолт вакцин.
 *
 * ★ `PHONE_NO` — a **guardian's telephone number**, arriving from an
 * immunisation service — is **absent from this schema on purpose**, so Zod
 * strips it before it reaches anything. `esis.fields.ts` still lists it as a
 * refused output, which is how a reviewer sees that we knew about it and
 * declined; the refusal itself is enforced here, by omission, exactly as it is
 * for `civilId` on the roster services.
 *
 * The guardian block on a child's record is fed by `studentContacts`, which is
 * the service whose job that is. A second source for the same fact is how two
 * screens come to disagree about how to reach a family.
 */
export const esisVaccinePlanSchema = z.object({
  PERSON_ID: nullableIdentifier,
  VACCINE_NAME: nullableString,
  VACCINE_GROUP_NAME: nullableString,
  VACCINE_GROUP_TYPE_NAME: nullableString,
  VACCINE_GROUP_TYPE_NAME_ENG: nullableString,
  STEP_AGE: nullableString,
  STEP_NAME: nullableString,
  STEP_NAME_ENG: nullableString,
  PLAN_DATE: nullableString,
  PLAN_HOSPITAL_NAME: nullableString,
  PLAN_OFFICE_NAME: nullableString,
  SUB_OFFICE_NAME: nullableString,
  /* PHONE_NO is deliberately not here — see the note above. */
  STATUS: nullableString,
  OBJECT_VERSION_NUMBER: nullableCount,
  CREATED_BY: nullableString,
  CREATION_DATE: nullableString,
  LAST_UPDATED_BY: nullableString,
  LAST_UPDATE_DATE: nullableString,
});

/** One question of the ministry's screening instrument. 25 came back live. */
export const esisScreeningQuestionSchema = z.object({
  surveyNameId: identifier,
  surveyName: nullableString,
});

/**
 * One group's attendance for one day, as the ministry has it.
 *
 * ★ One row **per group**, not per child — captured live: four rows, one for
 * each of the institution's groups, all reading `status: "Бүртгээгүй"` with
 * zero counts.
 */
export const esisSchoolAttendanceSchema = z.object({
  dayDate: nullableString,
  studentGroupId: nullableIdentifier,
  studentGroupName: nullableString,
  programStageId: nullableIdentifier,
  academicLevel: nullableString,
  instructorId: nullableIdentifier,
  displayName: nullableString,
  status: nullableString,
  allStu: nullableCount,
  reasonPresent: nullableCount,
  reasonSick: nullableCount,
  reasonExcused: nullableCount,
  reasonUnexcused: nullableCount,
  reasonOnline: nullableCount,
  tardyMinuteSum: nullableCount,
});

/*
 * ── Багш, ажилтныг бүртгэх ──────────────────────────────────────────────────
 */

/**
 * One worker, found by register number. Captured live.
 *
 * ★ `civilId` and `personRegNumber` come back and are **not** parsed. The
 * number is typed by an operator and sent; keeping the copy ESIS returns would
 * be the thing `ESIS_REQUEST.md` §1.1 (b) refuses, and the response is the
 * easiest place to acquire it by accident.
 */
export const esisWorkerInfoSchema = z.object({
  userRole: nullableString,
  personId: identifier,
  institutionId: nullableIdentifier,
  institutionName: nullableString,
  firstName: nullableString,
  lastName: nullableString,
  familyName: nullableString,
  employeeId: nullableIdentifier,
  instructorId: nullableIdentifier,
  jobCode: nullableString,
  jobName: nullableString,
  studentGroupId: nullableIdentifier,
  studentGroupName: nullableString,
  programStageId: nullableIdentifier,
  academicLevel: nullableString,
  academicYear: nullableIdentifier,
});

/**
 * A teacher's employment record — the fields a `StaffRecord` is filled from.
 *
 * ★ The years are decimals (`totalWorkYears: 8.8`), not whole years, so they
 * take `nullableNumber` rather than `nullableCount`. Rounding a length of
 * service on the way in would be a silent edit to somebody's record.
 */
export const esisTeacherProfileSchema = z.object({
  assignmentId: nullableIdentifier,
  personId: identifier,
  institutionId: nullableIdentifier,
  jobCode: nullableString,
  jobName: nullableString,
  positionId: nullableIdentifier,
  positionName: nullableString,
  instructorTypeName: nullableString,
  subjectDepartmentId: nullableIdentifier,
  subjectDepartmentName: nullableString,
  totalWorkYears: nullableNumber,
  educationSectorYears: nullableNumber,
  professionalExperience: nullableNumber,
  yearOfService: nullableNumber,
  publicServiceYears: nullableNumber,
  civilServiceYears: nullableNumber,
  higherEducationYears: nullableNumber,
  ...officialEmailFields,
});

/*
 * ── The three writes ────────────────────────────────────────────────────────
 *
 * ★ `.strict()`, like `esisAttendanceUploadSchema` above it. A write to the
 * ministry is the one direction where an extra key is not a harmless surprise:
 * it is a field we invented arriving at somebody else's database. Strict means
 * a typo fails here, in our own validation, rather than at ESIS.
 *
 * ★★ **The input shapes are unconfirmed**, for the same reason the reads above
 * are loose: the Суралцагч section is not publicly documented. They mirror the
 * read schemas — which is the best available reading and the one a reviewer can
 * check against them — and the operator screen labels the fields as inputs
 * rather than outputs. Nothing sends until a token exists (C3), so the first
 * real call is the confirmation.
 */

export const esisStudentContactsUploadSchema = z
  .object({
    institutionId: z.number().int().positive(),
    personId: z.number().int().positive(),
    contactList: z.array(
      z
        .object({
          contactId: z.number().int().positive().optional(),
          relationTypeId: z.number().int().positive(),
          lastName: z.string().min(1),
          firstName: z.string().min(1),
          phoneNumber: z.string().min(1),
          email: z.string().optional(),
          address: z.string().optional(),
          occupation: z.string().optional(),
          workplace: z.string().optional(),
          primaryFlag: z.boolean().default(false),
          liveTogetherFlag: z.boolean().default(true),
        })
        .strict(),
    ),
  })
  .strict();

export type EsisStudentContactsUpload = z.input<typeof esisStudentContactsUploadSchema>;

export const esisStudentStatisticsUploadSchema = z
  .object({
    institutionId: z.number().int().positive(),
    personId: z.number().int().positive(),
    familyMemberCount: z.number().int().min(1),
    childrenCount: z.number().int().min(0),
    familyTypeId: z.number().int().positive().optional(),
    incomeTypeId: z.number().int().positive().optional(),
    livelihoodTypeId: z.number().int().positive().optional(),
    isHerderFamily: z.boolean().default(false),
    isSingleParent: z.boolean().default(false),
    hasDisabledMember: z.boolean().default(false),
    socialWelfareFlag: z.boolean().default(false),
  })
  .strict();

export type EsisStudentStatisticsUpload = z.input<typeof esisStudentStatisticsUploadSchema>;

export const esisStudentConditionUploadSchema = z
  .object({
    institutionId: z.number().int().positive(),
    personId: z.number().int().positive(),
    dwellingTypeId: z.number().int().positive().optional(),
    ownershipTypeId: z.number().int().positive().optional(),
    heatingTypeId: z.number().int().positive().optional(),
    waterSourceId: z.number().int().positive().optional(),
    toiletTypeId: z.number().int().positive().optional(),
    electricityFlag: z.boolean().default(true),
    internetFlag: z.boolean().default(false),
    roomCount: z.number().int().min(0).optional(),
  })
  .strict();

export type EsisStudentConditionUpload = z.input<typeof esisStudentConditionUploadSchema>;

export const esisAttendanceUploadSchema = z
  .object({
    institutionId: z.number().int().positive(),
    studentGroupId: z.number().int().positive(),
    dayDate: z.iso.date(),
    attendanceList: z.array(
      z.object({
        personId: z.number().int().positive(),
        attendReasonCode: z.enum(["PRESENT", "EXCUSED", "SICK", "UNEXCUSED"]),
        tardyMinutes: z.number().int().min(0),
        attendReasonList: z.array(z.string()).default([]),
      }),
    ),
  })
  .strict();

export type EsisAttendanceUpload = z.input<typeof esisAttendanceUploadSchema>;

/* ══ Эрүүл мэндийн бичих сервисүүд — 2026-09-14 ══════════════════════════════
 *
 * ★ **Every input shape below is unproven, and reading cannot prove one.** The
 * eleven output contracts corrected on the day these were written were found by
 * comparing declarations with live responses; there is no equivalent move for a
 * request body. Each mirrors its own read where that read has been observed
 * (`assessments`, `measure`) and follows the sibling saves' convention where it
 * has not.
 *
 * ★★ `.strict()` throughout, for the reason the block above gives: an extra key
 * on a write is a field we invented arriving in the ministry's database, and it
 * should fail in our own validation rather than there.
 *
 * ★★★ Five of these — allergy, prohibited food, disability, surgery, incident —
 * mirror reads that have **never returned a row**, so their field names are
 * inference on top of inference. They are deliberately the thinnest shapes in
 * this file: an id, the child, a date, a description. Guessing a rich structure
 * would only mean more ways to be wrong, and `ESIS_DISCOVERED_SHAPE` will name
 * the real fields the first time a record exists — at which point these are
 * rewritten from it rather than from imagination.
 */

/** The child and institution every health write identifies its subject by. */
const healthWriteSubject = {
  institutionId: z.number().int().positive(),
  personId: z.number().int().positive(),
};

export const esisStudentAllergyUploadSchema = z
  .object({
    ...healthWriteSubject,
    studentAllergyId: z.number().int().positive().optional(),
    allergyName: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();
export type EsisStudentAllergyUpload = z.input<typeof esisStudentAllergyUploadSchema>;

export const esisStudentProhibitedFoodUploadSchema = z
  .object({
    ...healthWriteSubject,
    studentProhibitId: z.number().int().positive().optional(),
    prohibitName: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();
export type EsisStudentProhibitedFoodUpload = z.input<typeof esisStudentProhibitedFoodUploadSchema>;

export const esisStudentDisabilityUploadSchema = z
  .object({
    ...healthWriteSubject,
    studentDisabilityId: z.number().int().positive().optional(),
    disabilityType: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();
export type EsisStudentDisabilityUpload = z.input<typeof esisStudentDisabilityUploadSchema>;

export const esisStudentSurgeryUploadSchema = z
  .object({
    ...healthWriteSubject,
    studentSurgeryId: z.number().int().positive().optional(),
    surgeryName: z.string().min(1),
    surgeryDate: z.iso.date().optional(),
    description: z.string().optional(),
  })
  .strict();
export type EsisStudentSurgeryUpload = z.input<typeof esisStudentSurgeryUploadSchema>;

export const esisStudentIncidentUploadSchema = z
  .object({
    ...healthWriteSubject,
    studentIncidentId: z.number().int().positive().optional(),
    incidentName: z.string().min(1),
    incidentDate: z.iso.date().optional(),
    description: z.string().optional(),
  })
  .strict();
export type EsisStudentIncidentUpload = z.input<typeof esisStudentIncidentUploadSchema>;

/** Mirrors `esisStudentAssessmentSchema`, which has been observed live. */
export const esisStudentAssessmentUploadSchema = z
  .object({
    ...healthWriteSubject,
    studentAssessmentId: z.number().int().positive().optional(),
    consultationType: z.string().min(1),
    consultationSubtype: z.string().optional(),
    consultationDate: z.iso.date(),
    nextConsultationDate: z.iso.date().optional(),
    examinerOrganization: z.string().optional(),
    examinerPerson: z.string().optional(),
    consultationResult: z.string().optional(),
    consultationResultDetail: z.string().optional(),
    treatmentFlag: z.enum(["Y", "N"]).optional(),
    treatmentDetails: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();
export type EsisStudentAssessmentUpload = z.input<typeof esisStudentAssessmentUploadSchema>;

/** Mirrors `esisStudentMeasurementSchema`, which has been observed live. */
export const esisStudentMeasurementUploadSchema = z
  .object({
    ...healthWriteSubject,
    studentMeasurementId: z.number().int().positive().optional(),
    measurementDate: z.iso.date(),
    height: z.number().positive(),
    weight: z.number().positive(),
  })
  .strict();
export type EsisStudentMeasurementUpload = z.input<typeof esisStudentMeasurementUploadSchema>;

/**
 * A whole group measured in one sitting — the pair of `groupMeasurements`.
 *
 * ★ The read returns a row per child with nulls where nobody has been measured,
 * so the write mirrors it: one entry per child, and `reason` for a child who
 * was not measured. `personId` is per entry rather than at the top, which is
 * the one structural difference from the single save above.
 */
export const esisGroupMeasurementUploadSchema = z
  .object({
    institutionId: z.number().int().positive(),
    studentGroupId: z.number().int().positive(),
    measurementDate: z.iso.date(),
    measurementList: z.array(
      z
        .object({
          personId: z.number().int().positive(),
          height: z.number().positive().optional(),
          weight: z.number().positive().optional(),
          waist: z.number().positive().optional(),
          hips: z.number().positive().optional(),
          reason: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type EsisGroupMeasurementUpload = z.input<typeof esisGroupMeasurementUploadSchema>;

/**
 * One child's answers to the ministry's screening instrument.
 *
 * ★ `surveyNameId` is the question id `screeningQuestions` returns — the one
 * part of this shape that is not inference, because the 25 questions came back
 * live and carry exactly that key. The answer's own encoding is not published;
 * it is sent as a string rather than coerced into a scale nobody has defined.
 */
export const esisStudentScreeningUploadSchema = z
  .object({
    ...healthWriteSubject,
    answerList: z.array(
      z
        .object({
          surveyNameId: z.number().int().positive(),
          answer: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();
export type EsisStudentScreeningUpload = z.input<typeof esisStudentScreeningUploadSchema>;
