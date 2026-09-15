import { Role } from "../../domain/enums";
import { ESIS_ENDPOINTS } from "./esis.endpoints";
import { ESIS_FIELDS, ESIS_FIELD_SOURCE } from "./esis.fields";
import { ESIS_READABLE_KEYS, esisReaderParams, type EsisReadableKey } from "./esis.service";
import { fieldMappings } from "./esis.mapping";
import { esisGrant, esisPortalRequest, esisRequestRegister } from "./esis.requests";

export type EsisEndpointKey = keyof typeof ESIS_ENDPOINTS;
/**
 * ★ `HEALTH` added 2026-09-14 with the twenty health, vaccine, measurement and
 * screening services. They would otherwise have gone under `ROSTER`, which is
 * where a child's name and group live — and a screen that files a вакцины
 * бүртгэл beside a бүлгийн жагсаалт tells an operator the two are the same
 * kind of fact. They are not: one is a medical record.
 */
export type EsisDomain = "ORGANIZATION" | "ROSTER" | "ATTENDANCE" | "FOOD" | "HEALTH";

/** Shared by the six services whose output contract has never been seen. */
const DISCOVERED_NOTE =
  "★ Энэ сервис институт 42778-ийн бүх 83 хүүхдэд `203` буцаасан тул гаралтын " +
  "талбарууд нь **тодорхойгүй**. Тиймээс баганыг зохиогоогүй — эхний бодит " +
  "хариу ирэхэд ЭСИС-ийн өөрийнх нь талбарын нэрсийг утгатай нь харуулна. " +
  "Ингэснээр 2026-09-14-нд 11 сервист илэрсэн «зохиосон талбарын жагсаалт» " +
  "алдааг давтахгүй.";

/** Shared by the three immunisation-registry services. */
const VACCINE_NOTE =
  "★★ **Тасалданги сервис.** 2026-09-14-нд нэг хүүхдэд 17 бодит вакцин " +
  "буцаасан бөгөөд нэг цагийн дараа яг тэр хүүхдэд `203` буцаав — ижил токен, " +
  "ижил байгууллага. Тиймээс хоосон хариуг **«вакцин хийлгээгүй» гэж " +
  "ойлгож болохгүй**: тэр нь хүүхдийн талаарх эмнэлгийн дүгнэлт болох бөгөөд " +
  "хариу өгөөгүй сервисээс гаргасан байх болно. «Мэдээлэл ирсэнгүй» гэж " +
  "харуулна. Талбарын нэр нь SCREAMING_CASE — өөр бүртгэлийн системээс ирдэг.";

/** Shared by the ten writes whose input contract cannot be observed. */
const WRITE_NOTE =
  "★ Бичих сервис. Доорх талбарууд нь гаралт биш, илгээх орц. **Орцын гэрээ " +
  "батлагдаагүй** — унших замаар орцыг мэдэх боломжгүй, тул эдгээр нь " +
  "холбогдох унших сервисээс гаргасан дүгнэлт. Зөвхөн хүний шууд үйлдлээр " +
  "илгээнэ, автоматаар хэзээ ч биш.";

interface EsisEndpointMeta {
  name: string;
  domain: EsisDomain;
  usage: string;
  /** Whether the multi-select dry-run may call it without operator input. */
  previewable: boolean;
  /** Shown beside the field table when the catalog decision needs a sentence. */
  note?: string;
}

