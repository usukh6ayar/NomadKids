import { z } from "zod";

const identifier = z.union([z.string(), z.number()]).transform(String);
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

/** Parse the documented ESIS envelope and return only its RESULT rows. */
export function esisListParser<T>(row: z.ZodType<T>): (body: unknown) => T[] {
  const envelope = z.object({
    SUCCESS_CODE: z.number(),
    RESPONSE_MESSAGE: z.string(),
    RESULT: z.array(row),
  });
  return (body) => envelope.parse(body).RESULT;
}

export const esisOrganizationSchema = z.object({
  institutionId: identifier,
  institutionName: z.string(),
  shortName: nullableString,
  longName: nullableString,
  legalName: nullableString,
  legalNameMgl: nullableString,
  propertyTypeName: nullableString,
  institutionTypeId: identifier.optional(),
  institutionTypeName: nullableString,
  provinceName: nullableString,
  districtName: nullableString,
  subDistrictName: nullableString,
  regionName: nullableString,
  institutionAddress: nullableString,
  institutionClassificationId: identifier.optional(),
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
  programOfStudyId: identifier.optional(),
  programOfStudyName: nullableString,
  programStageId: identifier.optional(),
  programStageName: nullableString,
  programPlanId: nullableIdentifier,
  programPlanName: nullableString,
  groupTypeCode: nullableString,
  groupTypeName: nullableString,
  groupShiftId: identifier.optional(),
  groupShiftName: nullableString,
  groupClassificationId: identifier.optional(),
  groupClassificationName: nullableString,
  groupCategoryCode: nullableString,
  groupCategoryName: nullableString,
  academicGroupId: identifier.optional(),
  academicGroupName: nullableString,
  instructorId: identifier.optional(),
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
  studentGroupId: identifier.optional(),
  studentGroupName: nullableString,
  programOfStudyId: nullableIdentifier,
  programOfStudyName: nullableString,
  programPlanId: nullableIdentifier,
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
  actionId: identifier.optional(),
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
  instructorId: identifier.optional(),
  displayName: nullableString,
  ...personNameFields,
  positionName: nullableString,
  instructorTypeId: identifier.optional(),
  instructorTypeName: nullableString,
  subjectDepartmentId: identifier.optional(),
  subjectDepartmentName: nullableString,
  instructorAvailability: nullableFlag,
  ...officialEmailFields,
});

