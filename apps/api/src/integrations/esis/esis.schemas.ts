import { z } from "zod";

const identifier = z.union([z.string(), z.number()]).transform(String);
const nullableIdentifier = identifier.nullable().optional();
const nullableString = z.string().nullable().optional();
const nullableNumber = z.number().nullable().optional();

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
