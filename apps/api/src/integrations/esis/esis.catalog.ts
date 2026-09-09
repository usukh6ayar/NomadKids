import { Role } from "../../domain/enums";
import { ESIS_ENDPOINTS } from "./esis.endpoints";
import { ESIS_FIELDS, ESIS_FIELD_SOURCE, sampleRow } from "./esis.fields";
import { sampleRows } from "./esis.samples";
import { ESIS_READABLE_KEYS, esisReaderParams, type EsisReadableKey } from "./esis.service";
import { fieldMappings } from "./esis.mapping";

export type EsisEndpointKey = keyof typeof ESIS_ENDPOINTS;
export type EsisDomain = "ORGANIZATION" | "ROSTER" | "ATTENDANCE" | "FOOD";

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
    usage: "Хүүхэд ЭСИС-д бүртгэлтэй эсэх, ямар бүлэгт байгааг шалгах",
    previewable: false,
    note:
      "★ Порталын нээлттэй каталогт **баталгаажаагүй**. Тэнд байгаа цорын ганц " +
      "`check` сервис нь `api-11` — багшийнх (`teacher/check/:personId`). " +
      "Суралцагчийн хэсэг нээлттэй хуудсанд ачаалагддаггүй тул «байхгүй» гэж " +
      "дүгнэх ч боломжгүй. Token ирэхэд эхний дуудлагаар тодорно.",
  },
  studentContacts: {
    name: "Асран хамгаалагчийн жагсаалт",
    domain: "ROSTER",
    usage: "Цэцэрлэгийн бүх хүүхдийн асран хамгаалагчийн холбоо барих мэдээлэл",
    previewable: true,
    note:
      "Регистрийн дугаар, иргэний бүртгэлийн дугаарыг авахгүй — эцэг эхийн утас " +
      "харуулахад үндэсний дугаар шаардлагагүй (ESIS_REQUEST.md §1.1 (b)).",
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
      "★ Бүлэг ИЛГЭЭХ сервис порталын каталогт байхгүй тул зохиогоогүй. Энэ бол " +
      "`POST /v1/groups/:id/promotions` бүлэг ахиулахдаа эх сурвалж болгох унших " +
      "сервис.",
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
 * ★★ `sampleRows` is every demo record; `sampleRow` is the first of them, kept
 * because two callers want exactly one — the child-registration template and
 * "my ESIS profile" describe one person, not a roster.
 */
export const ESIS_RESOURCE_CATALOG = (Object.keys(ESIS_ENDPOINTS) as EsisEndpointKey[]).map(
  (key) => ({
    key,
    ...ESIS_ENDPOINTS[key],
    ...META[key],
    fields: ESIS_FIELDS[key],
    fieldSource: ESIS_FIELD_SOURCE[key],
    ingestedFieldCount: ESIS_FIELDS[key].filter((field) => field.io === "OUTPUT" && field.ingested)
      .length,
    sampleRow: sampleRow(key),
    sampleRows: sampleRows(key),
    direction:
      ESIS_ENDPOINTS[key].method === "GET"
        ? ("ESIS_TO_NOMADKIDS" as const)
        : ("NOMADKIDS_TO_ESIS" as const),
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
  // Added 2026-09-10 — the institution-level reads that need no operator input.
  "studentContacts",
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
 * `/admin/integrations/esis` is the operator's whole-catalog view and stays
 * `@Roles("ADMIN")`; a teacher's screens need six of the catalog and have no
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
  [Role.ACCOUNTANT]: ["livelihoodForm1", "livelihoodForm2"],
};

/** Every service key, for the role that gets all of them. */
const ALL_KEYS = Object.keys(ESIS_ENDPOINTS) as EsisEndpointKey[];

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