/** Deliberately excludes civil/register numbers, provider passwords and salary. */
export const esisStaffSchema = z.object({
  institutionId: identifier,
  institutionName: nullableString,
  parentInstitutionId: identifier.optional(),
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

/** Whether ESIS already holds this child, and under which group. */
export const esisStudentCheckSchema = z.object({
  institutionId: nullableIdentifier,
  personId: identifier,
  isRegistered: nullableFlag,
  statusCode: nullableIdentifier,
  statusName: nullableString,
  studentGroupId: nullableIdentifier,
  studentGroupName: nullableString,
  academicYear: nullableIdentifier,
  enrollmentDate: nullableString,
});

/**
 * One guardian contact.
 *
 * ★ `personId` is the **child's** ESIS id and `contactId` the guardian's own
 * row. Both are kept: the child id is what joins this to a `Child`, and the
 * contact id is what a save has to send back to update rather than duplicate.
 *
 * ★★ No register number, no civil id — the same refusal every roster service
 * makes, and for the same document (`ESIS_REQUEST.md` §1.1 (b)). A guardian's
 * national identifier is not needed to show a parent's telephone number.
 */
export const esisStudentContactSchema = z.object({
  institutionId: nullableIdentifier,
  personId: identifier,
  contactId: nullableIdentifier,
  relationTypeId: nullableIdentifier,
  relationTypeName: nullableString,
  lastName: nullableString,
  firstName: nullableString,
  phoneNumber: nullableString,
  phoneNumber2: nullableString,
  email: nullableString,
  address: nullableString,
  occupation: nullableString,
  workplace: nullableString,
  primaryFlag: nullableFlag,
  liveTogetherFlag: nullableFlag,
});

/** One child's household statistics — өрхийн мэдээлэл. */
export const esisStudentStatisticsSchema = z.object({
  institutionId: nullableIdentifier,
  personId: identifier,
  familyMemberCount: nullableCount,
  childrenCount: nullableCount,
  familyTypeId: nullableIdentifier,
  familyTypeName: nullableString,
  incomeTypeId: nullableIdentifier,
  incomeTypeName: nullableString,
  livelihoodTypeId: nullableIdentifier,
  livelihoodTypeName: nullableString,
  isHerderFamily: nullableFlag,
  isSingleParent: nullableFlag,
  hasDisabledMember: nullableFlag,
  socialWelfareFlag: nullableFlag,
  updatedDate: nullableString,
});

/** One child's living conditions — амьдрах орчин. */
export const esisStudentConditionSchema = z.object({
  institutionId: nullableIdentifier,
  personId: identifier,
  dwellingTypeId: nullableIdentifier,
  dwellingTypeName: nullableString,
  ownershipTypeId: nullableIdentifier,
  ownershipTypeName: nullableString,
  heatingTypeId: nullableIdentifier,
  heatingTypeName: nullableString,
  waterSourceId: nullableIdentifier,
  waterSourceName: nullableString,
  toiletTypeId: nullableIdentifier,
  toiletTypeName: nullableString,
  electricityFlag: nullableFlag,
  internetFlag: nullableFlag,
  roomCount: nullableCount,
  distanceToSchool: nullableString,
  updatedDate: nullableString,
});

/** A teacher's заах аргын нэгдэл — the academic unit they belong to. */
export const esisTeacherAcademicOrgSchema = z.object({
  institutionId: nullableIdentifier,
  personId: identifier,
  academicOrgId: nullableIdentifier,
  academicOrgName: nullableString,
  parentAcademicOrgId: nullableIdentifier,
  parentAcademicOrgName: nullableString,
  positionName: nullableString,
  beginDate: nullableString,
  endDate: nullableString,
});

/** A teacher assignment movement — appointment, transfer, release. */
export const esisTeacherMovementSchema = z.object({
  institutionId: nullableIdentifier,
  personId: identifier,
  assignmentId: nullableIdentifier,
  movementTypeId: nullableIdentifier,
  movementTypeName: nullableString,
  positionName: nullableString,
  beginDate: nullableString,
  endDate: nullableString,
  orderNumber: nullableString,
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

export const esisProgramSchema = z.object({
  institutionId: nullableIdentifier,
  programOfStudyId: identifier,
  programOfStudyName: nullableString,
  programTypeName: nullableString,
  educationLevelName: nullableString,
  activeFlag: nullableFlag,
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

export const esisRoomSchema = z.object({
  institutionId: nullableIdentifier,
  buildingId: nullableIdentifier,
  buildingName: nullableString,
  roomId: identifier,
  roomName: nullableString,
  roomNumber: nullableString,
  roomTypeId: nullableIdentifier,
  roomTypeName: nullableString,
  capacity: nullableCount,
  area: nullableNumber,
  floor: nullableIdentifier,
});

export const esisAcademicOrgSchema = z.object({
  institutionId: nullableIdentifier,
  academicOrgId: identifier,
  academicOrgName: nullableString,
  parentAcademicOrgId: nullableIdentifier,
  parentAcademicOrgName: nullableString,
  academicOrgTypeName: nullableString,
  activeFlag: nullableFlag,
});

export const esisSubjectAreaSchema = z.object({
  subjectAreaId: identifier,
  subjectAreaName: nullableString,
  subjectAreaCode: nullableString,
  parentSubjectAreaId: nullableIdentifier,
  educationLevelName: nullableString,
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