const META: Record<EsisEndpointKey, EsisEndpointMeta> = {
  organization: {
    name: "Байгууллагын мэдээлэл",
    domain: "ORGANIZATION",
    usage: "Цэцэрлэгийн албан нэр, хаяг, ангилал",
    previewable: true,
  },
  buildings: {
    name: "Барилга байгууламж",
    domain: "ORGANIZATION",
    usage: "Цэцэрлэгийн барилга, зориулалт, багтаамж, эзэмшил",
    previewable: true,
  },
  academicYearStatuses: {
    name: "Хичээлийн жилийн төлөв",
    domain: "ORGANIZATION",
    usage: "Хичээлийн жил болон идэвхтэй хугацаа",
    previewable: true,
  },
  groups: {
    name: "Бүлгийн жагсаалт",
    domain: "ROSTER",
    usage: "Бүлэг, багшийн бүлэг, ирцийн roster",
    previewable: true,
  },
  students: {
    name: "Суралцагчийн жагсаалт",
    domain: "ROSTER",
    usage: "Хүүхэд болон элсэлтийн эхний тулгалт",
    previewable: true,
    note:
      "Суралцагчийн нэмэлт мэдээлэл — регистрийн дугаар, өрхийн байдал, эрүүл мэндийн " +
      "лавлагаа — ESIS_REQUEST.md §1.1 (b) ба §1.3-аар зориуд хүсээгүй. Тулгалтыг " +
      "`personId`-аар хийнэ.",
  },
  studentByRegister: {
    name: "Суралцагчийг РД-ээр хайх",
    domain: "ROSTER",
    usage: "Нэг хүүхдийг регистрийн дугаараар ESIS-ээс олох",
    previewable: false,
    note:
      "Регистрийн дугаарыг багш эсвэл эрхлэгч гараар бичиж **илгээнэ** — ESIS_REQUEST.md §1.1 (b) " +
      "нь регистрийн дугаарыг хүлээж авч хадгалахыг татгалзсан бөгөөд энэ нь тэр биш. " +
      "Буцаж ирсэн бичлэг API-000144-ийн output schema-аар хязгаарлагдана: " +
      "`civilId`, `personRegNumber` болон provider нууц үгийг авахгүй.",
  },
  studentInfo: {
    name: "Сурагчийн ерөнхий мэдээлэл",
    domain: "ROSTER",
    usage: "Нэг хүүхдийн ESIS дэх бүртгэл, регистрийн дугаараар",
    previewable: false,
    note:
      "Хүүхдийн бүртгэлд байгаа регистрийн дугаараар татна. Регистрийн дугаарыг " +
      "ESIS рүү илгээх ба ESIS-ээс авахгүй — ESIS_REQUEST.md §1.1 (b).",
  },
  groupStudents: {
    name: "Бүлгийн суралцагч",
    domain: "ROSTER",
    usage: "Нэг бүлгийн хүүхдийн тулгалт",
    previewable: false,
  },
  studentMovements: {
    name: "Суралцагчийн шилжилт",
    domain: "ROSTER",
    usage: "Элсэлт, шилжилт, гаралтын өөрчлөлт",
    previewable: false,
  },
  teachers: {
    name: "Багшийн жагсаалт",
    domain: "ROSTER",
    usage: "Багшийн эрх болон бүлгийн оноолт",
    previewable: true,
  },
  staff: {
    name: "Ажилтны жагсаалт",
    domain: "ROSTER",
    usage: "Эрхлэгч, эмч, тогооч, нягтлангийн бүртгэл",
    previewable: true,
  },
  groupAttendance: {
    name: "Бүлгийн ирцийн тулгалт",
    domain: "ATTENDANCE",
    usage: "Илгээсэн ирцийг ESIS-ээс буцааж шалгах",
    previewable: false,
    note: "Бүлэг болон огноог сонгосны дараа татна — ирцийн дэлгэц дээрээс шууд дуудна.",
  },
  saveAttendanceV3: {
    name: "Өдрийн ирц илгээх v3",
    domain: "ATTENDANCE",
    usage: "Баталгаажсан өдрийн ирцийг ESIS рүү илгээх",
    previewable: false,
    note: "Энэ бол цорын ганц бичих сервис. Доорх талбарууд нь гаралт биш, илгээх орц.",
  },
  foodProductTypes: {
    name: "Хоолны төрөл",
    domain: "FOOD",
    usage: "Хоолны нэгдсэн ангилал",
    previewable: true,
  },
  foodMaterialGroups: {
    name: "Хүнсний бүлэг",
    domain: "FOOD",
    usage: "Орц материалын нэгдсэн бүлэг",
    previewable: true,
  },
  foodMaterials: {
    name: "Хүнсний материал",
    domain: "FOOD",
    usage: "Орц, хэмжих нэгж, шимт бодис",
    previewable: true,
  },
  foodProducts: {
    name: "Хоол, бүтээгдэхүүн",
    domain: "FOOD",
    usage: "Бэлэн бүтээгдэхүүн болон хоолны лавлах",
    previewable: true,
  },
  foodProductMaterials: {
    name: "Технологийн картын орц",
    domain: "FOOD",
    usage: "Жорын орц, бохир болон цэвэр жин",
    previewable: true,
  },
  foodDiscountStudents: {
    name: "Хоолны хөнгөлөлттэй хүүхэд",
    domain: "FOOD",
    usage: "Төрийн хоолны хөнгөлөлтөд хамрагдах хүүхдийн жагсаалт",
    previewable: true,
    note: "ЯАМ-ын шийдвэр. Жагсаалтад байхгүй хүүхэд нь хөнгөлөлтгүй биш, дүгнэгдээгүй гэсэн үг.",
  },
  livelihoodForm1: {
    name: "Хоолны төвлөрүүлэх орлого — маягт 1",
    domain: "FOOD",
    usage: "Сарын нэгдсэн дүн: сурагчийн тоо, төвлөрүүлэх ба төвлөрүүлсэн орлого",
    previewable: false,
    note: "Жил, сарыг сонгосны дараа татна. Бичих сервис нь тусад нь — энд зөвхөн уншина.",
  },
  livelihoodForm2: {
    name: "Хоолны төвлөрүүлэх орлого — маягт 2",
    domain: "FOOD",
    usage: "Бүлгийн хүүхэд тус бүрийн ирц, төлөх ба төлсөн дүн",
    previewable: false,
    note: "Жил, сар, бүлгийг сонгосны дараа татна.",
  },
  foodKit: {
    name: "Иж бүрдлийн шимт бодис",
    domain: "FOOD",
    usage: "Бүтээгдэхүүний иж бүрдлийн тооцоо",
    previewable: false,
  },
  foodKitProducts: {
    name: "Иж бүрдлийн бүтээгдэхүүн",
    domain: "FOOD",
    usage: "Иж бүрдэлд орсон бүтээгдэхүүн",
    previewable: false,
  },

  /* ══ Added 2026-09-10 ═══════════════════════════════════════════════════ */

  studentCheck: {
    name: "ЭСИС-д бүртгэлтэй эсэх",
    domain: "ROSTER",
    usage: "Хүүхэд ЭСИС-д бүртгэлтэй эсэхийг шалгах",
    previewable: false,
    note:
      "★ Зам нь 2026-09-14-нд **баталгаажлаа**. Энэ мөр өмнө нь «эрх нь нээгдсэн " +
      "ч зам нь баталгаажаагүй» гэж байсан — амьд дуудлага хариулав: " +
      "`RESULT: \"true\"` ба тайлбар өгүүлбэр. `institutionId` заавал шаардана " +
      "(эс бөгөөс 400). ★★ Бүлэг, төлөв, элссэн огноо **буцаадаггүй** — тэр " +
      "гурав манай схемд байсан бөгөөд ESIS-д байхгүй.",
  },
  studentContacts: {
    name: "Хүүхдийн холбоо барих мэдээлэл",
    domain: "ROSTER",
    usage: "Нэг хүүхдийн асран хамгаалагч, тэдний утас, и-мэйл",
    previewable: false,
    note:
      "★ 2026-09-14: энэ нь **нэг хүүхдийн** лавлагаа, бүх бүртгэлийнх биш. " +
      "`personId`-г POST body-гоор илгээнэ — эс бөгөөс «personId шаардлагатай» " +
      "гэж 400 буцаана. ★★ Хариу нь нэрлэсэн жагсаалтуудын объект: `relInfo` " +
      "асран хамгаалагч, `rel*` тэдний холбоо барих хэрэгсэл, `contact*` " +
      "хүүхдийн өөрийнх. Мөр бүр аль жагсаалтаас ирснээ `section`-оор хэлнэ. " +
      "Регистрийн дугаар, иргэний бүртгэлийн дугаарыг авахгүй " +
      "(ESIS_REQUEST.md §1.1 (b)).",
  },
  studentContactsSave: {
    name: "Асран хамгаалагч илгээх",
    domain: "ROSTER",
    usage: "Хүүхдийн асран хамгаалагчийн мэдээллийг ЭСИС рүү илгээх",
    previewable: false,
    note: "Бичих сервис. Доорх талбарууд нь гаралт биш, илгээх орц.",
  },
  studentStatistics: {
    name: "Өрхийн мэдээлэл",
    domain: "ROSTER",
    usage: "Өрхийн бүрэлдэхүүн, амьжиргаа, халамжийн байдал",
    previewable: false,
  },
  studentStatisticsSave: {
    name: "Өрхийн мэдээлэл илгээх",
    domain: "ROSTER",
    usage: "Хүүхдийн өрхийн мэдээллийг ЭСИС рүү илгээх",
    previewable: false,
    note: "Бичих сервис. Доорх талбарууд нь гаралт биш, илгээх орц.",
  },
  studentCondition: {
    name: "Амьдрах орчин",
    domain: "ROSTER",
    usage: "Орон сууц, халаалт, ус, ариун цэврийн байгууламж",
    previewable: false,
  },
  studentConditionSave: {
    name: "Амьдрах орчин илгээх",
    domain: "ROSTER",
    usage: "Хүүхдийн амьдрах орчны мэдээллийг ЭСИС рүү илгээх",
    previewable: false,
    note: "Бичих сервис. Доорх талбарууд нь гаралт биш, илгээх орц.",
  },
  teacherAcademicOrg: {
    name: "Багшийн заах аргын нэгдэл",
    domain: "ROSTER",
    usage: "Багш аль заах аргын нэгдэлд харьяалагдахыг харуулна",
    previewable: false,
  },
  teacherMovements: {
    name: "Багшийн шилжилт хөдөлгөөн",
    domain: "ROSTER",
    usage: "Томилгоо, шилжилт, чөлөөлөлтийн бүртгэл",
    previewable: false,
  },
  groupsNextYear: {
    name: "Дараа жилийн бүлэг",
    domain: "ROSTER",
    usage: "Дараагийн хичээлийн жилд бүлэг хэрхэн бүрэлдэхийг ЭСИС-ээс харах",
    previewable: true,
    note:
      "Энэ бол `POST /v1/groups/:id/promotions` бүлэг ахиулахдаа эх сурвалж " +
      "болгох унших сервис. ★ Энэ мөр өмнө нь «бүлэг илгээх сервис порталын " +
      "каталогт байхгүй» гэж байсан — 2026-09-14-нд зөвшөөрөгдсөн сервисийн " +
      "жагсаалтад гурав байв: 150 (нэмэх), 152 (засах, устгах), 162 (багш " +
      "тохируулах). Хараахан холбоогүй байгаа нь өөр асуудал.",
  },
  programs: {
    name: "Сургалтын хөтөлбөр",
    domain: "ORGANIZATION",
    usage: "Байгууллагын сургалтын хөтөлбөрүүд",
    previewable: true,
  },
  programStages: {
    name: "Хөтөлбөрийн үе шат",
    domain: "ORGANIZATION",
    usage: "Хөтөлбөр доторх үе шат, түвшин",
    previewable: false,
    note: "Хөтөлбөрийн мөрөн дээр дарахад татагдана — :programOfStudyId шаардана.",
  },
  programPlans: {
    name: "Сургалтын төлөвлөгөө",
    domain: "ORGANIZATION",
    usage: "Үе шат тус бүрийн сургалтын төлөвлөгөө",
    previewable: false,
    note: "Үе шатны мөрөн дээр дарахад татагдана.",
  },
  programCourses: {
    name: "Төлөвлөгөөний хичээл",
    domain: "ORGANIZATION",
    usage: "Төлөвлөгөөнд багтсан хичээл, судлагдахуун, цаг",
    previewable: false,
    note: "Төлөвлөгөөний мөрөн дээр дарахад татагдана.",
  },
  rooms: {
    name: "Өрөөний жагсаалт",
    domain: "ORGANIZATION",
    usage: "Барилга доторх өрөө, зориулалт, багтаамж",
    previewable: true,
  },
  academicOrg: {
    name: "Академик нэгж",
    domain: "ORGANIZATION",
    usage: "Байгууллагын дотоод академик нэгж, заах аргын нэгдэл",
    previewable: true,
  },
  subjectAreas: {
    name: "Судлагдахууны чиглэл",
    domain: "ORGANIZATION",
    usage: "Хөтөлбөрийн хичээлүүдийн судлагдахууны лавлах",
    previewable: true,
  },

  /* ══ Added 2026-09-14 ═══════════════════════════════════════════════════
   *
   * ★ **None of these is `previewable`.** The operator dry-run calls a service
   * with no operator input, and every read below either needs a `personId`, a
   * group, a date or a register number. `vaccineCatalog` and
   * `screeningQuestions` are the two that take none — and they are still off
   * the list, because that list is the connection test and adding reference
   * lookups to it spends the deployment's rate limit proving nothing new.
   */

  studentAllergy: {
    name: "Харшлын мэдээлэл",
    domain: "HEALTH",
    usage: "Хүүхдийн харшлын ЭСИС дэх бүртгэл",
    previewable: false,
    note: DISCOVERED_NOTE,
  },
  studentProhibitedFood: {
    name: "Хориотой хүнс",
    domain: "HEALTH",
    usage: "Хүүхдэд хориотой хүнсний ЭСИС дэх бүртгэл",
    previewable: false,
    note: DISCOVERED_NOTE,
  },
  studentDisability: {
    name: "Хөгжлийн бэрхшээл",
    domain: "HEALTH",
    usage: "Хүүхдийн хөгжлийн бэрхшээлийн ЭСИС дэх бүртгэл",
    previewable: false,
    note: DISCOVERED_NOTE,
  },
  studentSurgery: {
    name: "Мэс заслын түүх",
    domain: "HEALTH",
    usage: "Хүүхдийн мэс заслын ЭСИС дэх бүртгэл",
    previewable: false,
    note: DISCOVERED_NOTE,
  },
  studentIncident: {
    name: "Осол гэмтэл",
    domain: "HEALTH",
    usage: "Хүүхдийн осол гэмтлийн ЭСИС дэх бүртгэл",
    previewable: false,
    note: DISCOVERED_NOTE,
  },
  studentScreening: {
    name: "Эрт илрүүлгийн хариу",
    domain: "HEALTH",
    usage: "Дунд бүлгийн хүүхдийн эрт илрүүлгийн бөглөсөн хариу",
    previewable: false,
    note: DISCOVERED_NOTE,
  },
  studentAssessments: {
    name: "Үзлэг, шинжилгээ",
    domain: "HEALTH",
    usage: "Хүүхдийн эмнэлгийн үзлэг, дүгнэлт, дараагийн үзлэгийн товлол",
    previewable: false,
    note:
      "Үзлэгийн төрөл, дүгнэлт нь ЭСИС-ийн код хэвээр ирнэ (COMPREHENSIVE_PHYSICAL, " +
      "HEALTHY) — тайлал нийтлэгдээгүй тул орчуулахгүй. Хавсралтын холбоос нь " +
      "ЭСИС-ийн хаяг бөгөөд эндээс татаж авахгүй (CLAUDE.md §1.4).",
  },
  studentMeasurements: {
    name: "Өсөлт, хөгжил",
    domain: "HEALTH",
    usage: "Хүүхдийн өндөр, жингийн ЭСИС дэх хэмжилт",
    previewable: false,
  },
  vaccineCatalog: {
    name: "Вакцины лавлах",
    domain: "HEALTH",
    usage: "Улсын хэмжээнд бүртгэлтэй вакцин, тун",
    previewable: false,
    note: VACCINE_NOTE,
  },
  vaccineHistory: {
    name: "Хийлгэсэн вакцин",
    domain: "HEALTH",
    usage: "Хүүхдийн хийлгэсэн вакцины түүх, эмнэлэг, цуврал дугаар",
    previewable: false,
    note: VACCINE_NOTE,
  },
  vaccinePlan: {
    name: "Товлолт вакцин",
    domain: "HEALTH",
    usage: "Хүүхдийн товлогдсон дараагийн вакцин",
    previewable: false,
    note: VACCINE_NOTE,
  },
  groupMeasurements: {
    name: "Бүлгийн хэмжилт",
    domain: "HEALTH",
    usage: "Нэг бүлгийн хүүхэд бүрийн өндөр, жин, бэлхүүс, ташаа",
    previewable: false,
    note:
      "★ Хүүхэд бүрээр нэг мөр буцаана — хэмжээгүй бол утгууд нь хоосон. Энэ нь " +
      "үр дүнгийн жагсаалт биш, сувилагчийн хэмжилт хийх хуудас. Бүлэг сонгосны " +
      "дараа татна.",
  },
  screeningQuestions: {
    name: "Эрт илрүүлгийн асуулга",
    domain: "HEALTH",
    usage: "Яамны эрт илрүүлгийн 25 асуулт",
    previewable: false,
    note:
      "★ Энэ бол хэмжих хэрэгсэл нь өөрөө. Дэргэд нь өөрсдийн асуулт зохиохгүй — " +
      "ирсэн 25 асуулт л хэмжинэ.",
  },
  schoolAttendance: {
    name: "Өдрийн ирцийн нэгдсэн дүн",
    domain: "ATTENDANCE",
    usage: "Бүлэг тус бүрийн өдрийн ирц, шалтгаанаар нь",
    previewable: false,
    note:
      "★ Хүүхэд тус бүрээр биш, **бүлэг тус бүрээр** нэг мөр. Аль бүлэг ирцээ " +
      "бүртгээгүйг эрхлэгч эндээс харна, мөн илгээсэн ирцийг ЭСИС талаас нь " +
      "тулгана. Жил, огноо сонгосны дараа татна.",
  },
  workerInfo: {
    name: "Ажилтны ерөнхий мэдээлэл",
    domain: "ROSTER",
    usage: "Регистрийн дугаараар ажилтныг ЭСИС-ээс олох",
    previewable: false,
    note:
      "★★ Энэ сервис **байгууллагаар хязгаарлагдахгүй** — `/svc/api/public/` " +
      "дор байх ба `institutionId` авдаггүй. Өөрөөр хэлбэл улсын боловсролын " +
      "санд байгаа ямар ч ажилтныг олно. Тухайн хүн энэ цэцэрлэгийнх мөн эсэхийг " +
      "`teacherCheck` баталгаажуулна. ★ Регистрийн дугаарыг ЭСИС рүү илгээнэ, " +
      "хадгалахгүй — буцаж ирсэн `civilId`, `personRegNumber`-ийг авахгүй " +
      "(ESIS_REQUEST.md §1.1 (b)).",
  },
  teacherProfile: {
    name: "Багшийн ерөнхий мэдээлэл",
    domain: "ROSTER",
    usage: "Багшийн албан тушаал, ажилласан жил, заах аргын нэгдэл",
    previewable: false,
  },
  teacherCheck: {
    name: "Энэ байгууллагын багш эсэх",
    domain: "ROSTER",
    usage: "Тухайн хүн энэ цэцэрлэгт багшаар ажилладаг эсэхийг шалгах",
    previewable: false,
    note:
      "`institutionId` заавал шаардана (эс бөгөөс 400). Хариу нь `[\"false\"]` — " +
      "`studentCheck`-тэй адил скаляр.",
  },

  /* ── Бичих сервисүүд ──────────────────────────────────────────────────── */
  studentAllergySave: {
    name: "Харшил илгээх",
    domain: "HEALTH",
    usage: "Хүүхдийн харшлын мэдээллийг ЭСИС рүү илгээх",
    previewable: false,
    note: WRITE_NOTE,
  },
  studentProhibitedFoodSave: {
    name: "Хориотой хүнс илгээх",
    domain: "HEALTH",
    usage: "Хүүхдэд хориотой хүнсний мэдээллийг ЭСИС рүү илгээх",
    previewable: false,
    note: WRITE_NOTE,
  },
  studentDisabilitySave: {
    name: "Хөгжлийн бэрхшээл илгээх",
    domain: "HEALTH",
    usage: "Хүүхдийн хөгжлийн бэрхшээлийн мэдээллийг ЭСИС рүү илгээх",
    previewable: false,
    note: WRITE_NOTE,
  },
  studentAssessmentsSave: {
    name: "Үзлэг, шинжилгээ илгээх",
    domain: "HEALTH",
    usage: "Хүүхдийн эмнэлгийн үзлэгийн дүгнэлтийг ЭСИС рүү илгээх",
    previewable: false,
    note: WRITE_NOTE,
  },
  studentMeasurementSave: {
    name: "Өсөлт, хөгжил илгээх",
    domain: "HEALTH",
    usage: "Нэг хүүхдийн өндөр, жинг ЭСИС рүү илгээх",
    previewable: false,
    note: WRITE_NOTE,
  },
  studentSurgerySave: {
    name: "Мэс засал илгээх",
    domain: "HEALTH",
    usage: "Хүүхдийн мэс заслын мэдээллийг ЭСИС рүү илгээх",
    previewable: false,
    note: WRITE_NOTE,
  },
  studentIncidentSave: {
    name: "Осол гэмтэл илгээх",
    domain: "HEALTH",
    usage: "Хүүхдийн осол гэмтлийн мэдээллийг ЭСИС рүү илгээх",
    previewable: false,
    note: WRITE_NOTE,
  },
  groupMeasurementsSave: {
    name: "Бүлгийн хэмжилт илгээх",
    domain: "HEALTH",
    usage: "Бүлгийн хүүхэд бүрийн хэмжилтийг нэг дор ЭСИС рүү илгээх",
    previewable: false,
    note: WRITE_NOTE,
  },
  studentScreeningSave: {
    name: "Эрт илрүүлгийн хариу илгээх",
    domain: "HEALTH",
    usage: "Дунд бүлгийн хүүхдийн эрт илрүүлгийн хариултыг ЭСИС рүү илгээх",
    previewable: false,
    note: WRITE_NOTE,
  },
  studentAttachmentSave: {
    name: "Үзлэгийн хавсралт илгээх",
    domain: "HEALTH",
    usage: "Эмнэлгийн үзлэгийн хавсралт файлыг ЭСИС рүү илгээх",
    previewable: false,
    note:
      "★ **Дэлгэц байхгүй, зориуд.** Хүүхдийн эмнэлгийн баримтыг гуравдагч " +
      "байгууллага руу илгээх нь товчлуур биш, зөвшөөрлийн шийдвэр " +
      "(CLAUDE.md §1.4). Каталогт байгаа нь эрх нээлттэйг харуулахын тулд.",
  },
};

