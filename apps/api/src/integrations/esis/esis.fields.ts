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
 * ★★★★ **`sample` is invented, and the UI must never let it pass for real.**
 *
 * Added 2026-09-07 so the screen can be *shown* before a token exists: a table
 * of field names with an empty value column demonstrates nothing to a client
 * asking what the integration will look like. Every sample is written against
 * the demo tenant ("Бяцхан нүүдэлчид (жишээ)", institution 40305) so the
 * picture is coherent across services.
 *
 * The whole risk of this field is somebody reading a sample as a value ESIS
 * returned. Three things hold that line, and all three are required:
 *
 *   1. Samples appear **only** when no live read has succeeded. The moment
 *      real rows arrive they replace the samples entirely — the UI never mixes
 *      the two in one table.
 *   2. Every surface that renders one labels it `Demo ESIS` in the same view.
 *   3. Refused fields get **no sample at all**. We never receive them, so
 *      inventing a register number to display would be a fabricated personal
 *      identifier on a screen — the one thing this catalog exists to say we do
 *      not do.
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
  /**
   * An illustrative value for demonstrations. **Not** from ESIS.
   *
   * Only ever set on an ingested field. See the class note above for the rules
   * that keep it from being mistaken for a real response.
   */
  sample?: string;
}

/** `PORTAL` — read from the developer catalog. `ADAPTER` — our schema's keys. */
export type EsisFieldSource = "PORTAL" | "ADAPTER";

const keep = (name: string, label: string, sample: string): EsisField => ({
  name,
  label,
  io: "OUTPUT",
  ingested: true,
  sample,
});

const drop = (name: string, label: string, omitReason: string): EsisField => ({
  name,
  label,
  io: "OUTPUT",
  ingested: false,
  omitReason,
});

const send = (name: string, label: string, sample: string): EsisField => ({
  name,
  label,
  io: "INPUT",
  ingested: true,
  sample,
});

const NO_CIVIL_ID = "ESIS_REQUEST.md §1.1 (b) — иргэний бүртгэлийн дугаар татахгүй";
const NO_REG_NUMBER = "ESIS_REQUEST.md §1.1 (b) — регистрийн дугаар татахгүй";
const NO_CREDENTIAL = "ESIS_REQUEST.md §1.2 — нэвтрэх мэдээлэл хүсэхгүй";

/** The demo tenant every sample is written against, so the picture is coherent. */
const INSTITUTION_ID = "40305";
const INSTITUTION_NAME = "Бяцхан нүүдэлчид (жишээ)";
const ACADEMIC_YEAR = "2026";
const GROUP_ID = "10001";
const GROUP_NAME = "Наран бүлэг";

/**
 * The child record shared by the two roster services.
 *
 * `students` and `groupStudents` return this wider roster shape. API-000144 is
 * intentionally separate below because its published output omits movement
 * and instructor fields and names its provider-password fields differently.
 */
const STUDENT_FIELDS: EsisField[] = [
  keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
  keep("personId", "ESIS хүний дугаар", "90000000000001"),
  keep("familyName", "Ургийн овог", "Боржигин"),
  keep("lastName", "Овог", "Ганболд"),
  keep("firstName", "Нэр", "Батбаяр"),
  keep("familyNameMgl", "Ургийн овог (монгол бичиг)", "Боржигин"),
  keep("lastNameMgl", "Овог (монгол бичиг)", "Ганболд"),
  keep("firstNameMgl", "Нэр (монгол бичиг)", "Батбаяр"),
  keep("dateOfBirth", "Төрсөн огноо", "2021-04-12"),
  keep("genderCode", "Хүйс", "M"),
  keep("genderName", "Хүйсийн нэр", "Эрэгтэй"),
  keep("academicLevel", "Түвшний код", "2"),
  keep("academicLevelName", "Түвшин", "Дунд бүлэг"),
  keep("studentGroupId", "Бүлгийн код", GROUP_ID),
  keep("studentGroupName", "Бүлгийн нэр", GROUP_NAME),
  keep("programOfStudyId", "Хөтөлбөрийн код", "501"),
  keep("programOfStudyName", "Хөтөлбөр", "Сургуулийн өмнөх боловсрол"),
  keep("programPlanId", "Сургалтын төлөвлөгөөний код", "780"),
  keep("programPlanName", "Сургалтын төлөвлөгөө", "СӨБ-ын үндсэн хөтөлбөр"),
  keep("programStageId", "Үе шатны код", "12"),
  keep("programStageName", "Үе шат", "Хоёрдугаар үе шат"),
  keep("microsoftEmail", "Microsoft албан и-мэйл", "batbayar.g@esis.edu.mn"),
  keep("googleEmail", "Google албан и-мэйл", "batbayar.g@moes.edu.mn"),
  keep("actionDate", "Үйлдэл хийсэн огноо", "2026-09-01"),
  keep("academicYear", "Хичээлийн жил", ACADEMIC_YEAR),
  keep("instructorId", "Багшийн код", "88012"),
  keep("instructorName", "Багшийн нэр", "Д.Сараа"),
  keep("programStatus", "Суралцах төлөв", "ACTIVE"),
  keep("programStatusName", "Суралцах төлөвийн нэр", "Суралцаж байгаа"),
  drop("civilId", "Иргэний бүртгэлийн дугаар", NO_CIVIL_ID),
  drop("personRegNumber", "Регистрийн дугаар", NO_REG_NUMBER),
  drop("microsoftPassword", "Microsoft нууц үг", NO_CREDENTIAL),
  drop("googlePassword", "Google нууц үг", NO_CREDENTIAL),
];

