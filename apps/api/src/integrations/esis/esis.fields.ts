import { ESIS_ENDPOINTS } from "./esis.endpoints";

/**
 * Every field an ESIS v2 service returns, and what NomadKids does with it.
 *
 * ★ Why a field list exists at all. "Show the outputs" is the question an
 * operator asks *before* a token is issued: they cannot run the call, so the
 * only honest answer is the contract — every field name the service returns,
 * the label we show it under, and whether we keep it. A screen that can only
 * say "17 endpoints" proves nothing; a screen that names every field and marks
 * sensitive ones refused proves the catalog was read.
 *
 * ★★ `ingested: false` is the load-bearing half. `ESIS_REQUEST.md` §1.1 chose
 * option (b) — no civil id, no register number — and §1.2 refuses the
 * provider-issued passwords and usernames that person payloads carry. Those
 * fields are still listed, with the reason, because a reviewer
 * comparing this screen against the developer portal must see that we knew
 * about them and declined. Deleting the row would look like an oversight.
 *
 * ★★★ `source` says where the names came from. The selected services were
 * checked against https://developerv2.esis.edu.mn/api/structure on 2026-09-09.
 * `io` keeps the attendance write service honest: its eight fields are request
 * inputs, while every other service exposes response outputs.
 *
 * ★★★★ **`sample` is gone — 2026-09-14**, at the client's instruction: "ene
 * esis ni real zuil shuu … demo ugugdul ntr ywuulj tenegtewee."
 *
 * It carried an invented value per field, added 2026-09-07 so the screens
 * could be *shown* before a token existed. That reasoning was sound and it
 * expired: institution 42778 answers now, so a fabricated value's only
 * remaining effect is to fill a screen that should be reporting a failure.
 * The three rules that used to stand here — samples vanish on a live read,
 * every surface labels them, refused fields get none — were the guard rails
 * around a thing that no longer exists.
 *
 * What stays is this list itself: the field **names**, their labels, and
 * whether we keep them. None of that is invented — it is the published
 * contract, and it is the answer to "what will come back?" that does not
 * require pretending anything already did.
 */
export interface EsisField {
  name: string;
  label: string;
  /** Whether the field is returned by ESIS or sent to it. */
  io: "OUTPUT" | "INPUT";
  /** Whether NomadKids parses and keeps the value. */
  ingested: boolean;
  /** Present only when `ingested` is false — why, and under which document. */
  omitReason?: string;
}

/**
 * `PORTAL` — read from the developer catalog, so the ministry documented these
 * names. `LIVE` — read from a real response, so the ministry sent them; the
 * stronger claim of the two. `ADAPTER` — our schema's own keys, checked against
 * neither.
 */
export type EsisFieldSource = "PORTAL" | "LIVE" | "ADAPTER";

const keep = (name: string, label: string): EsisField => ({
  name,
  label,
  io: "OUTPUT",
  ingested: true,
});

const drop = (name: string, label: string, omitReason: string): EsisField => ({
  name,
  label,
  io: "OUTPUT",
  ingested: false,
  omitReason,
});

const send = (name: string, label: string): EsisField => ({
  name,
  label,
  io: "INPUT",
  ingested: true,
});

const NO_CREDENTIAL = "ESIS_REQUEST.md §1.2 — нэвтрэх мэдээлэл хүсэхгүй";

/*
 * ★ **`NO_CIVIL_ID` and `NO_REG_NUMBER` are gone — 2026-09-15, the client's
 * decision "РД-г тийм, нууц үгийг үгүй" (register numbers yes, passwords no).
 * `civilId`, `personRegNumber` and `registerNumber` move from `drop(…)` to
 * `keep(…)` below: `esisDiscoveredSchema` no longer refuses them, and
 * `ESIS_REQUEST.md` §1.1 (b) is now a decision this project overrode rather
 * than one it still keeps.
 *
 * ★★ Who may **see** one is a separate question — `EsisAdminService.visibleRows`
 * gates it per caller, not this catalogue — see `ESIS_IDENTIFIER_FIELDS` in
 * `esis.schemas.ts`. This file only says what the code now ingests.
 */

/**
 * The child record shared by the two roster services.
 *
 * `students` and `groupStudents` return this wider roster shape. API-000144 is
 * intentionally separate below because its published output omits movement
 * and instructor fields and names its provider-password fields differently.
 */
const STUDENT_FIELDS: EsisField[] = [
  keep("institutionId", "Байгууллагын код"),
  keep("personId", "ESIS хүний дугаар"),
  keep("familyName", "Ургийн овог"),
  keep("lastName", "Овог"),
  keep("firstName", "Нэр"),
  keep("familyNameMgl", "Ургийн овог (монгол бичиг)"),
  keep("lastNameMgl", "Овог (монгол бичиг)"),
  keep("firstNameMgl", "Нэр (монгол бичиг)"),
  keep("dateOfBirth", "Төрсөн огноо"),
  keep("genderCode", "Хүйс"),
  keep("genderName", "Хүйсийн нэр"),
  keep("academicLevel", "Түвшний код"),
  keep("academicLevelName", "Түвшин"),
  keep("studentGroupId", "Бүлгийн код"),
  keep("studentGroupName", "Бүлгийн нэр"),
  keep("programOfStudyId", "Хөтөлбөрийн код"),
  keep("programOfStudyName", "Хөтөлбөр"),
  keep("programPlanId", "Сургалтын төлөвлөгөөний код"),
  keep("programPlanName", "Сургалтын төлөвлөгөө"),
  keep("programStageId", "Үе шатны код"),
  keep("programStageName", "Үе шат"),
  keep("microsoftEmail", "Microsoft албан и-мэйл"),
  keep("googleEmail", "Google албан и-мэйл"),
  keep("actionDate", "Үйлдэл хийсэн огноо"),
  keep("academicYear", "Хичээлийн жил"),
  keep("instructorId", "Багшийн код"),
  keep("instructorName", "Багшийн нэр"),
  keep("programStatus", "Суралцах төлөв"),
  keep("programStatusName", "Суралцах төлөвийн нэр"),
  keep("civilId", "Иргэний бүртгэлийн дугаар"),
  keep("personRegNumber", "Регистрийн дугаар"),
  drop("microsoftPassword", "Microsoft нууц үг", NO_CREDENTIAL),
  drop("googlePassword", "Google нууц үг", NO_CREDENTIAL),
];

/** Exact API-000144 output contract, with the two provider passwords refused. */
const STUDENT_BY_REGISTER_FIELDS: EsisField[] = [
  keep("institutionId", "Байгууллагын код"),
  keep("personId", "ESIS хүний дугаар"),
  keep("civilId", "Иргэний бүртгэлийн дугаар"),
  keep("personRegNumber", "Регистрийн дугаар"),
  keep("familyName", "Ургийн овог"),
  keep("firstName", "Нэр"),
  keep("lastName", "Овог"),
  keep("familyNameMgl", "Ургийн овог (монгол бичиг)"),
  keep("firstNameMgl", "Нэр (монгол бичиг)"),
  keep("lastNameMgl", "Овог (монгол бичиг)"),
  keep("dateOfBirth", "Төрсөн огноо"),
  keep("genderCode", "Хүйсийн код"),
  keep("genderName", "Хүйс"),
  keep("academicLevel", "Түвшний код"),
  keep("academicLevelName", "Түвшин"),
  keep("studentGroupId", "Бүлгийн код"),
  keep("studentGroupName", "Бүлгийн нэр"),
  keep("programOfStudyId", "Хөтөлбөрийн код"),
  keep("programOfStudyName", "Хөтөлбөр"),
  keep("programPlanId", "Сургалтын төлөвлөгөөний код"),
  keep("programPlanName", "Сургалтын төлөвлөгөө"),
  keep("microsoftEmail", "Microsoft албан и-мэйл"),
  drop("microsoftEmailPass", "Microsoft нууц үг", NO_CREDENTIAL),
  keep("googleEmail", "Google албан и-мэйл"),
  drop("googleEmailPass", "Google нууц үг", NO_CREDENTIAL),
  keep("academicYear", "Хичээлийн жил"),
];

/**
 * The name block both person services return.
 *
 * ★ A constant since 2026-09-14, having been a function until then. It took a
 * person — a name, a gender, a birth date — because the teacher and the staff
 * member were different invented people and a shared constant would have put
 * the same name under both. With the samples gone there is no person to pass:
 * what is left is nine field names, and those genuinely are identical between
 * the two services.
 */
const PERSON_NAME_FIELDS: EsisField[] = [
  keep("familyName", "Ургийн овог"),
  keep("lastName", "Овог"),
  keep("firstName", "Нэр"),
  keep("familyNameMgl", "Ургийн овог (монгол бичиг)"),
  keep("firstNameMgl", "Нэр (монгол бичиг)"),
  keep("lastNameMgl", "Овог (монгол бичиг)"),
  keep("genderCode", "Хүйсийн код"),
  keep("genderName", "Хүйс"),
  keep("dateOfBirth", "Төрсөн огноо"),
];

const OFFICIAL_EMAIL_FIELDS: EsisField[] = [
  keep("microsoftEmail", "Microsoft албан и-мэйл"),
  keep("googleEmail", "Google албан и-мэйл"),
  keep("allEmail", "Бүх и-мэйл"),
];

/** Kept, not refused — see the 2026-09-15 note above `NO_CREDENTIAL`. */
const IDENTIFIER_FIELDS: EsisField[] = [
  keep("civilId", "Иргэний бүртгэлийн дугаар"),
  keep("personRegNumber", "Регистрийн дугаар"),
];

const CREDENTIAL_FIELDS: EsisField[] = [
  drop("microsoftEmailPass", "Microsoft нууц үг", NO_CREDENTIAL),
  drop("googleEmailPass", "Google нууц үг", NO_CREDENTIAL),
];

const NUTRITION_FIELDS: EsisField[] = [
  keep("nutrition", "Шимт бодис"),
  keep("calories", "Илчлэг"),
  keep("proteins", "Уураг"),
  keep("fats", "Өөх тос"),
  keep("carbohydrate", "Нүүрс ус"),
];

