import type { EsisEndpointKey } from "./esis.catalog";
import type { EsisField } from "./esis.fields";

export type EsisMappingStrategy =
  "DIRECT" | "MATCH" | "TRANSFORM" | "REQUEST" | "DISPLAY_ONLY" | "NOT_STORED" | "REJECTED";

export interface EsisFieldMapping {
  sourceField: string;
  targetField: string;
  strategy: EsisMappingStrategy;
  note: string;
}

type Target = Omit<EsisFieldMapping, "sourceField">;

const target = (targetField: string, strategy: EsisMappingStrategy, note: string): Target => ({
  targetField,
  strategy,
  note,
});

const COMMON: Record<string, Target> = {
  institutionId: target(
    "Kindergarten.esisInstitutionId",
    "DIRECT",
    "Tenant-ийн баталгаажсан ESIS байгууллагын кодтой тулгана.",
  ),
  academicYear: target(
    "SchoolYear.name",
    "TRANSFORM",
    "ESIS жилийг NomadKids-ийн хичээлийн жилийн нэртэй тулгана.",
  ),
  studentGroupId: target(
    "Group external ESIS mapping",
    "NOT_STORED",
    "Одоогийн schema-д ESIS group ID багана байхгүй; импортын өмнө нэмнэ.",
  ),
  studentGroupName: target("Group.name", "MATCH", "Бүлгийг нэр болон хичээлийн жилээр тулгана."),
  academicLevel: target("Group.ageBand", "TRANSFORM", "ESIS түвшний кодыг AgeBand руу хөрвүүлнэ."),
  academicLevelName: target(
    "Group.ageBand",
    "DISPLAY_ONLY",
    "Хөрвүүлэлтийн тайлбар болгон харуулна.",
  ),
  programOfStudyId: target(
    "Group external programme mapping",
    "NOT_STORED",
    "Одоогийн Group model энэ ESIS ID-г хадгалахгүй.",
  ),
  programStageId: target(
    "Group external stage mapping",
    "NOT_STORED",
    "Одоогийн Group model энэ ESIS ID-г хадгалахгүй.",
  ),
  programPlanId: target(
    "Enrollment external plan mapping",
    "NOT_STORED",
    "Одоогийн Enrollment model энэ ESIS ID-г хадгалахгүй.",
  ),
  personId: target(
    "Person external ESIS mapping",
    "NOT_STORED",
    "Raw person ID-г одоогоор local model-д хадгалахгүй.",
  ),
};

const CHILD: Record<string, Target> = {
  lastName: target("Child.lastName", "DIRECT", "Хүүхэд бүртгэх form-д урьдчилан бөглөнө."),
  firstName: target("Child.firstName", "DIRECT", "Хүүхэд бүртгэх form-д урьдчилан бөглөнө."),
  dateOfBirth: target("Child.dateOfBirth", "DIRECT", "ISO date хэлбэрээр хадгална."),
  genderCode: target(
    "Child.sex",
    "TRANSFORM",
    "ESIS genderCode-г NomadKids Sex enum руу хөрвүүлнэ.",
  ),
  programStatus: target(
    "Enrollment.status",
    "TRANSFORM",
    "ESIS төлөвийг EnrollmentStatus руу хөрвүүлнэ.",
  ),
  programStatusCode: target(
    "Enrollment.status",
    "TRANSFORM",
    "Шилжилтийн төлвийг EnrollmentStatus руу хөрвүүлнэ.",
  ),
  actionDate: target(
    "Enrollment.startedOn / endedOn",
    "TRANSFORM",
    "Үйлдлийн төрлөөс хамаарч эхлэх эсвэл дуусах огноо болгоно.",
  ),
};

const STAFF: Record<string, Target> = {
  lastName: target("User.lastName", "MATCH", "Local хэрэглэгчийг нэрээр тулгах нэг нөхцөл."),
  firstName: target("User.firstName", "MATCH", "Local хэрэглэгчийг нэрээр тулгах нэг нөхцөл."),
  microsoftEmail: target("User.email", "MATCH", "Албан и-мэйлээр local хэрэглэгчийг тулгана."),
  googleEmail: target("User.email", "MATCH", "Албан и-мэйлээр local хэрэглэгчийг тулгана."),
  allEmail: target("User.email", "MATCH", "Албан и-мэйлээр local хэрэглэгчийг тулгана."),
  positionName: target("Membership.role", "TRANSFORM", "Албан тушаалыг tenant role-той тулгана."),
  instructorId: target(
    "GroupTeacher.membershipId",
    "MATCH",
    "Багшийн оноолтыг Membership-ээр холбоно.",
  ),
};