/** Exact API-000144 output contract, with the four sensitive values refused. */
const STUDENT_BY_REGISTER_FIELDS: EsisField[] = [
  keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
  keep("personId", "ESIS хүний дугаар", "90000000000001"),
  drop("civilId", "Иргэний бүртгэлийн дугаар", NO_CIVIL_ID),
  drop("personRegNumber", "Регистрийн дугаар", NO_REG_NUMBER),
  keep("familyName", "Ургийн овог", "Боржигин"),
  keep("firstName", "Нэр", "Батбаяр"),
  keep("lastName", "Овог", "Ганболд"),
  keep("familyNameMgl", "Ургийн овог (монгол бичиг)", "Боржигин"),
  keep("firstNameMgl", "Нэр (монгол бичиг)", "Батбаяр"),
  keep("lastNameMgl", "Овог (монгол бичиг)", "Ганболд"),
  keep("dateOfBirth", "Төрсөн огноо", "2021-04-12"),
  keep("genderCode", "Хүйсийн код", "M"),
  keep("genderName", "Хүйс", "Эрэгтэй"),
  keep("academicLevel", "Түвшний код", "2"),
  keep("academicLevelName", "Түвшин", "Дунд бүлэг"),
  keep("studentGroupId", "Бүлгийн код", GROUP_ID),
  keep("studentGroupName", "Бүлгийн нэр", GROUP_NAME),
  keep("programOfStudyId", "Хөтөлбөрийн код", "501"),
  keep("programOfStudyName", "Хөтөлбөр", "Сургуулийн өмнөх боловсрол"),
  keep("programPlanId", "Сургалтын төлөвлөгөөний код", "780"),
  keep("programPlanName", "Сургалтын төлөвлөгөө", "СӨБ-ын үндсэн хөтөлбөр"),
  keep("microsoftEmail", "Microsoft албан и-мэйл", "batbayar.g@esis.edu.mn"),
  drop("microsoftEmailPass", "Microsoft нууц үг", NO_CREDENTIAL),
  keep("googleEmail", "Google албан и-мэйл", "batbayar.g@moes.edu.mn"),
  drop("googleEmailPass", "Google нууц үг", NO_CREDENTIAL),
  keep("academicYear", "Хичээлийн жил", ACADEMIC_YEAR),
];

/**
 * The name block both person services return.
 *
 * A function rather than a constant because the teacher and the staff member
 * are different people in the demonstration — a shared constant would put the
 * same name under both, which is the sort of detail that makes a demo look
 * like a mock-up.
 */
function personNameFields(person: {
  familyName: string;
  lastName: string;
  firstName: string;
  genderCode: string;
  genderName: string;
  dateOfBirth: string;
}): EsisField[] {
  return [
    keep("familyName", "Ургийн овог", person.familyName),
    keep("lastName", "Овог", person.lastName),
    keep("firstName", "Нэр", person.firstName),
    keep("familyNameMgl", "Ургийн овог (монгол бичиг)", person.familyName),
    keep("firstNameMgl", "Нэр (монгол бичиг)", person.firstName),
    keep("lastNameMgl", "Овог (монгол бичиг)", person.lastName),
    keep("genderCode", "Хүйсийн код", person.genderCode),
    keep("genderName", "Хүйс", person.genderName),
    keep("dateOfBirth", "Төрсөн огноо", person.dateOfBirth),
  ];
}

function officialEmailFields(local: string): EsisField[] {
  return [
    keep("microsoftEmail", "Microsoft албан и-мэйл", `${local}@esis.edu.mn`),
    keep("googleEmail", "Google албан и-мэйл", `${local}@gmail.com`),
    keep("allEmail", "Бүх и-мэйл", `${local}@esis.edu.mn`),
  ];
}

const CREDENTIAL_FIELDS: EsisField[] = [
  drop("civilId", "Иргэний бүртгэлийн дугаар", NO_CIVIL_ID),
  drop("personRegNumber", "Регистрийн дугаар", NO_REG_NUMBER),
  drop("microsoftEmailPass", "Microsoft нууц үг", NO_CREDENTIAL),
  drop("googleEmailPass", "Google нууц үг", NO_CREDENTIAL),
];

function nutritionFields(values: {
  nutrition: string;
  calories: string;
  proteins: string;
  fats: string;
  carbohydrate: string;
}): EsisField[] {
  return [
    keep("nutrition", "Шимт бодис", values.nutrition),
    keep("calories", "Илчлэг", values.calories),
    keep("proteins", "Уураг", values.proteins),
    keep("fats", "Өөх тос", values.fats),
    keep("carbohydrate", "Нүүрс ус", values.carbohydrate),
  ];
}