const ESIS_FIELD_CATALOG: Record<keyof typeof ESIS_ENDPOINTS, EsisField[]> = {
  organization: [
    keep("institutionId", "Байгууллагын код"),
    keep("institutionName", "Байгууллагын нэр"),
    keep("shortName", "Товч нэр"),
    keep("longName", "Бүтэн нэр"),
    keep("legalName", "Хуулийн этгээдийн нэр"),
    keep("legalNameMgl", "Хуулийн этгээдийн нэр (монгол бичиг)"),
    keep("propertyTypeName", "Өмчийн хэлбэр"),
    keep("institutionTypeId", "Байгууллагын төрлийн код"),
    keep("institutionTypeName", "Байгууллагын төрөл"),
    keep("provinceName", "Аймаг, нийслэл"),
    keep("districtName", "Сум, дүүрэг"),
    keep("subDistrictName", "Баг, хороо"),
    keep("regionName", "Бүс"),
    keep("institutionAddress", "Хаяг"),
    keep("institutionClassificationId", "Ангиллын код"),
    keep("institutionClassificationName", "Ангилал"),
  ],
  /* Read name by name off the developer portal on 2026-09-09, labels included. */
  buildings: [
    keep("buildingId", "Барилга байгууламжийн дугаар"),
    keep("buildingName", "Барилга байгууламжийн нэр"),
    keep("createdYear", "Үүсгэсэн он"),
    keep("buildingPurposeCode", "Зориулалтын код"),
    keep("buildingPurposeName", "Барилга байгууламжийн зориулалт"),
    keep("standardFlag", "Стандартын эсэх"),
    keep("buildingPropertyType", "Эзэмшлийн төрлийн код"),
    keep("buildingPropertyTypeName", "Эзэмшлийн төрөл"),
    keep("normalCapacity", "Багтаамж"),
    keep("totalCapacity", "Нийт багтаамж"),
    keep("firstCost", "Анхны үнэ"),
    keep("lastCost", "Эцсийн үнэ"),
    keep("approvalStatusCode", "Баталгаажуулалтын төлөв"),
  ],
  academicYearStatuses: [
    keep("academicYear", "Хичээлийн жил"),
    keep("currentAcademicYearFlag", "Идэвхтэй жил эсэх"),
    keep("openDate", "Нээсэн огноо"),
    keep("closedDate", "Хаасан огноо"),
    keep("academicYearStatus", "Төлөв"),
  ],
  groups: [
    keep("institutionId", "Байгууллагын код"),
    keep("studentGroupId", "Бүлгийн код"),
    keep("studentGroupName", "Бүлгийн нэр"),
    keep("academicLevel", "Түвшний код"),
    keep("academicLevelName", "Түвшин"),
    keep("programOfStudyId", "Хөтөлбөрийн код"),
    keep("programOfStudyName", "Хөтөлбөр"),
    keep("programStageId", "Үе шатны код"),
    keep("programStageName", "Үе шат"),
    keep("programPlanId", "Сургалтын төлөвлөгөөний код"),
    keep("programPlanName", "Сургалтын төлөвлөгөө"),
    keep("groupTypeCode", "Бүлгийн төрлийн код"),
    keep("groupTypeName", "Бүлгийн төрөл"),
    keep("groupShiftId", "Ээлжийн код"),
    keep("groupShiftName", "Ээлж"),
    keep("groupClassificationId", "Ангиллын код"),
    keep("groupClassificationName", "Ангилал"),
    keep("groupCategoryCode", "Ангийн ангиллын код"),
    keep("groupCategoryName", "Ангийн ангилал"),
    keep("academicGroupId", "Хичээлийн бүлгийн код"),
    keep("academicGroupName", "Хичээлийн бүлэг"),
    keep("instructorId", "Багшийн код"),
    keep("instructorName", "Багшийн нэр"),
    keep("academicYear", "Хичээлийн жил"),
  ],
  students: STUDENT_FIELDS,
  studentByRegister: STUDENT_BY_REGISTER_FIELDS,
  studentInfo: STUDENT_FIELDS,
  groupStudents: STUDENT_FIELDS,
  studentMovements: [
    keep("institutionId", "Байгууллагын код"),
    keep("studentProgramId", "Суралцах хөтөлбөрийн код"),
    keep("academicLevel", "Түвшний код"),
    keep("academicLevelName", "Түвшин"),
    keep("studentGroupId", "Бүлгийн код"),
    keep("studentGroupName", "Бүлгийн нэр"),
    keep("programOfStudyId", "Хөтөлбөрийн код"),
    keep("programOfStudyName", "Хөтөлбөр"),
    keep("programPlanId", "Сургалтын төлөвлөгөөний код"),
    keep("programPlanName", "Сургалтын төлөвлөгөө"),
    keep("programStatusCode", "Хөтөлбөрийн төлөвийн код"),
    keep("programStatusName", "Хөтөлбөрийн төлөв"),
    keep("approvalStatusCode", "Баталгаажилтын төлөвийн код"),
    keep("approvalStatusName", "Баталгаажилтын төлөв"),
    keep("personId", "ESIS хүний дугаар"),
    keep("familyName", "Ургийн овог"),
    keep("lastName", "Овог"),
    keep("firstName", "Нэр"),
    keep("dateOfBirth", "Төрсөн огноо"),
    keep("genderCode", "Хүйсийн код"),
    keep("genderName", "Хүйс"),
    keep("actionId", "Үйлдлийн код"),
    keep("actionName", "Үйлдэл"),
    keep("actionDate", "Үйлдлийн огноо"),
  ],
  teachers: [
    keep("institutionId", "Байгууллагын код"),
    keep("assignmentId", "Томилгооны код"),
    keep("personId", "ESIS хүний дугаар"),
    keep("instructorId", "Багшийн код"),
    keep("displayName", "Дэлгэцийн нэр"),
    ...PERSON_NAME_FIELDS,
    keep("positionName", "Албан тушаал"),
    keep("instructorTypeId", "Багшийн төрлийн код"),
    keep("instructorTypeName", "Багшийн төрөл"),
    keep("subjectDepartmentId", "Заах аргын нэгдлийн код"),
    keep("subjectDepartmentName", "Заах аргын нэгдэл"),
    keep("instructorAvailability", "Ажиллах боломж"),
    ...OFFICIAL_EMAIL_FIELDS,
    ...IDENTIFIER_FIELDS,
    ...CREDENTIAL_FIELDS,
    drop("username", "Нэвтрэх нэр", NO_CREDENTIAL),
  ],
  staff: [
    keep("institutionId", "Байгууллагын код"),
    keep("institutionName", "Байгууллагын нэр"),
    keep("parentInstitutionId", "Дээд байгууллагын код"),
    keep("parentInstitutionName", "Дээд байгууллага"),
    keep("assignmentId", "Томилгооны код"),
    keep("personId", "ESIS хүний дугаар"),
    ...PERSON_NAME_FIELDS,
    keep("positionName", "Албан тушаал"),
    keep("positionCode", "Албан тушаалын код"),
    keep("jobCode", "Ажлын байрны код"),
    keep("minor", "Мэргэшил"),
    keep("primaryFlag", "Үндсэн ажлын байр эсэх"),
    keep("educationSectorYears", "Боловсролын салбарт ажилласан жил"),
    keep("yearsOfService", "Нийт ажилласан жил"),
    keep("propertyClassificationCode", "Өмчийн ангиллын код"),
    keep("propertyClassificationName", "Өмчийн ангилал"),
    ...OFFICIAL_EMAIL_FIELDS,
    ...IDENTIFIER_FIELDS,
    ...CREDENTIAL_FIELDS,
  ],
  groupAttendance: [
    keep("academicLevel", "Түвшний код"),
    keep("personId", "ESIS хүний дугаар"),
    keep("dayDate", "Огноо"),
    keep("attendanceReasonCode", "Ирцийн шалтгааны код"),
    keep("attendanceReasonName", "Ирцийн шалтгаан"),
    keep("tardyMinutes", "Хоцорсон минут"),
  ],
  saveAttendanceV3: [
    send("institutionId", "Байгууллагын код"),
    send("studentGroupId", "Бүлгийн код"),
    send("dayDate", "Огноо"),
    send("attendanceList", "Ирцийн жагсаалт"),
    send("personId", "ESIS хүний дугаар"),
    send("attendReasonCode", "Ирцийн шалтгааны код"),
    send("tardyMinutes", "Хоцорсон минут"),
    send("attendReasonList", "Шалтгааны нэмэлт код"),
  ],
  foodProductTypes: [
    keep("productType", "Хоолны төрлийн код"),
    keep("productTypeName", "Хоолны төрөл"),
  ],
  foodMaterialGroups: [
    keep("groupId", "Бүлгийн код"),
    keep("parentGroupId", "Дээд бүлгийн код"),
    keep("orgGroup", "Сургалтын хэлбэр"),
    keep("groupCode", "Бүлгийн товч код"),
    keep("groupName", "Бүлгийн нэр"),
  ],
  foodMaterials: [
    keep("materialId", "Материалын код"),
    keep("groupId", "Бүлгийн код"),
    keep("materialCode", "Материалын товч код"),
    keep("materialName", "Материалын нэр"),
    keep("measureCode", "Хэмжих нэгж"),
    keep("supplierType", "Нийлүүлэгчийн төрөл"),
    ...NUTRITION_FIELDS,
    keep("sequence", "Дараалал"),
  ],
  foodProducts: [
    keep("productId", "Бүтээгдэхүүний код"),
    keep("productCode", "Бүтээгдэхүүний товч код"),
    keep("productName", "Бүтээгдэхүүний нэр"),
    keep("measureCode", "Хэмжих нэгж"),
    keep("productType", "Хоолны төрөл"),
    ...NUTRITION_FIELDS,
    keep("hasRecipeFlag", "Технологийн карттай эсэх"),
    keep("kitFlag", "Иж бүрдэл эсэх"),
    keep("sequence", "Дараалал"),
  ],
  foodProductMaterials: [
    keep("productMaterialId", "Орцын код"),
    keep("productId", "Бүтээгдэхүүний код"),
    keep("groupId", "Бүлгийн код"),
    keep("materialId", "Материалын код"),
    keep("measureCode", "Хэмжих нэгж"),
    keep("grossWeight", "Бохир жин"),
    keep("netWeight", "Цэвэр жин"),
    keep("sequence", "Дараалал"),
  ],
  /*
   * ★ Read name by name off the developer portal on 2026-09-09, labels and
   * all — these two carry Mongolian names in the catalog itself, so the labels
   * below are the ministry's own words rather than a translation of ours.
   */
  livelihoodForm1: [
    keep("orgName", "Байгууллагын нэр"),
    keep("academicYear", "Жил"),
    keep("academicMonth", "Сар"),
    keep("studentCnt", "Сурагчийн тоо"),
    keep("livelihoodCnt", "Хөнгөлөлтөнд хамрагдах сурагчийн тоо"),
    keep("livelihoodBudget", "Төвлөрүүлэх орлогын дүн"),
    keep("livelihoodAmount", "Төвлөрүүлсэн орлогын дүн"),
  ],
  livelihoodForm2: [
    keep("orgName", "Байгууллагын нэр"),
    keep("academicYear", "Жил"),
    keep("academicMonth", "Сар"),
    keep("studentGroupId", "Бүлгийн дугаар"),
    keep("studentGroupName", "Бүлгийн нэр"),
    keep("personId", "Суралцагчийн дугаар"),
    keep("comingDays", "Ирэх өдөр"),
    keep("arrivalDays", "Ирсэн өдөр"),
    keep("amountDue", "Төлөх дүн"),
    keep("amountPaid", "Төлсөн дүн"),
    keep("livelihoodDiscount", "Амьжиргааны хөнгөлөлт"),
  ],
  /**
   * The state's meal-subsidy list — `нэмэлт.md` §3.
   *
   * ★ **`civilId` and `registerNumber` were refused, and this is the service
   * that changed the rule.** They were the only two fields it carries that
   * identify a child *uniquely*: there is no `dateOfBirth` here, so a name
   * shared by two children could never be told apart, and `Child.esisPersonId`
   * is written only where a name and birth date match exactly one child. That
   * was the argument raised against `ESIS_REQUEST.md` §1.1 (b), and on
   * 2026-09-15 the client answered it: register numbers yes, passwords no. Both
   * are `keep(…)` below now — see `ESIS_IDENTIFIER_FIELDS` in
   * `esis.schemas.ts`, which is where *who may see one* is decided, per caller,
   * not in this catalogue.
   *
   * ★★ `isFoodDiscount` arrives as the words "Тийм"/"Үгүй", not a boolean.
   * It is kept verbatim and interpreted once, in `foodDiscountByPerson` —
   * a screen that compares the string itself would break the day ESIS sends
   * "тийм" in lower case.
   */
  foodDiscountStudents: [
    keep("personId", "ESIS хүний дугаар"),
    keep("lastName", "Овог"),
    keep("firstName", "Нэр"),
    keep("isFoodDiscount", "Хоолны хөнгөлөлттэй эсэх"),
    keep("orgName", "Байгууллагын нэр"),
    keep("orgProperty", "Өмчийн хэлбэр"),
    keep("orderNum", "Тушаалын дугаар"),
    keep("civilId", "Иргэний бүртгэлийн дугаар"),
    keep("registerNumber", "Регистрийн дугаар"),
  ],
  foodKit: [
    keep("productId", "Бүтээгдэхүүний код"),
    keep("productType", "Хоолны төрөл"),
    ...NUTRITION_FIELDS,
  ],
  foodKitProducts: [
    keep("productCode", "Бүтээгдэхүүний товч код"),
    keep("productName", "Бүтээгдэхүүний нэр"),
    keep("productType", "Хоолны төрөл"),
    ...NUTRITION_FIELDS,
    keep("orgType", "Байгууллагын төрөл"),
  ],

  /*
   * ══ Added 2026-09-10 ═══════════════════════════════════════════════════
   * Суралцагчийн нэмэлт мэдээлэл, багш, хөтөлбөр, сургалтын орчин.
   *
   * ★ **Every list below is `ADAPTER`, not `PORTAL`** — see `ESIS_FIELD_SOURCE`.
   * For the seven суралцагч services the developer portal does not render
   * their section publicly; for the rest it lists the service but not its
   * output fields. So these names are our parsing schema's, which is exactly
   * what `ADAPTER` means in this file, and the operator screen says so.
   */

  /*
   * ★ Corrected from a live read, 2026-09-14. The nine fields listed here —
   * `statusCode`, `studentGroupName`, `enrollmentDate` and the rest — did not
   * exist: the service answers with a bare `"true"` and a sentence. See
   * `esisStudentCheckSchema`.
   */
  studentCheck: [
    keep("isRegistered", "ЭСИС-д бүртгэлтэй эсэх"),
    keep("message", "ЭСИС-ийн хариу"),
  ],

  /*
   * ★ Corrected from live reads, 2026-09-14, and every field below is one that
   * was actually returned. The previous list — `contactId`, `relationTypeName`,
   * `phoneNumber2`, `occupation`, `workplace`, `liveTogetherFlag` — described a
   * flat guardian row the service has never sent.
   *
   * ★★ One row per entry, tagged by `section`. `relInfo` is the guardian,
   * `rel*` their contact points, `contact*` the **child's own** — the two are
   * different records with different id columns and are not interchangeable.
   *
   * ★★★ Six of the eleven sections (`relAddress`, `relSocial`, `relWeb`,
   * `contactAddress`, `contactSocial`, `contactWeb`) were empty for all 83
   * children, so their fields are unknown and none are invented. They are
   * added when a populated record first appears.
   */
  studentContacts: [
    keep("section", "Мэдээллийн хэсэг"),
    keep("institutionId", "Байгууллагын код"),
    keep("personId", "Хүүхдийн ESIS дугаар"),
    keep("studentContactId", "Асран хамгаалагчийн дугаар"),
    keep("relationshipType", "Хамаарлын код"),
    keep("familyName", "Ургийн овог"),
    keep("lastName", "Овог"),
    keep("firstName", "Нэр"),
    keep("dateOfBirth", "Төрсөн огноо"),
    keep("jobTitle", "Албан тушаал"),
    keep("legalEmployerName", "Ажлын газар"),
    keep("note", "Тэмдэглэл"),
    keep("studentContactPhoneId", "Асран хамгаалагчийн утасны дугаарлалт"),
    keep("studentPhoneId", "Хүүхдийн утасны дугаарлалт"),
    keep("phoneType", "Утасны төрөл"),
    keep("phoneCountryCode", "Улсын код"),
    keep("phoneAreaCode", "Бүсийн код"),
    keep("phoneNumber", "Утас"),
    keep("phoneExtension", "Дотуур дугаар"),
    keep("phoneValidity", "Утасны хүчинтэй байдал"),
    keep("legislationCode", "Хууль зүйн код"),
    keep("studentContactEmailId", "Асран хамгаалагчийн и-мэйл дугаарлалт"),
    keep("studentEmailId", "Хүүхдийн и-мэйл дугаарлалт"),
    keep("emailType", "И-мэйлийн төрөл"),
    keep("emailAddress", "И-мэйл"),
    keep("primaryInLdap", "LDAP-д үндсэн эсэх"),
    keep("primaryFlag", "Үндсэн эсэх"),
  ],

  /*
   * ★ **The third list of invented names found on 2026-09-18**, after 86 and
   * 71. The `contactList` rows carried `relationTypeId`, `occupation`,
   * `workplace`, `liveTogetherFlag` — none of which ESIS uses. Its own **read**
   * half, four entries above, names the same record `relationshipType`,
   * `jobTitle`, `legalEmployerName`, `primaryFlag`.
   *
   * ★★ The probe could not name these itself: 101 answers a bare **500
   * Серверийн алдаа** to any body without a `personId` — an unhandled
   * exception rather than a refusal, so it never reaches the field validation
   * that would list them. With `{ institutionId, personId }` it settles to
   * "Алдаа гарлаа", which also names nothing. So the read is the source, and
   * it is a better one than a guess: it met live rows.
   */
  studentContactsSave: [
    send("institutionId", "Байгууллагын код"),
    send("personId", "Хүүхдийн ESIS дугаар"),
    send("contactList", "Асран хамгаалагчийн жагсаалт"),
    send("contactList[].studentContactId", "Засах бичлэгийн дугаар"),
    send("contactList[].relationshipType", "Хамаарлын код"),
    send("contactList[].familyName", "Ургийн овог"),
    send("contactList[].lastName", "Овог"),
    send("contactList[].firstName", "Нэр"),
    send("contactList[].dateOfBirth", "Төрсөн огноо"),
    send("contactList[].jobTitle", "Албан тушаал"),
    send("contactList[].legalEmployerName", "Ажлын газар"),
    send("contactList[].phoneNumber", "Утас"),
    send("contactList[].emailAddress", "И-мэйл"),
    send("contactList[].note", "Тэмдэглэл"),
    send("contactList[].primaryFlag", "Үндсэн эсэх"),
  ],

  /*
   * ★ Corrected from a live read, 2026-09-14. All thirteen fields that stood
   * here were invented, and the labels were the worst part of it: "Малчин өрх
   * эсэх" beside `infoFlag1` is a guess presented to a director as a fact about
   * a family.
   *
   * ★★ **The labels below say what is known, which is the position.** ESIS
   * publishes no legend for `infoFlag1`–`infoFlag13`, so each is named by its
   * own key and nothing more. A screen showing "Тэмдэглэгээ 9: Тийм" is
   * uninformative; a screen showing "Малчин өрх: Тийм" against the same value
   * is wrong, and only one of those can be corrected later by someone who
   * notices. See the `studentStatistics` reader in `esis.service.ts` — its
   * hand-written schema was deleted 2026-09-15; it now reads `esisDiscoveredSchema`.
   */
  studentStatistics: [
    keep("studentStatisticsId", "Бүртгэлийн дугаар"),
    keep("institutionId", "Байгууллагын код"),
    keep("personId", "Хүүхдийн ESIS дугаар"),
    keep("infoFlag1", "Тэмдэглэгээ 1"),
    keep("infoFlag2", "Тэмдэглэгээ 2"),
    keep("infoFlag3", "Тэмдэглэгээ 3"),
    keep("infoFlag4", "Тэмдэглэгээ 4"),
    keep("infoFlag5", "Тэмдэглэгээ 5"),
    keep("infoFlag6", "Тэмдэглэгээ 6"),
    keep("infoFlag7", "Тэмдэглэгээ 7"),
    keep("infoFlag8", "Тэмдэглэгээ 8"),
    keep("infoFlag9", "Тэмдэглэгээ 9"),
    keep("infoFlag10", "Тэмдэглэгээ 10"),
    keep("infoFlag11", "Тэмдэглэгээ 11"),
    keep("infoFlag12", "Тэмдэглэгээ 12"),
    keep("infoFlag13", "Тэмдэглэгээ 13"),
    keep("infoText4", "Тэмдэглэл 4"),
    keep("infoText5", "Тэмдэглэл 5"),
    keep("infoText6", "Тэмдэглэл 6"),
    keep("infoNumber5", "Тоон утга 5"),
    keep("infoNumber6", "Тоон утга 6"),
  ],

  /*
   * ★ **Every name here was invented, and the service said so** — 2026-09-18.
   * A body of `{ institutionId }` answered:
   *
   *     infoFlag9 утгыг шалгана уу!('Y' эсвэл 'N' байна.)
   *
   * The eleven fields that stood here — `familyMemberCount`, `familyTypeId`,
   * `socialWelfareFlag` and the rest — are this product's guesses at what a
   * household survey ought to contain. ESIS keeps the same record as
   * `infoFlag1..13`, `infoText4..6` and `infoNumber5..6`, which is exactly what
   * the **read** half (`studentStatistics`, above) has always declared: the two
   * halves of one service disagreed, and only the read had met a live row.
   *
   * ★★ This is the same defect `studentCondition` had until 2026-09-14, when a
   * live read corrected fifteen invented names — and the save beside it was
   * left alone that day. A write's field list is harder to catch precisely
   * because nothing renders it.
   *
   * ★★★ The read is the source now. `infoFlag9`'s refusal proves the naming and
   * the `'Y'/'N'` domain; the rest follow it, because a service that reads back
   * `infoFlag9` and writes something else would be two different records.
   * Flags carry `'Y'`/`'N'`, not booleans.
   */
  studentStatisticsSave: [
    send("institutionId", "Байгууллагын код"),
    send("personId", "Хүүхдийн ESIS дугаар"),
    send("infoFlag1", "Тэмдэглэгээ 1 ('Y'/'N')"),
    send("infoFlag2", "Тэмдэглэгээ 2 ('Y'/'N')"),
    send("infoFlag3", "Тэмдэглэгээ 3 ('Y'/'N')"),
    send("infoFlag4", "Тэмдэглэгээ 4 ('Y'/'N')"),
    send("infoFlag5", "Тэмдэглэгээ 5 ('Y'/'N')"),
    send("infoFlag6", "Тэмдэглэгээ 6 ('Y'/'N')"),
    send("infoFlag7", "Тэмдэглэгээ 7 ('Y'/'N')"),
    send("infoFlag8", "Тэмдэглэгээ 8 ('Y'/'N')"),
    send("infoFlag9", "Тэмдэглэгээ 9 ('Y'/'N')"),
    send("infoFlag10", "Тэмдэглэгээ 10 ('Y'/'N')"),
    send("infoFlag11", "Тэмдэглэгээ 11 ('Y'/'N')"),
    send("infoFlag12", "Тэмдэглэгээ 12 ('Y'/'N')"),
    send("infoFlag13", "Тэмдэглэгээ 13 ('Y'/'N')"),
    send("infoText4", "Тэмдэглэл 4"),
    send("infoText5", "Тэмдэглэл 5"),
    send("infoText6", "Тэмдэглэл 6"),
    send("infoNumber5", "Тоон утга 5"),
    send("infoNumber6", "Тоон утга 6"),
  ],

  /*
   * ★ Corrected from a live read, 2026-09-14. All fifteen fields that stood
   * here were invented — the service is not the dwelling survey they described.
   *
   * ★★ `annualTuitionFee` is shown, under a label that says whose number it is.
   * It was briefly refused here on the argument that this kindergarten's
   * tuition lives in `FundingRule` and `Invoice`, and that two answers to "what
   * does this cost?" on one screen is one too many. That argument is about the
   * *child's finance tab*, which is where a family acts on a number. This panel
   * is the ESIS record, every row of it labelled as ESIS's, and hiding a field
   * the ministry holds about a child makes the panel a worse answer to the only
   * question it exists to answer.
   */
  studentCondition: [
    keep("studentStatisticId", "Бүртгэлийн дугаар"),
    keep("institutionId", "Байгууллагын код"),
    keep("personId", "Хүүхдийн ESIS дугаар"),
    keep("academicYear", "Хичээлийн жил"),
    keep("studentLivingPalace", "Амьдарч буй байрны код"),
    keep("livingPlaceDistance", "Цэцэрлэг хүртэлх зай"),
    keep("enrollYear", "Элссэн огноо"),
    keep("dormitoryPropertyType", "Дотуур байрны өмчийн хэлбэр"),
    keep("dormitoryOwner", "Дотуур байрны эзэмшигч"),
    keep("dormitorySchoolId", "Дотуур байртай сургуулийн код"),
    keep("dormitoryId", "Дотуур байрны код"),
    keep("annualTuitionFee", "Жилийн сургалтын төлбөр (ЭСИС-ийн дүн)"),
  ],

  /*
   * ★ **The other half of the 2026-09-14 correction, finally made.** That day a
   * live read replaced fifteen invented names on `studentCondition` above — and
   * this save, which describes the same record, kept its own eight inventions
   * (`dwellingTypeId`, `heatingTypeId`, `waterSourceId`…). The note above still
   * says "the service is not the dwelling survey they described"; this list was
   * that survey, left standing.
   *
   * ★★ Mirrors the read, minus the fields ESIS assigns itself
   * (`studentStatisticId`) and the ones it derives. `studentLivingPalace` and
   * `livingPlaceDistance` are what "amьдрах орчин" actually means here.
   *
   * ★★★ Unconfirmed in one respect and it is said rather than hidden: probing
   * with `{ institutionId }` answered a bare "Алдаа гарлаа" with no field
   * named, so unlike `studentStatisticsSave` there is no refusal pinning these.
   * They follow the read, which met a live row — inference, but inference from
   * the ministry's own document rather than from what a survey ought to hold.
   */
  studentConditionSave: [
    send("institutionId", "Байгууллагын код"),
    send("personId", "Хүүхдийн ESIS дугаар"),
    send("academicYear", "Хичээлийн жил"),
    send("studentLivingPalace", "Амьдарч буй байрны код"),
    send("livingPlaceDistance", "Цэцэрлэг хүртэлх зай"),
    send("enrollYear", "Элссэн огноо"),
    send("dormitoryPropertyType", "Дотуур байрны өмчийн хэлбэр"),
    send("dormitoryOwner", "Дотуур байрны эзэмшигч"),
    send("dormitorySchoolId", "Дотуур байртай сургуулийн код"),
    send("dormitoryId", "Дотуур байрны код"),
    send("annualTuitionFee", "Жилийн сургалтын төлбөр"),
  ],

  /*
   * ★ Corrected from a live read, 2026-09-14. Seven of these nine were
   * invented, and because all seven were nullable the row parsed and the four
   * real values were thrown away — the panel drew empty columns and looked like
   * an institution with no academic units.
   */
  teacherAcademicOrg: [
    keep("institutionId", "Байгууллагын код"),
    keep("personId", "Багшийн ESIS дугаар"),
    keep("jobCode", "Албан тушаалын код"),
    keep("jobName", "Албан тушаал"),
    keep("subjectDepartmentId", "Заах аргын нэгдлийн код"),
    keep("subjectDepartmentName", "Заах аргын нэгдэл"),
  ],

  /*
   * ★ Corrected from a live read, 2026-09-14: the movement is `actionId` /
   * `actionName` / `actionDate`, not `movementType*` with a date range and an
   * order number.
   *
   * ★★ On institution 42778 every `action*` came back null while the names and
   * assignment ids were populated. The service answers "who holds an
   * assignment" more reliably than "what changed", and the screen should not
   * promise an appointment history it may not get.
   */
  teacherMovements: [
    keep("institutionId", "Байгууллагын код"),
    keep("personId", "Багшийн ESIS дугаар"),
    keep("assignmentId", "Томилгооны дугаар"),
    keep("assignmentName", "Томилгооны нэр"),
    keep("displayName", "Харагдах нэр"),
    keep("instructorId", "Багшийн дугаар"),
    keep("instructorTypeId", "Багшийн төрлийн код"),
    keep("typeName", "Багшийн төрөл"),
    keep("subjectDepartmentId", "Заах аргын нэгдлийн код"),
    keep("subjectDepartmentName", "Заах аргын нэгдэл"),
    keep("instructorAvailability", "Ажиллах төлөв"),
    keep("actionId", "Үйлдлийн код"),
    keep("actionName", "Үйлдэл"),
    keep("actionDate", "Үйлдлийн огноо"),
    keep("familyName", "Ургийн овог"),
    keep("lastName", "Овог"),
    keep("firstName", "Нэр"),
    keep("familyNameMgl", "Ургийн овог (монгол бичиг)"),
    keep("firstNameMgl", "Нэр (монгол бичиг)"),
    keep("lastNameMgl", "Овог (монгол бичиг)"),
    keep("genderCode", "Хүйс"),
    keep("genderName", "Хүйсийн нэр"),
    keep("dateOfBirth", "Төрсөн огноо"),
  ],

  /*
   * ── Бүлгийн бичих гурав, spec №3б ──────────────────────────────────────
   *
   * ★ **The anchor and nothing else**, the same shape the six `203` health
   * reads above take and for the same reason: the contract has not been seen.
   * The developer portal does not document these three and the ministry's
   * export carries only id, method and URL, so the rest of each body is read
   * off the service's own `400` — the way `studentContacts`'s `{ personId }`
   * was, 2026-09-14 — rather than invented here.
   *
   * ★★ `institutionId` is the anchor rather than a guess. Every
   * institution-scoped service in this catalogue takes it, and
   * `EsisAdminService.write` already puts it into every body it sends without
   * asking the caller. It is the one field these three cannot fail to want.
   *
   * ★★★ This array is what a panel **renders**, so a guessed name here is a
   * wrong label in front of a director, which reads as fact.
   * `esis-group-writes.ts` carries the draft names the payload builder needs
   * and marks them unverified in the same words; the probe corrects both at
   * once.
   */
  groupCreate: [send("institutionId", "Байгууллагын код")],
  groupUpdate: [send("institutionId", "Байгууллагын код")],
  groupInstructor: [send("institutionId", "Байгууллагын код")],

  groupsNextYear: [
    keep("institutionId", "Байгууллагын код"),
    // Наран бүлэг's own id, so this row *is* the first demo record — the
    // catalog sample and `OVERRIDES[0]` are asserted equal.
    keep("studentGroupId", "Бүлгийн код"),
    keep("studentGroupName", "Бүлгийн нэр"),
    keep("academicYear", "Хичээлийн жил"),
    keep("academicLevel", "Түвшний код"),
    keep("academicLevelName", "Түвшин"),
    keep("programOfStudyId", "Хөтөлбөрийн код"),
    keep("programOfStudyName", "Хөтөлбөр"),
    keep("studentCount", "Хүүхдийн тоо"),
  ],

  /*
   * ★ Corrected from a live read, 2026-09-14. `programClassficationName` is
   * spelled that way by the ministry and is copied verbatim — a key corrected
   * on our side is a key that no longer matches the payload.
   */
  programs: [
    keep("institutionId", "Байгууллагын код"),
    keep("programOfStudyId", "Хөтөлбөрийн код"),
    keep("programOfStudyName", "Хөтөлбөр"),
    keep("programClassificationId", "Хөтөлбөрийн ангиллын код"),
    keep("programClassficationName", "Хөтөлбөрийн ангилал"),
    keep("educationLevelCode", "Боловсролын түвшний код"),
    keep("educationLevelName", "Боловсролын түвшин"),
  ],

  programStages: [
    keep("programOfStudyId", "Хөтөлбөрийн код"),
    keep("programStageId", "Үе шатны код"),
    keep("programStageName", "Үе шат"),
    keep("sequence", "Дараалал"),
    keep("academicLevel", "Түвшний код"),
    keep("academicLevelName", "Түвшин"),
  ],

  programPlans: [
    keep("programOfStudyId", "Хөтөлбөрийн код"),
    keep("programStageId", "Үе шатны код"),
    keep("programPlanId", "Төлөвлөгөөний код"),
    keep("programPlanName", "Сургалтын төлөвлөгөө"),
    keep("academicYear", "Хичээлийн жил"),
    keep("activeFlag", "Идэвхтэй эсэх"),
  ],

  programCourses: [
    keep("programOfStudyId", "Хөтөлбөрийн код"),
    keep("programStageId", "Үе шатны код"),
    keep("programPlanId", "Төлөвлөгөөний код"),
    keep("courseId", "Хичээлийн код"),
    keep("courseName", "Хичээл"),
    keep("courseCode", "Хичээлийн товч код"),
    keep("subjectAreaId", "Судлагдахууны код"),
    keep("subjectAreaName", "Судлагдахуун"),
    keep("credit", "Кредит"),
    keep("hours", "Цаг"),
  ],

  /*
   * ★ Corrected from a live read, 2026-09-14 — and this is the list whose
   * `roomId` was **required** by the schema while ESIS sends `facilityId`, so
   * the whole service answered `invalid_response` on a preview that was working
   * perfectly on the ministry's side.
   *
   * ★★ The dimensions are three separate metres, not one `area`. Nothing
   * multiplies them: a floor area ESIS did not state is a number we would be
   * making up, and a room's usable area is not width × length anyway.
   */
  rooms: [
    keep("facilityId", "Өрөөний код"),
    keep("institutionId", "Байгууллагын код"),
    keep("buildingId", "Барилгын код"),
    keep("buildingPurposeCode", "Барилгын зориулалтын код"),
    keep("facilityTypeId", "Өрөөний төрлийн код"),
    keep("classRoomType", "Танхимын төрөл"),
    keep("roomName", "Өрөөний нэр"),
    keep("roomNumber", "Өрөөний дугаар"),
    keep("description", "Тайлбар"),
    keep("floorNumber", "Давхар"),
    keep("roomCapacity", "Багтаамж"),
    keep("roomWidth", "Өргөн (м)"),
    keep("roomLength", "Урт (м)"),
    keep("roomHeight", "Өндөр (м)"),
  ],

  /*
   * ★ The second list whose required id was wrong — `academicOrgId` against
   * ESIS's `subjectDepartmentId`. It is the same pair `teacherAcademicOrg`
   * returns, which is what makes a teacher joinable to a unit; the invented id
   * could never have joined to anything. Live, 2026-09-14.
   */
  academicOrg: [
    keep("institutionId", "Байгууллагын код"),
    keep("subjectDepartmentId", "Нэгжийн код"),
    keep("subjectDepartmentName", "Заах аргын нэгдэл"),
    keep("shortName", "Товч нэр"),
    keep("institutionTypeId", "Нэгжийн төрлийн код"),
    keep("institutionTypeName", "Нэгжийн төрөл"),
    keep("parentGroupId", "Харьяалах байгууллагын код"),
    keep("parentGroupName", "Харьяалах байгууллага"),
    keep("managerId", "Хариуцагчийн код"),
    keep("managerName", "Хариуцагч"),
  ],

  /*
   * ★ Live, 2026-09-14. Three invented fields out; the name in the traditional
   * Mongolian script in — the same pair the roster services carry for people.
   */
  subjectAreas: [
    keep("subjectAreaId", "Судлагдахууны код"),
    keep("subjectAreaName", "Судлагдахуун"),
    keep("subjectAreaNameMgl", "Судлагдахуун (монгол бичиг)"),
  ],

  /*
   * ══ Эрүүл мэнд, вакцин, хэмжилт, эрт илрүүлэг, багш — 2026-09-14 ═══════
   *
   * ★ Five of the health reads have **no declared fields at all**, and that is
   * the point of them. `studentAllergy`, `studentProhibitedFood`,
   * `studentDisability`, `studentSurgery`, `studentIncident` — and
   * `studentScreening` — answered `203` for every child on institution 42778,
   * so their columns are read off the first real response instead of invented
   * here. `personId` is the one anchor: it is what attaches a row to a child,
   * and it is the only field a per-child service cannot fail to return.
   *
   * See `ESIS_DISCOVERED_SHAPE` and `esisFieldsFor`.
   */

  studentAllergy: [keep("personId", "Хүүхдийн ESIS дугаар")],
  studentProhibitedFood: [keep("personId", "Хүүхдийн ESIS дугаар")],
  studentDisability: [keep("personId", "Хүүхдийн ESIS дугаар")],
  studentSurgery: [keep("personId", "Хүүхдийн ESIS дугаар")],
  studentIncident: [keep("personId", "Хүүхдийн ESIS дугаар")],
  studentScreening: [keep("personId", "Хүүхдийн ESIS дугаар")],

  /* The two health reads that did answer, so these names are the ministry's. */
  studentAssessments: [
    keep("studentAssessmentId", "Үзлэгийн дугаар"),
    keep("institutionId", "Байгууллагын код"),
    keep("personId", "Хүүхдийн ESIS дугаар"),
    keep("consultationType", "Үзлэгийн төрлийн код"),
    keep("consultationSubtype", "Үзлэгийн дэд төрөл"),
    keep("consultationDate", "Үзлэг хийсэн огноо"),
    keep("nextConsultationDate", "Дараагийн үзлэгийн огноо"),
    keep("examinerOrganization", "Үзлэг хийсэн байгууллага"),
    keep("examinerPerson", "Үзлэг хийсэн эмч"),
    keep("consultationResult", "Үзлэгийн дүгнэлтийн код"),
    keep("consultationResultDetail", "Дүгнэлтийн дэлгэрэнгүй"),
    keep("treatmentFlag", "Эмчилгээ хийлгэсэн эсэх"),
    keep("treatmentDetails", "Эмчилгээний дэлгэрэнгүй"),
    keep("description", "Тайлбар"),
    keep("descriptionUrl", "Тайлбарын холбоос"),
    keep("studentAssessAttachmentId", "Хавсралтын дугаар"),
    keep("attachmentName", "Хавсралтын нэр"),
    keep("attachmentUrl", "Хавсралтын холбоос"),
    keep("fileType", "Файлын төрөл"),
    keep("fileSize", "Файлын хэмжээ"),
  ],
  studentMeasurements: [
    keep("studentMeasurementId", "Хэмжилтийн дугаар"),
    keep("institutionId", "Байгууллагын код"),
    keep("personId", "Хүүхдийн ESIS дугаар"),
    keep("academicYear", "Хичээлийн жил"),
    keep("measurementDate", "Хэмжсэн огноо"),
    keep("height", "Өндөр (см)"),
    keep("weight", "Жин (кг)"),
    keep("weightIndex", "Жингийн индекс"),
  ],

  /* ── Вакцин ─────────────────────────────────────────────────────────── */
  vaccineCatalog: [
    keep("VACCINE_NAME", "Вакцины нэр"),
    keep("VACCINE_DOSE", "Тун"),
  ],
  vaccineHistory: [
    keep("PERSON_ID", "Хүүхдийн ESIS дугаар"),
    keep("VACCINE_NAME", "Вакцины нэр"),
    keep("VACCINE_GROUP_TYPE", "Вакцины бүлэг"),
    keep("VACCINE_DOSE", "Тун"),
    keep("APPROVED_DATE", "Хийлгэсэн огноо"),
    keep("HOSPITAL_NAME", "Эмнэлэг"),
    keep("SERIAL_NUMBER", "Цуврал дугаар"),
    keep("STATUS", "Төлөв"),
    keep("OBJECT_VERSION_NUMBER", "Хувилбарын дугаар"),
    keep("CREATED_BY", "Бүртгэсэн"),
    keep("CREATION_DATE", "Бүртгэсэн огноо"),
    keep("LAST_UPDATED_BY", "Сүүлд зассан"),
    keep("LAST_UPDATE_DATE", "Сүүлд зассан огноо"),
  ],
  vaccinePlan: [
    keep("PERSON_ID", "Хүүхдийн ESIS дугаар"),
    keep("VACCINE_NAME", "Вакцины нэр"),
    keep("VACCINE_GROUP_NAME", "Вакцины бүлэг"),
    keep("VACCINE_GROUP_TYPE_NAME", "Бүлгийн төрөл"),
    keep("VACCINE_GROUP_TYPE_NAME_ENG", "Бүлгийн төрөл (англи)"),
    keep("STEP_AGE", "Товлолын нас"),
    keep("STEP_NAME", "Товлолын тун"),
    keep("STEP_NAME_ENG", "Товлолын тун (англи)"),
    keep("PLAN_DATE", "Товлосон огноо"),
    keep("PLAN_HOSPITAL_NAME", "Товлосон эмнэлэг"),
    keep("PLAN_OFFICE_NAME", "Товлосон тасаг"),
    keep("SUB_OFFICE_NAME", "Дэд тасаг"),
    keep("STATUS", "Төлөв"),
    keep("OBJECT_VERSION_NUMBER", "Хувилбарын дугаар"),
    keep("CREATED_BY", "Бүртгэсэн"),
    keep("CREATION_DATE", "Бүртгэсэн огноо"),
    keep("LAST_UPDATED_BY", "Сүүлд зассан"),
    keep("LAST_UPDATE_DATE", "Сүүлд зассан огноо"),
    /*
     * ★ A guardian's telephone number, arriving from an immunisation service.
     * The guardian block on a child's record is fed by `studentContacts`, and
     * a second source for the same fact is how two screens come to disagree
     * about how to reach a family.
     */
    drop(
      "PHONE_NO",
      "Холбоо барих утас",
      "ESIS_REQUEST.md §1.1 — асран хамгаалагчийн утсыг studentContacts-аас авна, " +
        "нэг баримтад хоёр эх сурвалж хэрэггүй",
    ),
  ],

  /* ── Бүлгийн хэмжилт ────────────────────────────────────────────────── */
  groupMeasurements: [
    keep("institutionId", "Байгууллагын код"),
    keep("studentGroupId", "Бүлгийн код"),
    keep("personId", "Хүүхдийн ESIS дугаар"),
    keep("measurementDate", "Хэмжсэн огноо"),
    keep("measurementFlag", "Хэмжсэн эсэх"),
    keep("reason", "Хэмжээгүй шалтгаан"),
    keep("height", "Өндөр (см)"),
    keep("weight", "Жин (кг)"),
    keep("waist", "Бэлхүүс (см)"),
    keep("hips", "Ташаа (см)"),
  ],

  /* ── Эрт илрүүлэг ───────────────────────────────────────────────────── */
  screeningQuestions: [
    keep("surveyNameId", "Асуултын код"),
    keep("surveyName", "Асуулт"),
  ],

  /* ── Ирцийн өдрийн нэгдсэн дүн ──────────────────────────────────────── */
  schoolAttendance: [
    keep("dayDate", "Огноо"),
    keep("studentGroupId", "Бүлгийн код"),
    keep("studentGroupName", "Бүлэг"),
    keep("programStageId", "Үе шатны код"),
    keep("academicLevel", "Түвшний код"),
    keep("instructorId", "Багшийн код"),
    keep("displayName", "Багш"),
    keep("status", "Бүртгэлийн төлөв"),
    keep("allStu", "Нийт хүүхэд"),
    keep("reasonPresent", "Ирсэн"),
    keep("reasonSick", "Өвчтэй"),
    keep("reasonExcused", "Чөлөөтэй"),
    keep("reasonUnexcused", "Тасалсан"),
    keep("reasonOnline", "Цахим"),
    keep("tardyMinuteSum", "Хоцорсон нийт минут"),
  ],

  /* ── Багш, ажилтныг бүртгэх ─────────────────────────────────────────── */
  workerInfo: [
    keep("userRole", "Хэрэглэгчийн төрөл"),
    keep("personId", "ESIS хүний дугаар"),
    keep("lastName", "Овог"),
    keep("firstName", "Нэр"),
    keep("familyName", "Ургийн овог"),
    keep("institutionId", "Байгууллагын код"),
    keep("institutionName", "Байгууллага"),
    keep("employeeId", "Ажилтны дугаар"),
    keep("instructorId", "Багшийн код"),
    keep("jobCode", "Албан тушаалын код"),
    keep("jobName", "Албан тушаал"),
    keep("studentGroupId", "Бүлгийн код"),
    keep("studentGroupName", "Бүлэг"),
    keep("programStageId", "Үе шатны код"),
    keep("academicLevel", "Түвшний код"),
    keep("academicYear", "Хичээлийн жил"),
    keep("civilId", "Иргэний бүртгэлийн дугаар"),
    keep("personRegNumber", "Регистрийн дугаар"),
  ],
  teacherProfile: [
    keep("assignmentId", "Томилгооны дугаар"),
    keep("personId", "Багшийн ESIS дугаар"),
    keep("institutionId", "Байгууллагын код"),
    keep("jobCode", "Албан тушаалын код"),
    keep("jobName", "Албан тушаал"),
    keep("positionId", "Орон тооны код"),
    keep("positionName", "Орон тоо"),
    keep("instructorTypeName", "Багшийн төрөл"),
    keep("subjectDepartmentId", "Заах аргын нэгдлийн код"),
    keep("subjectDepartmentName", "Заах аргын нэгдэл"),
    keep("totalWorkYears", "Нийт ажилласан жил"),
    keep("educationSectorYears", "Боловсролын салбарт ажилласан жил"),
    keep("professionalExperience", "Мэргэжлээрээ ажилласан жил"),
    keep("yearOfService", "Албан хаасан жил"),
    keep("publicServiceYears", "Төрийн албан жил"),
    keep("civilServiceYears", "Иргэний албан жил"),
    keep("higherEducationYears", "Дээд боловсролын жил"),
    keep("microsoftEmail", "Microsoft албан и-мэйл"),
    keep("googleEmail", "Google албан и-мэйл"),
    keep("allEmail", "Бүх албан и-мэйл"),
    drop("microsoftPassword", "Microsoft нууц үг", NO_CREDENTIAL),
    drop("googlePassword", "Google нууц үг", NO_CREDENTIAL),
  ],
  teacherCheck: [
    keep("isRegistered", "Энэ байгууллагын багш эсэх"),
    keep("message", "ЭСИС-ийн хариу"),
  ],

  /*
   * ── Closed 2026-09-17, plan `2026-09-16-esis-sync-tiers.md` Task 9 ──────
   * `studentAwards` answered `203` for a real child on institution 42778 —
   * anchor only, like the six health reads above. See `ESIS_DISCOVERED_SHAPE`.
   */
  studentAwards: [keep("personId", "Хүүхдийн ESIS дугаар")],
  /*
   * ★ `studentSearch` answered `200` live, 2026-09-17, and the row was
   * field-for-field API-000144's own shape — `STUDENT_BY_REGISTER_FIELDS`,
   * reused rather than retyped.
   */
  studentSearch: STUDENT_BY_REGISTER_FIELDS,
  /*
   * ★ `buildingByRegisterNumber` answered `203` for a made-up register
   * number — the route is real (see the endpoint's note) but no record has
   * been seen, so only the value the operator supplied is declared.
   */
  buildingByRegisterNumber: [keep("registerNumber", "Улсын бүртгэлийн дугаар")],

  /*
   * ══ Бичих сервисүүд ═══════════════════════════════════════════════════
   * ★ These are **inputs**, not outputs — `io: "INPUT"`, so the operator
   * screen labels them as what we send rather than what comes back.
   *
   * ★★ **What "unproven" now means here, after 2026-09-18.** All thirteen were
   * probed with an empty body (`scripts/esis-write-probe.ts`), and they fall
   * into three groups:
   *
   *  1. **Corrected from a refusal or from their own read** — 86, 71 and 101.
   *     Every field name on those three was this product's invention; the
   *     services keep the same records as `infoFlag1..13`, as the condition
   *     read's own columns, and as `relationshipType` / `jobTitle` /
   *     `legalEmployerName`. They are fixed, and each says so above itself.
   *
   *  2. **Matching a read that has met live rows** — `studentAssessmentsSave`,
   *     `studentMeasurementSave`, `groupMeasurementsSave`. Their read halves
   *     carry real columns and the write lists agree with them field for
   *     field. That is the strongest evidence available short of a POST.
   *
   *  3. **Still unverifiable, and it is the ministry's silence rather than
   *     ours** — allergy, prohibited food, disability, surgery, incident,
   *     screening. Their read halves answered `203` for every child on
   *     institution 42778, so there is no live row to compare against; the
   *     portal does not render them; and the probe cannot reach their field
   *     validation, because each one answers `institutionId дутуу байна` and
   *     then `NJS-105: value is not a number (NaN)` — an Oracle driver error
   *     from a missing `personId`, not a list of what it wanted.
   *
   * ★★★ Group 3 must not be treated as done. Sending one means finding out on
   * a child's medical record what 162 found out on a group.
   */
  studentAllergySave: [
    send("institutionId", "Байгууллагын код"),
    send("personId", "Хүүхдийн ESIS дугаар"),
    send("studentAllergyId", "Засах бичлэгийн дугаар"),
    send("allergyName", "Харшлын нэр"),
    send("description", "Тайлбар"),
  ],
  studentProhibitedFoodSave: [
    send("institutionId", "Байгууллагын код"),
    send("personId", "Хүүхдийн ESIS дугаар"),
    send("studentProhibitId", "Засах бичлэгийн дугаар"),
    send("prohibitName", "Хориотой хүнсний нэр"),
    send("description", "Тайлбар"),
  ],
  studentDisabilitySave: [
    send("institutionId", "Байгууллагын код"),
    send("personId", "Хүүхдийн ESIS дугаар"),
    send("studentDisabilityId", "Засах бичлэгийн дугаар"),
    send("disabilityType", "Хөгжлийн бэрхшээлийн төрөл"),
    send("description", "Тайлбар"),
  ],
  studentSurgerySave: [
    send("institutionId", "Байгууллагын код"),
    send("personId", "Хүүхдийн ESIS дугаар"),
    send("studentSurgeryId", "Засах бичлэгийн дугаар"),
    send("surgeryName", "Мэс заслын нэр"),
    send("surgeryDate", "Мэс засал хийсэн огноо"),
    send("description", "Тайлбар"),
  ],
  studentIncidentSave: [
    send("institutionId", "Байгууллагын код"),
    send("personId", "Хүүхдийн ESIS дугаар"),
    send("studentIncidentId", "Засах бичлэгийн дугаар"),
    send("incidentName", "Осол гэмтлийн нэр"),
    send("incidentDate", "Болсон огноо"),
    send("description", "Тайлбар"),
  ],
  studentAssessmentsSave: [
    send("institutionId", "Байгууллагын код"),
    send("personId", "Хүүхдийн ESIS дугаар"),
    send("studentAssessmentId", "Засах бичлэгийн дугаар"),
    send("consultationType", "Үзлэгийн төрлийн код"),
    send("consultationSubtype", "Үзлэгийн дэд төрөл"),
    send("consultationDate", "Үзлэг хийсэн огноо"),
    send("nextConsultationDate", "Дараагийн үзлэгийн огноо"),
    send("examinerOrganization", "Үзлэг хийсэн байгууллага"),
    send("examinerPerson", "Үзлэг хийсэн эмч"),
    send("consultationResult", "Үзлэгийн дүгнэлтийн код"),
    send("consultationResultDetail", "Дүгнэлтийн дэлгэрэнгүй"),
    send("treatmentFlag", "Эмчилгээ хийлгэсэн эсэх"),
    send("treatmentDetails", "Эмчилгээний дэлгэрэнгүй"),
    send("description", "Тайлбар"),
  ],
  studentMeasurementSave: [
    send("institutionId", "Байгууллагын код"),
    send("personId", "Хүүхдийн ESIS дугаар"),
    send("studentMeasurementId", "Засах бичлэгийн дугаар"),
    send("measurementDate", "Хэмжсэн огноо"),
    send("height", "Өндөр (см)"),
    send("weight", "Жин (кг)"),
  ],
  groupMeasurementsSave: [
    send("institutionId", "Байгууллагын код"),
    send("studentGroupId", "Бүлгийн код"),
    send("measurementDate", "Хэмжсэн огноо"),
    send("measurementList", "Хэмжилтийн жагсаалт"),
    send("measurementList[].personId", "Хүүхдийн ESIS дугаар"),
    send("measurementList[].height", "Өндөр (см)"),
    send("measurementList[].weight", "Жин (кг)"),
    send("measurementList[].waist", "Бэлхүүс (см)"),
    send("measurementList[].hips", "Ташаа (см)"),
    send("measurementList[].reason", "Хэмжээгүй шалтгаан"),
  ],
  studentScreeningSave: [
    send("institutionId", "Байгууллагын код"),
    send("personId", "Хүүхдийн ESIS дугаар"),
    send("answerList", "Хариултын жагсаалт"),
    send("answerList[].surveyNameId", "Асуултын код"),
    send("answerList[].answer", "Хариулт"),
  ],
  /*
   * ★ No screen sends this. It is listed so the catalogue is complete and the
   * grant is visible; attaching a child's medical document to a ministry
   * record is a consent decision, not a button. See the endpoint's note.
   */
  studentAttachmentSave: [
    send("institutionId", "Байгууллагын код"),
    send("personId", "Хүүхдийн ESIS дугаар"),
    send("studentAssessmentId", "Үзлэгийн дугаар"),
    send("attachmentName", "Хавсралтын нэр"),
    send("fileType", "Файлын төрөл"),
    send("fileSize", "Файлын хэмжээ"),
    send("fileContent", "Файлын агуулга"),
  ],
};

