import { z } from "zod";

const identifier = z.union([z.string(), z.number()]).transform(String);
const nullableString = z.string().nullable().optional();
const nullableNumber = z.number().nullable().optional();

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
  propertyTypeName: nullableString,
  institutionTypeName: nullableString,
  provinceName: nullableString,
  districtName: nullableString,
  subDistrictName: nullableString,
  institutionAddress: nullableString,
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
  instructorId: identifier.optional(),
  instructorName: nullableString,
  academicYear: z.string(),
  groupClassificationName: nullableString,
  groupCategoryCode: nullableString,
  groupCategoryName: nullableString,
});

/** Deliberately excludes civil/register numbers and provider-issued passwords. */
export const esisStudentSchema = z.object({
  institutionId: identifier,
  personId: identifier,
  familyName: nullableString,
  lastName: z.string(),
  firstName: z.string(),
  dateOfBirth: z.string(),
  genderCode: z.string(),
  studentGroupId: identifier.optional(),
  studentGroupName: nullableString,
  academicYear: nullableString,
  programStatus: nullableString,
  programStatusName: nullableString,
});

export const esisMovementSchema = esisStudentSchema.extend({
  studentProgramId: identifier.optional(),
  actionId: identifier.optional(),
  actionName: nullableString,
  actionDate: z.string(),
  approvalStatusCode: nullableString,
});

/** Deliberately excludes civil/register numbers, email passwords and service history. */
export const esisStaffSchema = z.object({
  institutionId: identifier,
  assignmentId: identifier,
  personId: identifier,
  displayName: nullableString,
  lastName: z.string(),
  firstName: z.string(),
  genderCode: nullableString,
  positionName: nullableString,
  positionCode: nullableString,
});

export const esisAttendanceSchema = z.object({
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
});

export const esisFoodProductSchema = z.object({
  productId: identifier.optional(),
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
});

export const esisAttendanceUploadSchema = z
  .object({
    studentGroupId: z.number().int().positive(),
    dayDate: z.iso.date(),
    attendanceList: z.array(
      z.object({
        personId: z.number().int().positive(),
        attendReasonCode: z.string().min(1),
        tardyMinutes: z.number().int().min(0),
        attendReasonList: z.array(z.string()).default([]),
      }),
    ),
  })
  .strict();

export type EsisAttendanceUpload = z.input<typeof esisAttendanceUploadSchema>;