const READABLE = new Set<string>(ESIS_READABLE_KEYS);

const isReadable = (key: EsisEndpointKey): key is EsisReadableKey => READABLE.has(key);

/**
 * One row per service, carrying everything the operator screen shows.
 *
 * ★ `fields` is the point of this file now. Before a token exists the count,
 * the names and the refusals are the *only* answer to "what comes back?", and
 * an operator who can see them can check them against the developer portal
 * without our help. `params` tells the screen which services need a group or a
 * date before the button can do anything.
 *
 * ★★ **`sampleRow` and `sampleRows` are gone — 2026-09-14**, at the client's
 * instruction: "odoonoos demo zuil ashiglahgui. buh zuil esis ees baih ystoi.
 * data irehgui baigaa bol teriig aldaa nii message eer haruulah."
 *
 * They carried invented records that every ESIS surface fell back to when a
 * read had not happened or had failed. That was defensible while the token had
 * no scope and the screens could not be shown any other way; it stopped being
 * defensible the day institution 42778 started answering, because from then on
 * the only thing a fabricated row could do was hide a live failure behind
 * something that looked like data.
 *
 * What replaces them is `EsisNoAnswer`: the endpoint that did not answer, and
 * why. `fields` stays — the contract is a real fact about the service and is
 * not invented.
 */