/**
 * The columns a service's table draws, in the order a person reads them.
 *
 * ★ **Why this table exists — 2026-09-14.** The UI used to take the service's
 * *first five* fields, and the catalogue above is in the ESIS developer
 * portal's documentation order, which leads with identifiers. So the student
 * roster opened with:
 *
 *     Байгууллагын код │ ESIS хүний дугаар │ Ургийн овог │ Овог │ Нэр
 *     42778            │ 9425579614258     │ Боржигон    │ Гонгордорж │ Эмүжин
 *
 * The first column is the same value on every row — it is the institution the
 * reader is already looking at. The second is a thirteen-digit number nobody
 * can use. The child's name came third, split across three columns.
 * Seventeen of the twenty-nine services opened with "Байгууллагын код".
 *
 * ★★ Documentation order is not reading order, and neither is derivable from
 * the other — which is why this is a written list rather than a rule. A
 * heuristic ("drop columns whose value repeats") was considered and rejected:
 * it makes the columns depend on the data, so a kindergarten with every child
 * in one group would lose its Бүлэг column exactly when the roster is longest.
 *
 * ★★★ A service absent from this table keeps the old behaviour — the first
 * five fields. That is deliberate: forgetting to add a service should leave it
 * looking as it does today, not render it with no columns at all. See
 * `esisVisibleColumns`.
 *
 * Names are field names from the catalogue above. A name that does not appear
 * there is dropped by `withSummaryColumns` rather than silently shifting the
 * positions of the columns after it.
 */