const ATTENDANCE: Record<string, Target> = {
  personId: target("Attendance.childId", "MATCH", "ESIS person mapping-ээр Child.id-г олно."),
  dayDate: target("Attendance.date", "DIRECT", "Өдрийн ирцийн огноо."),
  attendanceReasonCode: target(
    "Attendance.status",
    "TRANSFORM",
    "ESIS reason code-г AttendanceStatus руу хөрвүүлнэ.",
  ),
  attendanceReasonName: target(
    "Attendance.status",
    "DISPLAY_ONLY",
    "Reason code-ийн уншигдах нэр.",
  ),
  tardyMinutes: target(
    "Attendance.arrivedAt",
    "TRANSFORM",
    "Хоцролтын минутыг ирсэн цагтай тулгана.",
  ),
};

const ATTENDANCE_REQUEST: Record<string, Target> = {
  institutionId: target(
    "Kindergarten.esisInstitutionId",
    "REQUEST",
    "Request body-д байгууллагын код илгээнэ.",
  ),
  studentGroupId: target(
    "ESIS group mapping",
    "REQUEST",
    "Request body-д ESIS бүлгийн ID илгээнэ.",
  ),
  dayDate: target("Attendance.date", "REQUEST", "Request body-д ISO date илгээнэ."),
  attendanceList: target("Attendance[]", "REQUEST", "Бүлгийн тухайн өдрийн бүх ирцийг жагсаана."),
  personId: target("ESIS child mapping", "REQUEST", "Attendance.childId-с ESIS personId-г шийднэ."),
  attendReasonCode: target(
    "Attendance.status",
    "REQUEST",
    "Local төлвийг ESIS reason code руу хөрвүүлнэ.",
  ),
  tardyMinutes: target("Attendance.arrivedAt", "REQUEST", "Хоцролтын минутыг тооцоолж илгээнэ."),
  attendReasonList: target(
    "Attendance.note",
    "REQUEST",
    "Зөвшөөрөгдсөн нэмэлт шалтгааны кодыг илгээнэ.",
  ),
};

const FOOD: Record<string, Target> = {
  materialId: target(
    "Ingredient external ESIS mapping",
    "NOT_STORED",
    "Food service access батлагдсаны дараа mapping нэмнэ.",
  ),
  materialName: target("Ingredient.name", "MATCH", "Food sync идэвхжсэний дараа нэрээр тулгана."),
  measureCode: target("Ingredient.unit", "TRANSFORM", "ESIS нэгжийг IngredientUnit руу хөрвүүлнэ."),
  productId: target(
    "Recipe external ESIS mapping",
    "NOT_STORED",
    "Food service access батлагдсаны дараа mapping нэмнэ.",
  ),
  productName: target("Recipe.name", "MATCH", "Food sync идэвхжсэний дараа нэрээр тулгана."),
  calories: target(
    "Recipe.nutrition / Ingredient nutrition",
    "DISPLAY_ONLY",
    "Шим тэжээлийн тооцоонд ашиглах боломжтой.",
  ),
  proteins: target(
    "Recipe.nutrition / Ingredient nutrition",
    "DISPLAY_ONLY",
    "Шим тэжээлийн тооцоонд ашиглах боломжтой.",
  ),
  fats: target(
    "Recipe.nutrition / Ingredient nutrition",
    "DISPLAY_ONLY",
    "Шим тэжээлийн тооцоонд ашиглах боломжтой.",
  ),
  carbohydrate: target(
    "Recipe.nutrition / Ingredient nutrition",
    "DISPLAY_ONLY",
    "Шим тэжээлийн тооцоонд ашиглах боломжтой.",
  ),
};

function resourceTargets(key: EsisEndpointKey): Record<string, Target> {
  if (key === "saveAttendanceV3") return ATTENDANCE_REQUEST;
  if (key === "groupAttendance") return ATTENDANCE;
  if (
    key === "students" ||
    key === "studentByRegister" ||
    key === "groupStudents" ||
    key === "studentMovements"
  ) {
    return CHILD;
  }
  if (key === "teachers" || key === "staff") return STAFF;
  if (key.startsWith("food")) return FOOD;
  return {};
}

export function fieldMappings(key: EsisEndpointKey, fields: EsisField[]): EsisFieldMapping[] {
  const specific = resourceTargets(key);
  return fields.map((field) => {
    if (!field.ingested) {
      return {
        sourceField: field.name,
        targetField: "Хадгалахгүй",
        strategy: "REJECTED",
        note: field.omitReason ?? "Мэдээлэл багасгах бодлогоор авахгүй.",
      };
    }

    const mapping = specific[field.name] ?? COMMON[field.name];
    return {
      sourceField: field.name,
      ...(mapping ??
        target(
          "Integration preview only",
          "DISPLAY_ONLY",
          "Response-д бүрэн харуулна; local model-д автоматаар бичихгүй.",
        )),
    };
  });
}