export const ESIS_RESOURCE_CATALOG = (Object.keys(ESIS_ENDPOINTS) as EsisEndpointKey[]).map(
  (key) => ({
    key,
    ...ESIS_ENDPOINTS[key],
    ...META[key],
    fields: ESIS_FIELDS[key],
    fieldSource: ESIS_FIELD_SOURCE[key],
    /*
     * ★ Whether the ministry has granted this service, and under what name.
     *
     * Derived from the deployment's request register by `apiId` rather than
     * written out per service: a hand-kept status on 40-odd rows is a second
     * copy of the portal's answer, and the copy is what goes stale. A service
     * whose id is not in the register reads `NOT_REQUESTED`, which is the
     * honest answer for one the client asked for before the request was filed.
     *
     * ★★ `portalName` is the register's own name for the id. It is what lets
     * an operator check a row against the portal without our help — and it is
     * how `studentInfo`'s wrong id was caught: the name beside 147 was a milk
     * service.
     */
    grant: esisGrant(ESIS_ENDPOINTS[key].apiId),
    portalName: esisPortalRequest(ESIS_ENDPOINTS[key].apiId)?.name ?? null,
    ingestedFieldCount: ESIS_FIELDS[key].filter((field) => field.io === "OUTPUT" && field.ingested)
      .length,
    /*
     * ★ Which way the data moves, from **readability** rather than from the
     * HTTP verb.
     *
     * The two agreed on every service until `studentContacts` — "Гэр бүлийн
     * мэдээлэл лавлах" — turned out to be a lookup the ministry exposes over
     * POST (`esis.endpoints.ts`, proven by probe). Deriving this from `method`
     * would have flipped that row to "NomadKids → ESIS" on the operator
     * screen: a service that only ever reads, reported as one that writes, on
     * the one screen an operator checks before granting access.
     *
     * `readable` below is the same predicate and is the honest one — a service
     * is a read because we registered a reader and a schema for it, not
     * because of the verb it happens to travel over.
     */
    direction: isReadable(key) ? ("ESIS_TO_NOMADKIDS" as const) : ("NOMADKIDS_TO_ESIS" as const),
    targetModel: targetModel(key),
    mappings: fieldMappings(key, ESIS_FIELDS[key]),
    readable: isReadable(key),
    params: isReadable(key) ? [...esisReaderParams(key)] : [],
  }),
);