export const ESIS_SUMMARY_FIELDS: Partial<Record<keyof typeof ESIS_ENDPOINTS, string[]>> = {
  organization: ["institutionName", "institutionTypeName", "districtName", "institutionAddress"],
  buildings: ["buildingName", "buildingPurposeName", "buildingPropertyTypeName", "totalCapacity"],
  academicYearStatuses: [
    "academicYear",
    "academicYearStatus",
    "currentAcademicYearFlag",
    "openDate",
  ],
  groups: ["studentGroupName", "academicLevelName", "groupShiftName", "academicYear"],
  students: ["lastName", "firstName", "studentGroupName", "dateOfBirth", "genderName"],
  studentByRegister: ["lastName", "firstName", "studentGroupName", "dateOfBirth", "genderName"],
  studentInfo: ["lastName", "firstName", "studentGroupName", "dateOfBirth", "genderName"],
  studentSearch: ["lastName", "firstName", "studentGroupName", "dateOfBirth", "genderName"],
  groupStudents: ["lastName", "firstName", "studentGroupName", "dateOfBirth", "genderName"],
  studentMovements: ["lastName", "firstName", "studentGroupName", "actionName", "actionDate"],
  teachers: ["displayName", "positionName", "instructorTypeName", "subjectDepartmentName"],
  staff: ["lastName", "firstName", "positionName", "minor", "primaryFlag"],
  groupAttendance: ["dayDate", "attendanceReasonName", "tardyMinutes", "personId"],
  foodProductTypes: ["productTypeName", "productType"],
  foodMaterialGroups: ["groupName", "groupCode", "orgGroup"],
  foodMaterials: ["materialName", "measureCode", "calories", "materialCode"],
  foodProducts: ["productName", "productType", "measureCode", "calories"],
  foodProductMaterials: ["materialId", "netWeight", "grossWeight", "measureCode"],
  livelihoodForm1: ["academicYear", "academicMonth", "studentCnt", "livelihoodCnt"],
  livelihoodForm2: ["studentGroupName", "academicMonth", "arrivalDays", "amountDue"],
  foodDiscountStudents: ["lastName", "firstName", "isFoodDiscount", "orderNum"],
  foodKit: ["productType", "nutrition", "calories", "proteins"],
  foodKitProducts: ["productName", "productType", "nutrition", "calories"],
  /*
   * ★ The nine below were rewritten on 2026-09-14 with the field lists they
   * name. Every one referred to invented fields, so `withSummaryColumns`
   * matched nothing, every service fell through to "the first five fields", and
   * the tables opened with Байгууллагын код — the exact failure this table was
   * added to fix, silently reintroduced for a third of the catalogue.
   */
  studentCheck: ["isRegistered", "message"],
  // The section first: it is what says whether a row is a guardian, their
  // phone, or the child's own contact point, and no other column can.
  studentContacts: ["section", "lastName", "firstName", "phoneNumber", "emailAddress"],
  // Unlabelled flags make a poor summary, so the summary is what can be read:
  // which record it is and the two numbers ESIS does name as numbers.
  studentStatistics: ["studentStatisticsId", "infoNumber5", "infoNumber6", "infoText5"],
  studentCondition: ["academicYear", "studentLivingPalace", "livingPlaceDistance", "enrollYear"],
  teacherAcademicOrg: ["jobName", "subjectDepartmentName", "jobCode"],
  teacherMovements: ["displayName", "typeName", "actionName", "actionDate"],
  groupsNextYear: ["studentGroupName", "academicLevelName", "studentCount", "academicYear"],
  programs: [
    "programOfStudyName",
    "programClassficationName",
    "educationLevelName",
    "educationLevelCode",
  ],
  programStages: ["programStageName", "academicLevelName", "sequence"],
  programPlans: ["programPlanName", "academicYear", "activeFlag"],
  programCourses: ["courseName", "subjectAreaName", "credit", "hours"],
  rooms: ["roomName", "classRoomType", "roomCapacity", "floorNumber", "roomNumber"],
  subjectAreas: ["subjectAreaName", "subjectAreaNameMgl", "subjectAreaId"],

  /*
   * ── Added 2026-09-14 ────────────────────────────────────────────────────
   * ★ The six discovered-shape services are deliberately absent. Their columns
   * are read off the response, and a summary naming fields nobody has seen
   * would be dropped by `withSummaryColumns` anyway — leaving the fallback,
   * which for a one-field service is the field. That is the right outcome.
   */
  studentAssessments: [
    "consultationDate",
    "consultationType",
    "consultationResult",
    "examinerOrganization",
    "treatmentFlag",
  ],
  studentMeasurements: ["measurementDate", "height", "weight", "weightIndex"],
  vaccineCatalog: ["VACCINE_NAME", "VACCINE_DOSE"],
  vaccineHistory: ["VACCINE_NAME", "VACCINE_DOSE", "APPROVED_DATE", "HOSPITAL_NAME"],
  vaccinePlan: ["VACCINE_GROUP_NAME", "STEP_NAME", "STEP_AGE", "PLAN_DATE"],
  // The worksheet reads left to right as a nurse fills it in.
  groupMeasurements: ["personId", "height", "weight", "waist", "hips"],
  screeningQuestions: ["surveyName", "surveyNameId"],
  schoolAttendance: ["studentGroupName", "status", "reasonPresent", "reasonSick", "allStu"],
  workerInfo: ["lastName", "firstName", "jobName", "institutionName", "userRole"],
  teacherProfile: ["jobName", "subjectDepartmentName", "totalWorkYears", "instructorTypeName"],
  teacherCheck: ["isRegistered", "message"],
};