export const ESIS_FIELDS: Record<keyof typeof ESIS_ENDPOINTS, EsisField[]> = {
  organization: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("institutionName", "Байгууллагын нэр", INSTITUTION_NAME),
    keep("shortName", "Товч нэр", "Бяцхан нүүдэлчид"),
    keep("longName", "Бүтэн нэр", "Бяцхан нүүдэлчид өдрийн цэцэрлэг"),
    keep("legalName", "Хуулийн этгээдийн нэр", "Byatshan Nuudelchid LLC"),
    keep("legalNameMgl", "Хуулийн этгээдийн нэр (монгол бичиг)", "Бяцхан нүүдэлчид ХХК"),
    keep("propertyTypeName", "Өмчийн хэлбэр", "Хувийн"),
    keep("institutionTypeId", "Байгууллагын төрлийн код", "3"),
    keep("institutionTypeName", "Байгууллагын төрөл", "Цэцэрлэг"),
    keep("provinceName", "Аймаг, нийслэл", "Улаанбаатар"),
    keep("districtName", "Сум, дүүрэг", "Баянзүрх"),
    keep("subDistrictName", "Баг, хороо", "26-р хороо"),
    keep("regionName", "Бүс", "Төвийн бүс"),
    keep("institutionAddress", "Хаяг", "Улаанбаатар, Баянзүрх дүүрэг, 26-р хороо"),
    keep("institutionClassificationId", "Ангиллын код", "1"),
    keep("institutionClassificationName", "Ангилал", "Сургуулийн өмнөх боловсрол"),
  ],
  /* Read name by name off the developer portal on 2026-09-09, labels included. */
  buildings: [
    keep("buildingId", "Барилга байгууламжийн дугаар", "70210"),
    keep("buildingName", "Барилга байгууламжийн нэр", "Үндсэн байр"),
    keep("createdYear", "Үүсгэсэн он", "2014"),
    keep("buildingPurposeCode", "Зориулалтын код", "KG"),
    keep("buildingPurposeName", "Барилга байгууламжийн зориулалт", "Цэцэрлэгийн зориулалттай"),
    keep("standardFlag", "Стандартын эсэх", "Y"),
    keep("buildingPropertyType", "Эзэмшлийн төрлийн код", "2"),
    keep("buildingPropertyTypeName", "Эзэмшлийн төрөл", "Хувийн"),
    keep("normalCapacity", "Багтаамж", "120"),
    keep("totalCapacity", "Нийт багтаамж", "150"),
    keep("firstCost", "Анхны үнэ", "480000000"),
    keep("lastCost", "Эцсийн үнэ", "612000000"),
    keep("approvalStatusCode", "Баталгаажуулалтын төлөв", "APPROVED"),
  ],
  academicYearStatuses: [
    keep("academicYear", "Хичээлийн жил", ACADEMIC_YEAR),
    keep("currentAcademicYearFlag", "Идэвхтэй жил эсэх", "Y"),
    keep("openDate", "Нээсэн огноо", "2026-09-01"),
    keep("closedDate", "Хаасан огноо", "2027-06-01"),
    keep("academicYearStatus", "Төлөв", "ACTIVE"),
  ],
  groups: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("studentGroupId", "Бүлгийн код", GROUP_ID),
    keep("studentGroupName", "Бүлгийн нэр", GROUP_NAME),
    keep("academicLevel", "Түвшний код", "2"),
    keep("academicLevelName", "Түвшин", "Дунд бүлэг"),
    keep("programOfStudyId", "Хөтөлбөрийн код", "501"),
    keep("programOfStudyName", "Хөтөлбөр", "Сургуулийн өмнөх боловсрол"),
    keep("programStageId", "Үе шатны код", "12"),
    keep("programStageName", "Үе шат", "Хоёрдугаар үе шат"),
    keep("programPlanId", "Сургалтын төлөвлөгөөний код", "780"),
    keep("programPlanName", "Сургалтын төлөвлөгөө", "СӨБ-ын үндсэн хөтөлбөр"),
    keep("groupTypeCode", "Бүлгийн төрлийн код", "NORMAL"),
    keep("groupTypeName", "Бүлгийн төрөл", "Энгийн"),
    keep("groupShiftId", "Ээлжийн код", "1"),
    keep("groupShiftName", "Ээлж", "Өдрийн ээлж"),
    keep("groupClassificationId", "Ангиллын код", "4"),
    keep("groupClassificationName", "Ангилал", "Насны бүлэг"),
    keep("groupCategoryCode", "Ангийн ангиллын код", "KG"),
    keep("groupCategoryName", "Ангийн ангилал", "Цэцэрлэгийн бүлэг"),
    keep("academicGroupId", "Хичээлийн бүлгийн код", GROUP_ID),
    keep("academicGroupName", "Хичээлийн бүлэг", GROUP_NAME),
    keep("instructorId", "Багшийн код", "88012"),
    keep("instructorName", "Багшийн нэр", "Д.Сараа"),
    keep("academicYear", "Хичээлийн жил", ACADEMIC_YEAR),
  ],
  students: STUDENT_FIELDS,
  studentByRegister: STUDENT_BY_REGISTER_FIELDS,
  studentInfo: STUDENT_FIELDS,
  groupStudents: STUDENT_FIELDS,
  studentMovements: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("studentProgramId", "Суралцах хөтөлбөрийн код", "45012"),
    keep("academicLevel", "Түвшний код", "2"),
    keep("academicLevelName", "Түвшин", "Дунд бүлэг"),
    keep("studentGroupId", "Бүлгийн код", GROUP_ID),
    keep("studentGroupName", "Бүлгийн нэр", GROUP_NAME),
    keep("programOfStudyId", "Хөтөлбөрийн код", "501"),
    keep("programOfStudyName", "Хөтөлбөр", "Сургуулийн өмнөх боловсрол"),
    keep("programPlanId", "Сургалтын төлөвлөгөөний код", "780"),
    keep("programPlanName", "Сургалтын төлөвлөгөө", "СӨБ-ын үндсэн хөтөлбөр"),
    keep("programStatusCode", "Хөтөлбөрийн төлөвийн код", "ACTIVE"),
    keep("programStatusName", "Хөтөлбөрийн төлөв", "Суралцаж байгаа"),
    keep("approvalStatusCode", "Баталгаажилтын төлөвийн код", "APPROVED"),
    keep("approvalStatusName", "Баталгаажилтын төлөв", "Баталгаажсан"),
    keep("personId", "ESIS хүний дугаар", "90000000000001"),
    keep("familyName", "Ургийн овог", "Боржигин"),
    keep("lastName", "Овог", "Ганболд"),
    keep("firstName", "Нэр", "Батбаяр"),
    keep("dateOfBirth", "Төрсөн огноо", "2021-04-12"),
    keep("genderCode", "Хүйсийн код", "M"),
    keep("genderName", "Хүйс", "Эрэгтэй"),
    keep("actionId", "Үйлдлийн код", "2"),
    keep("actionName", "Үйлдэл", "Элсэлт"),
    keep("actionDate", "Үйлдлийн огноо", "2026-09-01"),
  ],
  teachers: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("assignmentId", "Томилгооны код", "70011"),
    keep("personId", "ESIS хүний дугаар", "90000000000021"),
    keep("instructorId", "Багшийн код", "88012"),
    keep("displayName", "Дэлгэцийн нэр", "Доржийн Сараа"),
    ...personNameFields({
      familyName: "Боржигин",
      lastName: "Дорж",
      firstName: "Сараа",
      genderCode: "F",
      genderName: "Эмэгтэй",
      dateOfBirth: "1990-05-12",
    }),
    keep("positionName", "Албан тушаал", "Багш"),
    keep("instructorTypeId", "Багшийн төрлийн код", "1"),
    keep("instructorTypeName", "Багшийн төрөл", "Үндсэн багш"),
    keep("subjectDepartmentId", "Заах аргын нэгдлийн код", "9"),
    keep("subjectDepartmentName", "Заах аргын нэгдэл", "Сургуулийн өмнөх боловсрол"),
    keep("instructorAvailability", "Ажиллах боломж", "AVAILABLE"),
    ...officialEmailFields("saraa.d"),
    ...CREDENTIAL_FIELDS,
    drop("username", "Нэвтрэх нэр", NO_CREDENTIAL),
  ],
  staff: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("institutionName", "Байгууллагын нэр", INSTITUTION_NAME),
    keep("parentInstitutionId", "Дээд байгууллагын код", "1200"),
    keep("parentInstitutionName", "Дээд байгууллага", "Баянзүрх дүүргийн БСУГ"),
    keep("assignmentId", "Томилгооны код", "70044"),
    keep("personId", "ESIS хүний дугаар", "90000000000045"),
    ...personNameFields({
      familyName: "Хатагин",
      lastName: "Пүрэвдорж",
      firstName: "Оюунаа",
      genderCode: "F",
      genderName: "Эмэгтэй",
      dateOfBirth: "1985-11-20",
    }),
    keep("positionName", "Албан тушаал", "Эрхлэгч"),
    keep("positionCode", "Албан тушаалын код", "DIRECTOR"),
    keep("jobCode", "Ажлын байрны код", "1001"),
    keep("minor", "Мэргэшил", "Багш, арга зүйч"),
    keep("primaryFlag", "Үндсэн ажлын байр эсэх", "Y"),
    keep("educationSectorYears", "Боловсролын салбарт ажилласан жил", "18"),
    keep("yearsOfService", "Нийт ажилласан жил", "22"),
    keep("propertyClassificationCode", "Өмчийн ангиллын код", "PRIVATE"),
    keep("propertyClassificationName", "Өмчийн ангилал", "Хувийн"),
    ...officialEmailFields("oyunaa.p"),
    ...CREDENTIAL_FIELDS,
  ],
  groupAttendance: [
    keep("academicLevel", "Түвшний код", "2"),
    keep("personId", "ESIS хүний дугаар", "90000000000001"),
    keep("dayDate", "Огноо", "2026-09-07"),
    keep("attendanceReasonCode", "Ирцийн шалтгааны код", "PRESENT"),
    keep("attendanceReasonName", "Ирцийн шалтгаан", "Ирсэн"),
    keep("tardyMinutes", "Хоцорсон минут", "0"),
  ],
  saveAttendanceV3: [
    send("institutionId", "Байгууллагын код", INSTITUTION_ID),
    send("studentGroupId", "Бүлгийн код", GROUP_ID),
    send("dayDate", "Огноо", "2026-09-07"),
    send("attendanceList", "Ирцийн жагсаалт", "18 мөр"),
    send("personId", "ESIS хүний дугаар", "90000000000001"),
    send("attendReasonCode", "Ирцийн шалтгааны код", "PRESENT"),
    send("tardyMinutes", "Хоцорсон минут", "0"),
    send("attendReasonList", "Шалтгааны нэмэлт код", "[]"),
  ],
  foodProductTypes: [
    keep("productType", "Хоолны төрлийн код", "SOUP"),
    keep("productTypeName", "Хоолны төрөл", "1-р хоол"),
  ],
  foodMaterialGroups: [
    keep("groupId", "Бүлгийн код", "14"),
    keep("parentGroupId", "Дээд бүлгийн код", "2"),
    keep("orgGroup", "Сургалтын хэлбэр", "SUB"),
    keep("groupCode", "Бүлгийн товч код", "МУХ"),
    keep("groupName", "Бүлгийн нэр", "Мах, махан бүтээгдэхүүн"),
  ],
  foodMaterials: [
    keep("materialId", "Материалын код", "3021"),
    keep("groupId", "Бүлгийн код", "14"),
    keep("materialCode", "Материалын товч код", "M-3021"),
    keep("materialName", "Материалын нэр", "Үхрийн мах (цул)"),
    keep("measureCode", "Хэмжих нэгж", "gr"),
    keep("supplierType", "Нийлүүлэгчийн төрөл", "Y"),
    ...nutritionFields({
      nutrition: "18.6",
      calories: "187",
      proteins: "18.6",
      fats: "12.4",
      carbohydrate: "0",
    }),
    keep("sequence", "Дараалал", "27"),
  ],
  foodProducts: [
    keep("productId", "Бүтээгдэхүүний код", "5107"),
    keep("productCode", "Бүтээгдэхүүний товч код", "P-5107"),
    keep("productName", "Бүтээгдэхүүний нэр", "Гурилтай шөл"),
    keep("measureCode", "Хэмжих нэгж", "порц"),
    keep("productType", "Хоолны төрөл", "SOUP"),
    ...nutritionFields({
      nutrition: "9.8",
      calories: "245",
      proteins: "9.8",
      fats: "7.2",
      carbohydrate: "31.5",
    }),
    keep("hasRecipeFlag", "Технологийн карттай эсэх", "Y"),
    keep("kitFlag", "Иж бүрдэл эсэх", "N"),
    keep("sequence", "Дараалал", "17"),
  ],
  foodProductMaterials: [
    keep("productMaterialId", "Орцын код", "88012"),
    keep("productId", "Бүтээгдэхүүний код", "5107"),
    keep("groupId", "Бүлгийн код", "14"),
    keep("materialId", "Материалын код", "3021"),
    keep("measureCode", "Хэмжих нэгж", "гр"),
    keep("grossWeight", "Бохир жин", "55.0"),
    keep("netWeight", "Цэвэр жин", "50.0"),
    keep("sequence", "Дараалал", "1"),
  ],
  /*
   * ★ Read name by name off the developer portal on 2026-09-09, labels and
   * all — these two carry Mongolian names in the catalog itself, so the labels
   * below are the ministry's own words rather than a translation of ours.
   */
  livelihoodForm1: [
    keep("orgName", "Байгууллагын нэр", INSTITUTION_NAME),
    keep("academicYear", "Жил", ACADEMIC_YEAR),
    keep("academicMonth", "Сар", "9"),
    keep("studentCnt", "Сурагчийн тоо", "10"),
    keep("livelihoodCnt", "Хөнгөлөлтөнд хамрагдах сурагчийн тоо", "3"),
    keep("livelihoodBudget", "Төвлөрүүлэх орлогын дүн", "1848000"),
    keep("livelihoodAmount", "Төвлөрүүлсэн орлогын дүн", "1616000"),
  ],
  livelihoodForm2: [
    keep("orgName", "Байгууллагын нэр", INSTITUTION_NAME),
    keep("academicYear", "Жил", ACADEMIC_YEAR),
    keep("academicMonth", "Сар", "9"),
    keep("studentGroupId", "Бүлгийн дугаар", GROUP_ID),
    keep("studentGroupName", "Бүлгийн нэр", GROUP_NAME),
    keep("personId", "Суралцагчийн дугаар", "90000000000001"),
    keep("comingDays", "Ирэх өдөр", "22"),
    keep("arrivalDays", "Ирсэн өдөр", "20"),
    keep("amountDue", "Төлөх дүн", "184800"),
    keep("amountPaid", "Төлсөн дүн", "168000"),
    keep("livelihoodDiscount", "Амьжиргааны хөнгөлөлт", "0"),
  ],
  foodKit: [
    keep("productId", "Бүтээгдэхүүний код", "5240"),
    keep("productType", "Хоолны төрөл", "BREAKFAST"),
    ...nutritionFields({
      nutrition: "12.4",
      calories: "318",
      proteins: "11.2",
      fats: "8.5",
      carbohydrate: "46.8",
    }),
  ],
  foodKitProducts: [
    keep("productCode", "Бүтээгдэхүүний товч код", "P-5241"),
    keep("productName", "Бүтээгдэхүүний нэр", "Сүүтэй цай"),
    keep("productType", "Хоолны төрөл", "DRINK"),
    ...nutritionFields({
      nutrition: "5.1",
      calories: "96",
      proteins: "3.2",
      fats: "3.5",
      carbohydrate: "12.8",
    }),
    keep("orgType", "Байгууллагын төрөл", "SUB"),
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
   *
   * ★★ The samples stay bound to the same demo tenant as every other service
   * (`INSTITUTION_ID`, `GROUP_NAME`, the child "Батбаяр") so a director
   * looking at three panels sees one kindergarten rather than three fixtures.
   */

  studentCheck: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("personId", "ESIS хүний дугаар", "90000000000001"),
    keep("isRegistered", "ЭСИС-д бүртгэлтэй эсэх", "true"),
    keep("statusCode", "Төлвийн код", "ACTIVE"),
    keep("statusName", "Төлөв", "Суралцаж байгаа"),
    keep("studentGroupId", "Бүлгийн код", GROUP_ID),
    keep("studentGroupName", "Бүлгийн нэр", GROUP_NAME),
    keep("academicYear", "Хичээлийн жил", ACADEMIC_YEAR),
    keep("enrollmentDate", "Элссэн огноо", "2024-09-02"),
  ],

  studentContacts: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("personId", "Хүүхдийн ESIS дугаар", "90000000000001"),
    keep("contactId", "Холбоо барих хүний дугаар", "70000000000001"),
    keep("relationTypeId", "Хамаарлын код", "1"),
    keep("relationTypeName", "Хамаарал", "Эх"),
    keep("lastName", "Овог", "Дорж"),
    keep("firstName", "Нэр", "Сарантуяа"),
    keep("phoneNumber", "Утас", "99112233"),
    keep("phoneNumber2", "Нэмэлт утас", "88112233"),
    keep("email", "И-мэйл", "sarantuya.d@example.mn"),
    keep("address", "Хаяг", "Улаанбаатар, Баянзүрх дүүрэг, 5-р хороо"),
    keep("occupation", "Мэргэжил", "Багш"),
    keep("workplace", "Ажлын газар", "12-р сургууль"),
    keep("primaryFlag", "Үндсэн асран хамгаалагч эсэх", "true"),
    keep("liveTogetherFlag", "Хамт амьдардаг эсэх", "true"),
  ],

  studentContactsSave: [
    send("institutionId", "Байгууллагын код", INSTITUTION_ID),
    send("personId", "Хүүхдийн ESIS дугаар", "90000000000001"),
    send("contactList", "Асран хамгаалагчийн жагсаалт", "1 бичлэг"),
    send("contactList[].contactId", "Засах бичлэгийн дугаар", "70000000000001"),
    send("contactList[].relationTypeId", "Хамаарлын код", "1"),
    send("contactList[].lastName", "Овог", "Дорж"),
    send("contactList[].firstName", "Нэр", "Сарантуяа"),
    send("contactList[].phoneNumber", "Утас", "99112233"),
    send("contactList[].email", "И-мэйл", "sarantuya.d@example.mn"),
    send("contactList[].address", "Хаяг", "Улаанбаатар, Баянзүрх дүүрэг"),
    send("contactList[].occupation", "Мэргэжил", "Багш"),
    send("contactList[].workplace", "Ажлын газар", "12-р сургууль"),
    send("contactList[].primaryFlag", "Үндсэн эсэх", "true"),
    send("contactList[].liveTogetherFlag", "Хамт амьдардаг эсэх", "true"),
  ],

  studentStatistics: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("personId", "Хүүхдийн ESIS дугаар", "90000000000001"),
    keep("familyMemberCount", "Өрхийн гишүүдийн тоо", "4"),
    keep("childrenCount", "Хүүхдийн тоо", "2"),
    keep("familyTypeId", "Өрхийн төрлийн код", "1"),
    keep("familyTypeName", "Өрхийн төрөл", "Бүрэн бүтэн өрх"),
    keep("incomeTypeId", "Орлогын төрлийн код", "2"),
    keep("incomeTypeName", "Орлогын төрөл", "Цалин хөлс"),
    keep("livelihoodTypeId", "Амьжиргааны код", "2"),
    keep("livelihoodTypeName", "Амьжиргааны түвшин", "Дундаж"),
    keep("isHerderFamily", "Малчин өрх эсэх", "false"),
    keep("isSingleParent", "Өрх толгойлсон эсэх", "false"),
    keep("hasDisabledMember", "Хөгжлийн бэрхшээлтэй гишүүнтэй эсэх", "false"),
    keep("socialWelfareFlag", "Нийгмийн халамж авдаг эсэх", "false"),
    keep("updatedDate", "Шинэчилсэн огноо", "2026-09-01"),
  ],

  studentStatisticsSave: [
    send("institutionId", "Байгууллагын код", INSTITUTION_ID),
    send("personId", "Хүүхдийн ESIS дугаар", "90000000000001"),
    send("familyMemberCount", "Өрхийн гишүүдийн тоо", "4"),
    send("childrenCount", "Хүүхдийн тоо", "2"),
    send("familyTypeId", "Өрхийн төрлийн код", "1"),
    send("incomeTypeId", "Орлогын төрлийн код", "2"),
    send("livelihoodTypeId", "Амьжиргааны код", "2"),
    send("isHerderFamily", "Малчин өрх эсэх", "false"),
    send("isSingleParent", "Өрх толгойлсон эсэх", "false"),
    send("hasDisabledMember", "Хөгжлийн бэрхшээлтэй гишүүнтэй эсэх", "false"),
    send("socialWelfareFlag", "Нийгмийн халамж авдаг эсэх", "false"),
  ],

  studentCondition: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("personId", "Хүүхдийн ESIS дугаар", "90000000000001"),
    keep("dwellingTypeId", "Орон сууцны төрлийн код", "1"),
    keep("dwellingTypeName", "Орон сууцны төрөл", "Орон сууц"),
    keep("ownershipTypeId", "Эзэмшлийн код", "1"),
    keep("ownershipTypeName", "Эзэмшлийн хэлбэр", "Өөрийн"),
    keep("heatingTypeId", "Халаалтын код", "1"),
    keep("heatingTypeName", "Халаалт", "Төвийн шугам"),
    keep("waterSourceId", "Ус хангамжийн код", "1"),
    keep("waterSourceName", "Ус хангамж", "Төвийн шугам"),
    keep("toiletTypeId", "Ариун цэврийн байгууламжийн код", "1"),
    keep("toiletTypeName", "Ариун цэврийн байгууламж", "Дотор, ус татдаг"),
    keep("electricityFlag", "Цахилгаантай эсэх", "true"),
    keep("internetFlag", "Интернэттэй эсэх", "true"),
    keep("roomCount", "Өрөөний тоо", "3"),
    keep("distanceToSchool", "Цэцэрлэг хүртэлх зай", "1.2 км"),
    keep("updatedDate", "Шинэчилсэн огноо", "2026-09-01"),
  ],

  studentConditionSave: [
    send("institutionId", "Байгууллагын код", INSTITUTION_ID),
    send("personId", "Хүүхдийн ESIS дугаар", "90000000000001"),
    send("dwellingTypeId", "Орон сууцны төрлийн код", "1"),
    send("ownershipTypeId", "Эзэмшлийн код", "1"),
    send("heatingTypeId", "Халаалтын код", "1"),
    send("waterSourceId", "Ус хангамжийн код", "1"),
    send("toiletTypeId", "Ариун цэврийн байгууламжийн код", "1"),
    send("electricityFlag", "Цахилгаантай эсэх", "true"),
    send("internetFlag", "Интернэттэй эсэх", "true"),
    send("roomCount", "Өрөөний тоо", "3"),
  ],

  teacherAcademicOrg: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("personId", "Багшийн ESIS дугаар", "80000000000001"),
    keep("academicOrgId", "Нэгжийн код", "3001"),
    keep("academicOrgName", "Заах аргын нэгдэл", "Сургуулийн өмнөх боловсролын нэгдэл"),
    keep("parentAcademicOrgId", "Дээд нэгжийн код", "3000"),
    keep("parentAcademicOrgName", "Дээд нэгж", "Сургалтын алба"),
    keep("positionName", "Албан тушаал", "Бүлгийн багш"),
    keep("beginDate", "Эхэлсэн огноо", "2024-09-01"),
    keep("endDate", "Дууссан огноо", "2027-06-01"),
  ],

  teacherMovements: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("personId", "Багшийн ESIS дугаар", "80000000000001"),
    keep("assignmentId", "Томилгооны дугаар", "60000000000001"),
    keep("movementTypeId", "Хөдөлгөөний код", "1"),
    keep("movementTypeName", "Хөдөлгөөний төрөл", "Томилогдсон"),
    keep("positionName", "Албан тушаал", "Бүлгийн багш"),
    keep("beginDate", "Эхэлсэн огноо", "2024-09-01"),
    keep("endDate", "Дууссан огноо", "2027-06-01"),
    keep("orderNumber", "Тушаалын дугаар", "А/128"),
    keep("familyName", "Ургийн овог", "Боржигин"),
    keep("lastName", "Овог", "Цэрэн"),
    keep("firstName", "Нэр", "Оюунчимэг"),
    keep("familyNameMgl", "Ургийн овог (монгол бичиг)", "Боржигин"),
    keep("firstNameMgl", "Нэр (монгол бичиг)", "Оюунчимэг"),
    keep("lastNameMgl", "Овог (монгол бичиг)", "Цэрэн"),
    keep("genderCode", "Хүйс", "F"),
    keep("genderName", "Хүйсийн нэр", "Эмэгтэй"),
    keep("dateOfBirth", "Төрсөн огноо", "1990-05-14"),
  ],

  groupsNextYear: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    // Наран бүлэг's own id, so this row *is* the first demo record — the
    // catalog sample and `OVERRIDES[0]` are asserted equal.
    keep("studentGroupId", "Бүлгийн код", GROUP_ID),
    keep("studentGroupName", "Бүлгийн нэр", "Наран бүлэг"),
    keep("academicYear", "Хичээлийн жил", "2027"),
    keep("academicLevel", "Түвшний код", "3"),
    keep("academicLevelName", "Түвшин", "Ахлах бүлэг"),
    keep("programOfStudyId", "Хөтөлбөрийн код", "501"),
    keep("programOfStudyName", "Хөтөлбөр", "Сургуулийн өмнөх боловсрол"),
    keep("studentCount", "Хүүхдийн тоо", "24"),
  ],

  programs: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("programOfStudyId", "Хөтөлбөрийн код", "501"),
    keep("programOfStudyName", "Хөтөлбөр", "Сургуулийн өмнөх боловсрол"),
    keep("programTypeName", "Хөтөлбөрийн төрөл", "Үндсэн"),
    keep("educationLevelName", "Боловсролын түвшин", "СӨБ"),
    keep("activeFlag", "Идэвхтэй эсэх", "true"),
  ],

  programStages: [
    keep("programOfStudyId", "Хөтөлбөрийн код", "501"),
    keep("programStageId", "Үе шатны код", "12"),
    keep("programStageName", "Үе шат", "Хоёрдугаар үе шат"),
    keep("sequence", "Дараалал", "2"),
    keep("academicLevel", "Түвшний код", "2"),
    keep("academicLevelName", "Түвшин", "Дунд бүлэг"),
  ],

  programPlans: [
    keep("programOfStudyId", "Хөтөлбөрийн код", "501"),
    keep("programStageId", "Үе шатны код", "12"),
    keep("programPlanId", "Төлөвлөгөөний код", "780"),
    keep("programPlanName", "Сургалтын төлөвлөгөө", "СӨБ-ын үндсэн хөтөлбөр"),
    keep("academicYear", "Хичээлийн жил", ACADEMIC_YEAR),
    keep("activeFlag", "Идэвхтэй эсэх", "true"),
  ],

  programCourses: [
    keep("programOfStudyId", "Хөтөлбөрийн код", "501"),
    keep("programStageId", "Үе шатны код", "12"),
    keep("programPlanId", "Төлөвлөгөөний код", "780"),
    keep("courseId", "Хичээлийн код", "9101"),
    keep("courseName", "Хичээл", "Хэл яриа хөгжүүлэх"),
    keep("courseCode", "Хичээлийн товч код", "HYA-01"),
    keep("subjectAreaId", "Судлагдахууны код", "41"),
    keep("subjectAreaName", "Судлагдахуун", "Хэл яриа"),
    keep("credit", "Кредит", "0"),
    keep("hours", "Цаг", "36"),
  ],

  rooms: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("buildingId", "Барилгын код", "20001"),
    keep("buildingName", "Барилга", "Үндсэн байр"),
    keep("roomId", "Өрөөний код", "30001"),
    keep("roomName", "Өрөөний нэр", "Наран бүлгийн танхим"),
    keep("roomNumber", "Өрөөний дугаар", "104"),
    keep("roomTypeId", "Өрөөний төрлийн код", "1"),
    keep("roomTypeName", "Өрөөний зориулалт", "Бүлгийн танхим"),
    keep("capacity", "Багтаамж", "25"),
    keep("area", "Талбай (м²)", "48.5"),
    keep("floor", "Давхар", "1"),
  ],

  academicOrg: [
    keep("institutionId", "Байгууллагын код", INSTITUTION_ID),
    keep("academicOrgId", "Нэгжийн код", "3001"),
    keep("academicOrgName", "Академик нэгж", "Сургуулийн өмнөх боловсролын нэгдэл"),
    keep("parentAcademicOrgId", "Дээд нэгжийн код", "3000"),
    keep("parentAcademicOrgName", "Дээд нэгж", "Сургалтын алба"),
    keep("academicOrgTypeName", "Нэгжийн төрөл", "Заах аргын нэгдэл"),
    keep("activeFlag", "Идэвхтэй эсэх", "true"),
  ],

  subjectAreas: [
    keep("subjectAreaId", "Судлагдахууны код", "41"),
    keep("subjectAreaName", "Судлагдахуун", "Хэл яриа"),
    keep("subjectAreaCode", "Товч код", "HY"),
    keep("parentSubjectAreaId", "Дээд судлагдахууны код", "40"),
    keep("educationLevelName", "Боловсролын түвшин", "СӨБ"),
  ],
};

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
   */
  studentCheck: "ADAPTER",
  studentContacts: "ADAPTER",
  studentContactsSave: "ADAPTER",
  studentStatistics: "ADAPTER",
  studentStatisticsSave: "ADAPTER",
  studentCondition: "ADAPTER",
  studentConditionSave: "ADAPTER",
  teacherAcademicOrg: "ADAPTER",
  teacherMovements: "ADAPTER",
  groupsNextYear: "ADAPTER",
  programs: "ADAPTER",
  programStages: "ADAPTER",
  programPlans: "ADAPTER",
  programCourses: "ADAPTER",
  rooms: "ADAPTER",
  academicOrg: "ADAPTER",
  subjectAreas: "ADAPTER",
};

/** Output names NomadKids keeps — the exact key set of the parsing schema. */
export function ingestedFieldNames(key: keyof typeof ESIS_ENDPOINTS): string[] {
  return ESIS_FIELDS[key]
    .filter((field) => field.io === "OUTPUT" && field.ingested)
    .map((field) => field.name);
}

/**
 * One illustrative row, for a service that has not been read yet.
 *
 * ★ Shaped exactly like a row from `EsisAdminService.read` so the UI renders
 * the demonstration through the same table as a live result — and so the two
 * can never drift into looking different by accident. It is the *caller's* job
 * to label it; this function has no way to.
 */
export function sampleRow(key: keyof typeof ESIS_ENDPOINTS): Record<string, string | null> {
  return Object.fromEntries(
    ESIS_FIELDS[key]
      .filter((field) => field.io === "OUTPUT" && field.ingested)
      .map((field) => [field.name, field.sample ?? null]),
  );
}