function targetModel(key: EsisEndpointKey): string {
  if (key === "organization") return "Kindergarten";
  if (key === "academicYearStatuses") return "SchoolYear";
  if (key === "groups") return "Group / GroupTeacher";
  if (key === "students" || key === "studentByRegister" || key === "groupStudents") {
    return "Child / Enrollment";
  }
  if (key === "studentMovements") return "Enrollment";
  if (key === "teachers" || key === "staff") return "User / Membership";
  if (key === "groupAttendance" || key === "saveAttendanceV3") return "Attendance";
  if (key === "foodProducts") return "Recipe ESIS reference (DISPLAY_ONLY)";

  /* ── Added 2026-09-10 ──────────────────────────────────────────────────── */
  if (key === "studentCheck") return "Child / Enrollment";
  if (key === "studentContacts" || key === "studentContactsSave") {
    return "Guardian / Guardianship";
  }
  if (
    key === "studentStatistics" ||
    key === "studentStatisticsSave" ||
    key === "studentCondition" ||
    key === "studentConditionSave"
  ) {
    // No column holds these yet: they are shown beside the child's record and
    // sent back, never stored. A `Child` field for "өрхийн төрөл" is a schema
    // decision nobody has asked for, and inventing one here would make the
    // mapping table claim a home that does not exist.
    return "Child ESIS reference (NOT STORED)";
  }
  if (key === "teacherAcademicOrg" || key === "teacherMovements") return "User / Membership";
  if (key === "groupsNextYear") return "Group (promotion source)";
  if (
    key === "programs" ||
    key === "programStages" ||
    key === "programPlans" ||
    key === "programCourses"
  ) {
    return "Curriculum reference (DISPLAY_ONLY)";
  }
  if (key === "rooms") return "Kindergarten premises (DISPLAY_ONLY)";
  if (key === "academicOrg" || key === "subjectAreas") return "Reference (DISPLAY_ONLY)";

  /* ── Added 2026-09-14 ────────────────────────────────────────────────── */

  if (key === "studentAllergy" || key === "studentAllergySave") return "AllergyRecord";
  /*
   * ★ Хориотой хүнс is an `AllergyRecord` too. The RFP's Module 2 cross-check
   * asks one question — "may this child eat what is on the menu?" — and a
   * dietary restriction that is not an allergy still answers it. A second table would
   * mean the kitchen screen had two lists to consult and one of them would
   * eventually be forgotten.
   */
  if (key === "studentProhibitedFood" || key === "studentProhibitedFoodSave") {
    return "AllergyRecord";
  }
  if (key === "studentDisability" || key === "studentDisabilitySave") return "SpecialNeedRecord";
  if (key === "studentIncident" || key === "studentIncidentSave") return "SafetyIncident";
  if (
    key === "studentMeasurements" ||
    key === "studentMeasurementSave" ||
    key === "groupMeasurements" ||
    key === "groupMeasurementsSave"
  ) {
    return "GrowthMeasurement";
  }
  if (key === "vaccineHistory" || key === "vaccinePlan") return "VaccinationRecord";
  if (key === "vaccineCatalog") return "Vaccine reference (DISPLAY_ONLY)";
  if (
    key === "studentScreening" ||
    key === "studentScreeningSave" ||
    key === "screeningQuestions"
  ) {
    return "Survey / SurveyResponse";
  }
  /*
   * ★ No column holds a ministry consultation record. `ChildProfile` carries
   * this kindergarten's own health notes, and an ESIS үзлэг is a different
   * fact with a different author — merging them would make it impossible to
   * say later which of the two a nurse had actually read.
   */
  if (key === "studentAssessments" || key === "studentAssessmentsSave") {
    return "Child ESIS reference (NOT STORED)";
  }
  if (key === "studentSurgery" || key === "studentSurgerySave") {
    return "Child ESIS reference (NOT STORED)";
  }
  if (key === "studentAttachmentSave") return "MediaFile (NO SCREEN)";
  if (key === "schoolAttendance") return "Attendance";
  if (key === "workerInfo" || key === "teacherProfile" || key === "teacherCheck") {
    return "User / Membership / StaffRecord";
  }

  return "Ingredient / Recipe (NOT ENABLED)";
}