/**
 * Stamps each service's reading order onto its fields.
 *
 * ★ A position rather than a flag, because order is the half of the problem a
 * flag cannot carry: `studentGroupName` is the fifteenth field of
 * `STUDENT_FIELDS`, so a filter that kept catalogue order could not put Бүлэг
 * beside Нэр however it was written.
 *
 * ★★ Named fields that the catalogue does not carry are skipped, and the
 * positions close up behind them. A typo therefore costs one column rather
 * than leaving a gap in the numbering that the table would have to guess at.
 */
function withSummaryColumns(
  catalog: Record<keyof typeof ESIS_ENDPOINTS, EsisField[]>,
): Record<keyof typeof ESIS_ENDPOINTS, EsisField[]> {
  const entries = Object.entries(catalog) as [keyof typeof ESIS_ENDPOINTS, EsisField[]][];

  return Object.fromEntries(
    entries.map(([key, fields]) => {
      const wanted = ESIS_SUMMARY_FIELDS[key];
      if (!wanted) return [key, fields];

      const order = new Map<string, number>();
      for (const name of wanted) {
        if (fields.some((field) => field.name === name)) order.set(name, order.size + 1);
      }

      return [
        key,
        fields.map((field) => {
          const position = order.get(field.name);
          return position === undefined ? field : { ...field, summary: position };
        }),
      ];
    }),
  ) as Record<keyof typeof ESIS_ENDPOINTS, EsisField[]>;
}

