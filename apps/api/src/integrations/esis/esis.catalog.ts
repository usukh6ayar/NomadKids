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
    name: "Регистрээр хайх",
    domain: "ROSTER",
    usage: "Нэг хүүхдийг регистрийн дугаараар ESIS-ээс олох",
    previewable: false,
    note:
      "Регистрийн дугаарыг эрхлэгч гараар бичиж **илгээнэ** — ESIS_REQUEST.md §1.1 (b) " +
      "нь регистрийн дугаарыг хүлээж авч хадгалахыг татгалзсан бөгөөд энэ нь тэр биш. " +
      "Буцаж ирсэн бичлэг `students`-ийн ижил талбаруудаар хязгаарлагдана: " +
      "`personRegNumber` энд ч мөн адил авахгүй талбар.",
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
  if (key === "students" || key === "groupStudents") return "Child / Enrollment";
  if (key === "studentMovements") return "Enrollment";
  if (key === "teachers" || key === "staff") return "User / Membership";
  if (key === "groupAttendance" || key === "saveAttendanceV3") return "Attendance";
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
] as const satisfies readonly EsisEndpointKey[];

/**
 * Which ESIS services each role may see, and read.
 *
 * ★ A role gets the services its own screens draw, and nothing else — this is
 * the list, not a filter applied on the way out. The overview at
 * `/admin/integrations/esis` is the operator's whole-catalog view and stays
 * `@Roles("ADMIN")`; a teacher's screens need five of the eighteen and have no
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
   * The teacher's five, named by the client on 2026-09-09:
   *
   *   students          суралцагчийн ерөнхий мэдээлэл
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
  ],
  /*
   * The cook's one, named 2026-09-09: "бэлэн бүтээгдэхүүн" — the ministry's
   * finished-dish reference (`cook/product`), which a technology card is
   * written against. The other six food services stay off this list until they
   * are asked for; a role gets the services its own screens draw.
   */
  [Role.COOK]: ["foodProducts"],
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
 * teacher's five here and the whole catalog there.
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
