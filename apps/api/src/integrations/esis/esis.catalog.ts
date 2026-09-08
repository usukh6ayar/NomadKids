import { ESIS_ENDPOINTS } from "./esis.endpoints";
import { ESIS_FIELDS, ESIS_FIELD_SOURCE, sampleRow } from "./esis.fields";
import { ESIS_READABLE_KEYS, esisReaderParams, type EsisReadableKey } from "./esis.service";

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
    readable: isReadable(key),
    params: isReadable(key) ? [...esisReaderParams(key)] : [],
  }),
);

export const ESIS_PREVIEW_RESOURCES = [
  "organization",
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