/** Every field a service returns, with the table's reading order stamped on. */
export const ESIS_FIELDS: Record<keyof typeof ESIS_ENDPOINTS, EsisField[]> =
  withSummaryColumns(ESIS_FIELD_CATALOG);

/**
 * Where each field list came from.
 *
 * All selected services were read name-by-name from the developer portal on
 * 2026-09-09. The attendance save service has inputs only; every other entry
 * below describes output fields.
 */
export const ESIS_FIELD_SOURCE: Record<keyof typeof ESIS_ENDPOINTS, EsisFieldSource> = {
  organization: "PORTAL",
  buildings: "PORTAL",
  academicYearStatuses: "PORTAL",
  groups: "PORTAL",
  students: "PORTAL",
  // API-000144's exact output contract, read off the public developer portal
  // on 2026-09-09 — see `STUDENT_BY_REGISTER_FIELDS` and the endpoint's note.
  studentByRegister: "PORTAL",
  // The catalog page truncates before the суралцагч block, so this one's field
  // list is `students`' — the same record, found a different way — rather than
  // a list read off the portal. Marked ADAPTER until somebody can read it.
  studentInfo: "ADAPTER",
  groupStudents: "PORTAL",
  studentMovements: "PORTAL",
  teachers: "PORTAL",
  staff: "PORTAL",
  groupAttendance: "PORTAL",
  saveAttendanceV3: "PORTAL",
  foodProductTypes: "PORTAL",
  foodMaterialGroups: "PORTAL",
  foodMaterials: "PORTAL",
  foodProducts: "PORTAL",
  foodProductMaterials: "PORTAL",
  livelihoodForm1: "PORTAL",
  livelihoodForm2: "PORTAL",
  foodDiscountStudents: "PORTAL",
  foodKit: "PORTAL",
  foodKitProducts: "PORTAL",

  /*
   * ★ Added 2026-09-10, and every one of them `ADAPTER`.
   *
   * The seven суралцагч services sit in a portal section that needs a
   * signed-in session to render, so their paths came from the client and their
   * field names are this adapter's reading of the domain. The other ten *are*
   * listed on the public page — that is where their slugs came from — but the
   * page names the service without publishing its output fields, which is the
   * same situation `studentInfo` is already marked `ADAPTER` for.
   *
   * `ADAPTER` is not a lesser entry; it is an honest one. It tells the operator
   * that the column names came from us rather than from the ministry, which is
   * exactly what a reviewer comparing this screen against the portal needs to
   * know before a token exists.
   *
   * ★★ **Nine of them became `LIVE` on 2026-09-14, and the change is the whole
   * point of the distinction.** Every one of those nine was checked against a
   * real response from institution 42778, and every one was **wrong** —
   * `roomId` for `facilityId`, `academicOrgId` for `subjectDepartmentId`, a
   * thirteen-field household survey for `infoFlag1`–`infoFlag13`. Two of them
   * made their service fail outright; the other seven parsed and quietly
   * discarded the payload.
   *
   * That is what `ADAPTER` was always warning about. It was read as "not yet
   * confirmed" and it meant "invented", and the difference stayed invisible for
   * as long as nobody compared it with an answer.
   *
   * ★★★ `LIVE` is a stronger claim than `PORTAL`, not a weaker one: `PORTAL`
   * means the ministry documented these names, `LIVE` means the ministry sent
   * them. The services still marked `ADAPTER` below are the ones nobody has
   * been able to check — the writes, whose inputs a read cannot reveal, and the
   * reads that answered 203 for every child on this institution.
   */
  studentCheck: "LIVE",
  studentContacts: "LIVE",
  studentContactsSave: "ADAPTER",
  studentStatistics: "LIVE",
  studentStatisticsSave: "ADAPTER",
  studentCondition: "LIVE",
  studentConditionSave: "ADAPTER",
  teacherAcademicOrg: "LIVE",
  teacherMovements: "LIVE",
  /*
   * Still `ADAPTER`: institution 42778 answers 203 for it, so the field names
   * below have never met a row. It is the one service in this block whose
   * emptiness is the ministry's rather than ours.
   */
  groupsNextYear: "ADAPTER",
  /*
   * ★ `ADAPTER`, the weakest of the three, and correctly so: these field lists
   * have met neither a portal page nor a live response. They become `LIVE` when
   * the probe in spec №3б's plan reads the names out of each service's own
   * refusal.
   */
  groupCreate: "ADAPTER",
  groupUpdate: "ADAPTER",
  groupInstructor: "ADAPTER",
  programs: "LIVE",
  programStages: "ADAPTER",
  programPlans: "ADAPTER",
  programCourses: "ADAPTER",
  rooms: "LIVE",
  academicOrg: "LIVE",
  subjectAreas: "LIVE",

  /*
   * ── Added 2026-09-14, from the ministry's granted-service export ────────
   *
   * ★ `LIVE` where a real response was captured; `ADAPTER` everywhere else,
   * and the split is exactly the evidence.
   *
   * The six `ADAPTER` reads are the discovered-shape ones — they answered 203
   * for every child, so there is nothing to declare and `esisFieldsFor` reads
   * their columns off the first record instead. The ten writes are `ADAPTER`
   * because an input contract cannot be observed by reading, which is the same
   * position `saveAttendanceV3` has always been in.
   */
  studentAllergy: "ADAPTER",
  studentProhibitedFood: "ADAPTER",
  studentDisability: "ADAPTER",
  studentSurgery: "ADAPTER",
  studentIncident: "ADAPTER",
  studentScreening: "ADAPTER",
  studentAssessments: "LIVE",
  studentMeasurements: "LIVE",
  /*
   * ★ `LIVE`, from a capture that a later call could not repeat. The three
   * vaccine services returned real rows on 2026-09-14 and answered 203 for the
   * same children an hour later — see the endpoint note. The shapes below are
   * from the successful call and are the ministry's own; the intermittency is
   * a fact about availability, not about the contract.
   */
  vaccineCatalog: "LIVE",
  vaccineHistory: "LIVE",
  vaccinePlan: "LIVE",
  groupMeasurements: "LIVE",
  screeningQuestions: "LIVE",
  schoolAttendance: "LIVE",
  workerInfo: "LIVE",
  teacherProfile: "LIVE",
  teacherCheck: "LIVE",
  studentAllergySave: "ADAPTER",
  studentProhibitedFoodSave: "ADAPTER",
  studentDisabilitySave: "ADAPTER",
  studentAssessmentsSave: "ADAPTER",
  studentMeasurementSave: "ADAPTER",
  studentSurgerySave: "ADAPTER",
  studentIncidentSave: "ADAPTER",
  studentAttachmentSave: "ADAPTER",
  groupMeasurementsSave: "ADAPTER",
  studentScreeningSave: "ADAPTER",

  /*
   * ── Closed 2026-09-17 ─────────────────────────────────────────────────
   * `studentAwards` and `buildingByRegisterNumber` both answered `203` live —
   * `ADAPTER`, the same as the discovered-shape six. `studentSearch` answered
   * `200` with API-000144's exact shape — `LIVE`, like `studentByRegister`.
   */
  studentAwards: "ADAPTER",
  studentSearch: "LIVE",
  buildingByRegisterNumber: "ADAPTER",
};