export const ESIS_PREVIEW_RESOURCES = [
  "organization",
  "buildings",
  "academicYearStatuses",
  "groups",
  "students",
  "teachers",
  "staff",
  "foodProductTypes",
  "foodMaterialGroups",
  "foodMaterials",
  "foodProducts",
  "foodProductMaterials",
  /*
   * Added 2026-09-10 — the institution-level reads that need no operator input.
   *
   * ★ `studentContacts` was one of them and is **not** — removed 2026-09-14.
   * It is a per-child lookup that takes `{ personId }` in its POST body, proven
   * live: without one it answers `400 personId шаардлагатай`. It was listed
   * here because the catalog described it as the whole roster's guardians,
   * which it never was, so the dry-run this list drives had a guaranteed
   * failure in it. It is reached from a child's own record instead.
   */
  "groupsNextYear",
  "programs",
  "rooms",
  "academicOrg",
  "subjectAreas",
] as const satisfies readonly EsisEndpointKey[];

/**
 * Which ESIS services each role may see, and read.
 *
 * ★ A role gets the services its own screens draw, and nothing else — this is
 * the list, not a filter applied on the way out. The overview at
 * `/platform/[id]/esis` is the operator's whole-catalog view and is
 * `@SuperAdmin()` as of 2026-09-14 — it was `@Roles("ADMIN")`, and the move is
 * the reason this map matters more than it did: a director's ESIS capability is
 * now entirely what their screens draw, which is what this list has always
 * described. A teacher's screens need sixteen of the catalog and have no
 * business knowing the token's state, the deployment's base URL or which
 * kindergarten has been mapped.
 *
 * ★★ Absent means none. A parent holds a membership and reaches no ESIS
 * service at all, so the lookup returns an empty list and the endpoint answers
 * 404 — the same answer a stranger gets, per CLAUDE.md §1.7.
 *
 * ★★★ ADMIN is deliberately not listed. It takes every key, and writing them
 * out would be a second catalog to keep in step with the first.
 */
