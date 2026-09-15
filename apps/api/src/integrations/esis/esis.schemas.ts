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
 * mixed scalar forms in a few services. `identifier` and `tardyMinutes` take
 * this shape for the same reason: accept both, normalise once, and tighten
 * after C4 shows what ESIS sends for the kindergarten scope.
 *
 * ★★ `grossWeight`, the schema this comment once also named, was deleted
 * 2026-09-15 with `esisFoodProductMaterialSchema` — `foodProductMaterials`
 * has no domain consumer and moved to `esisDiscoveredSchema`.
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
  /*
   * ★ Added 2026-09-15, moving `vaccinePlan` to `esisDiscoveredSchema`.
   *
   * A guardian's telephone number, from an immunisation service. It used to be
   * refused by the hand-written schema simply not naming it — see the deleted
   * `esisVaccinePlanSchema`'s note and `esis.fields.ts`'s `drop("PHONE_NO", …)`
   * on the same reader. A passthrough cannot refuse by omission, so it has to
   * be named here or it reaches the operator screen and the audit metadata.
   */
  "PHONE_NO",
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

/**
 * Mirrors the `studentAssessments` read, which has been observed live.
 *
 * ★ The read schema this once named (`esisStudentAssessmentSchema`) was
 * deleted 2026-09-15 — `studentAssessments` has no domain consumer reading a
 * named field, so it moved to `esisDiscoveredSchema`. This write shape still
 * mirrors what the read observed; only the reference changed.
 */
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

/**
 * Mirrors the `studentMeasurements` read, which has been observed live.
 *
 * ★ Same note as the schema above: `esisStudentMeasurementSchema` was deleted
 * 2026-09-15 when `studentMeasurements` moved to `esisDiscoveredSchema`.
 */
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