/** Output names NomadKids keeps — the exact key set of the parsing schema. */
export function ingestedFieldNames(key: keyof typeof ESIS_ENDPOINTS): string[] {
  return ESIS_FIELDS[key]
    .filter((field) => field.io === "OUTPUT" && field.ingested)
    .map((field) => field.name);
}

/**
 * Services whose output contract is read off the response, not declared here.
 *
 * ★ Added 2026-09-14 with the health services. Each of these answers `203` for
 * every child on institution 42778 — the path works and the grant is approved,
 * but no row has ever been returned, so the field names are genuinely unknown.
 *
 * The eleven corrected the same day are the reason this is a mechanism rather
 * than five more `keep("allergenName", "Харшил")` guesses. A declared list that
 * nobody has checked is indistinguishable, on screen, from one that is right —
 * and seven of the eleven parsed happily while throwing the real payload away.
 *
 * For a key in this set, `esisFieldsFor()` returns the declared anchors plus a
 * field for every key the response actually carried. Nothing is invented; the
 * screen shows the ministry's own names the first time a record exists.
 *
 * ★★ Promotion is the goal, not the resting state. When a record appears,
 * copy the names it showed into `ESIS_FIELDS`, mark the service `LIVE`, and
 * take it out of this set.
 */
export const ESIS_DISCOVERED_SHAPE: ReadonlySet<keyof typeof ESIS_ENDPOINTS> = new Set([
  "studentAllergy",
  "studentProhibitedFood",
  "studentDisability",
  "studentSurgery",
  "studentIncident",
  "studentScreening",
  /*
   * ★ Added 2026-09-17. `studentAwards` is per-child and answered `203` live,
   * so it belongs here exactly like its six health siblings above.
   * `buildingByRegisterNumber` also answered `203` but is **not** added: this
   * set's test pins every member's anchor to `personId`, which is a per-child
   * fact a building record has no reason to carry. It keeps its own one-field
   * declaration in `ESIS_FIELDS` instead, outside this set.
   */
  "studentAwards",
]);