const ROLE_SERVICES: Partial<Record<Role, readonly EsisEndpointKey[]>> = {
  /*
   * The teacher's six, named by the client on 2026-09-09:
   *
   *   students          суралцагчийн ерөнхий мэдээлэл
   *   studentByRegister суралцагчийг РД-аар хайх
   *   groupStudents     бүлгийн сурагчийн ерөнхий мэдээлэл
   *   saveAttendanceV3  ирц хадгалах — the one write service
   *   groupAttendance   ирц харах
   *   teachers          багшийн ерөнхий мэдээлэл
   */
  [Role.TEACHER]: [
    "students",
    "groupStudents",
    /*
     * ★ Added 2026-09-09: "регистрээр нь хайж болдог байх бас".
     *
     * The number is typed by the teacher from the document in front of them
     * and sent; `personRegNumber` stays a refused *output* here as on every
     * roster service, and `read` keeps it out of the audit row. Giving a
     * teacher the search does not give them a register number — it lets them
     * use one they already hold.
     */
    "studentByRegister",
    "studentInfo",
    "saveAttendanceV3",
    "groupAttendance",
    "teachers",
    /*
     * ★ Added 2026-09-10, with the screens that draw them.
     *
     * The five суралцагч services sit on a child's own record — the guardian
     * block, the household and living-condition sections beneath it, and the
     * movement history on Суралцсан түүх. A teacher already reaches all of
     * those screens through `canAccessChild`, and a service a role's screens
     * draw is exactly what this list is for.
     *
     * ★★ The three writes are here because the teacher is who fills them in.
     * `studentContactsSave` without `studentContacts` would be a form with
     * nothing to correct; the read and its write travel together or neither
     * is useful.
     *
     * ★★★ `teacherAcademicOrg` is the teacher's *own* заах аргын нэгдэл on
     * `/settings`, beside the profile `my-profile` already draws.
     * `teacherMovements` is deliberately absent: it is the whole staff's
     * appointment history, which is a director's question, and it stays
     * ADMIN-only on `/admin/users`.
     */
    "studentMovements",
    "studentCheck",
    "studentContacts",
    "studentContactsSave",
    "studentStatistics",
    "studentStatisticsSave",
    "studentCondition",
    "studentConditionSave",
    "teacherAcademicOrg",
    /*
     * ★ Added 2026-09-14, and the split is per service rather than per block.
     *
     * A teacher gets the three facts the day depends on — харшил, хориотой
     * хүнс, хөгжлийн бэрхшээл — because a child who must not eat something is
     * classroom information, and `child-health.tsx` already draws those
     * sections for staff.
     *
     * ★★ Үзлэг, мэс засал and the two вакцин services are **not** here. A
     * consultation result, a surgical history and a vaccine serial number are
     * a medical record; no screen a teacher opens draws them, and a role gets
     * the services its own screens draw. They stay ADMIN-only.
     *
     * ★★★ The two measurement reads are a teacher's because a teacher runs
     * the measuring session, and `groupMeasurements` is group-shaped with no
     * medical detail in it at all.
     */
    "studentAllergy",
    "studentProhibitedFood",
    "studentDisability",
    "studentMeasurements",
    "groupMeasurements",
    "vaccineCatalog",
    /*
     * The writes that pair with the reads above. A form with nothing to
     * correct is the failure mode the 2026-09-10 note warned about: a read and
     * its write travel together or neither is useful.
     */
    "studentAllergySave",
    "studentProhibitedFoodSave",
    "studentDisabilitySave",
    "studentMeasurementSave",
    "groupMeasurementsSave",
    /* Ирцийн өдрийн нэгдсэн дүн — the teacher's own day sheet, verified. */
    "schoolAttendance",
  ],
  /*
   * The cook's seven — every `cook/*` read in the catalog.
   *
   * ★ This began as one, `foodProducts`, with a note saying the other six
   * "stay off this list until they are asked for". They were asked for later
   * the same day — "тогоочид хамаарах бусад API-уудыг дууд ашигла" — so the
   * note is replaced rather than deleted. The principle it stated still holds
   * and still decides the two below it: a role gets the services its own
   * screens draw.
   *
   * ★★ `foodKit` and `foodKitProducts` take `:productId` and have **no panel
   * of their own**. `EsisDataPanel` asks the reader to type a missing path
   * parameter, and a cook typing a ministry product code into a box is not a
   * feature. They are reachable only as the drill-down of a `foodProducts`
   * row, which supplies the id — the grant is what makes that read legal.
   *
   * ★★★ The two `POST cook/form1|form2 …/save` services are still absent, for
   * the reason `esis.endpoints.ts` gives: nothing here files a school's income
   * return. Granting a role a write it has no screen for is how a scope
   * request grows past what the product can honestly use.
   */
  [Role.COOK]: [
    "foodProductTypes",
    "foodMaterialGroups",
    "foodMaterials",
    "foodProducts",
    "foodProductMaterials",
    "foodKit",
    "foodKitProducts",
  ],
  /*
   * The accountant's two: "хоолны төвлөрүүлэх орлого маягт 1, 2" — the school's
   * monthly food-income statement and its per-child breakdown.
   *
   * ★ Read only. The catalog carries `POST /cook/form1/…/save` and its form-2
   * twin, and neither is here: filing a school's income return is a decision
   * made against a ledger, and nothing in this product is yet the thing that
   * files it. When it is, they arrive the way `saveAttendanceV3` did.
   */
  /*
   * ★ `foodDiscountStudents` joined the accountant's list on 2026-09-14, and
   * it is the first entry here that names children rather than totals.
   *
   * That is the point of it: `нэмэлт.md` §3 asks for a meal cost split by
   * source, and a split needs to know which children the state pays for. The
   * two forms above give a month's totals and cannot answer it.
   *
   * ★★ **Not the cook's**, although every other `cook/*` read is. A cook plans
   * meals and orders food; who the state subsidises changes no quantity they
   * work with, and it is a fact about a family's circumstances. Least
   * privilege puts it with the role that prices the month.
   */
  [Role.ACCOUNTANT]: ["livelihoodForm1", "livelihoodForm2", "foodDiscountStudents"],
};