/**
 * The fields to show for one read, given what came back.
 *
 * ★ Every declared field is returned, whether or not the rows carried it — the
 * columns must not depend on the data, or "ESIS stopped sending this" and
 * "this child has no value" become the same picture, and only one of those is
 * worth waking up for.
 *
 * ★★ **Discovery now runs for every service, not only the unseen six.**
 *
 * Until 2026-09-15 a declared schema dropped anything it did not name, so a
 * declared service could not carry a surprise and returning `ESIS_FIELDS[key]`
 * unchanged was accurate. Readers now pass through what ESIS sends, so any of
 * them can — and a field in the payload that the screen refuses to draw is the
 * same defect, moved.
 *
 * Declared anchors still come first, for the reason in ★. Discovered keys
 * follow in first-seen order, labelled with their own name. A name we cannot
 * translate is shown untranslated rather than guessed at.
 */
export function esisFieldsFor(key: keyof typeof ESIS_ENDPOINTS, rows: unknown[]): EsisField[] {
  const declared = ESIS_FIELDS[key];
  const known = new Set(declared.map((field) => field.name));
  const discovered: EsisField[] = [];

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    for (const name of Object.keys(row)) {
      if (known.has(name)) continue;
      known.add(name);
      discovered.push(keep(name, name));
    }
  }

  return [...declared, ...discovered];
}