/** Every service key, for the role that gets all of them. */
const ALL_KEYS = Object.keys(ESIS_ENDPOINTS) as EsisEndpointKey[];

/** Portal id → the catalog key that calls it. */
const WIRED_API_IDS: ReadonlyMap<number, string> = new Map(
  ALL_KEYS.flatMap((key) => {
    const { apiId } = ESIS_ENDPOINTS[key];
    return apiId === null ? [] : [[apiId, key] as [number, string]];
  }),
);

/**
 * The deployment's ESIS grants, joined against the services this product calls.
 *
 * ★ This is the platform operator's answer to "хэдэн хүсэлт зөвшөөрөгдсөн,
 * хэдийг ашиглаж байна" — 96 requests on the portal, of which the catalog
 * above calls a known number. It is computed, never maintained: add a service
 * to `ESIS_ENDPOINTS` with its id and the count moves on its own.
 *
 * ★★ It belongs to the **platform**, not to a kindergarten. The token, the
 * base URL and the granted scope are one deployment's properties — one ESIS
 * developer account serves every tenant — so a director cannot act on any of
 * it. `PlatformEsisController` is where it is served, beside the institution
 * mapping that was already superadmin-only.
 */
export const ESIS_REQUEST_REGISTER = esisRequestRegister(WIRED_API_IDS);

/**
 * The services this actor may see in this kindergarten, in catalog order.
 *
 * Roles are read from the actor's memberships *in that kindergarten* rather
 * than globally: a teacher at one kindergarten and an admin at another gets the
 * teacher's six here and the whole catalog there.
 */
export function esisServicesForActor(
  actor: { memberships: readonly { kindergartenId: string; role: Role }[] },
  kindergartenId: string,
): EsisEndpointKey[] {
  const roles = actor.memberships
    .filter((membership) => membership.kindergartenId === kindergartenId)
    .map((membership) => membership.role);

  if (roles.includes(Role.ADMIN)) return ALL_KEYS;

  const allowed = new Set(roles.flatMap((role) => ROLE_SERVICES[role] ?? []));
  return ALL_KEYS.filter((key) => allowed.has(key));
}
