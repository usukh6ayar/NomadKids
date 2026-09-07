import { ESIS_ENDPOINTS } from "./esis.endpoints";

export type EsisEndpointKey = keyof typeof ESIS_ENDPOINTS;
export type EsisDomain = "ORGANIZATION" | "ROSTER" | "ATTENDANCE" | "FOOD";

interface EsisEndpointMeta {
  name: string;
  domain: EsisDomain;
  usage: string;
  previewable: boolean;
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
  },
  saveAttendanceV3: {
    name: "Өдрийн ирц илгээх v3",
    domain: "ATTENDANCE",
    usage: "Баталгаажсан өдрийн ирцийг ESIS рүү илгээх",
    previewable: false,
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

export const ESIS_RESOURCE_CATALOG = (Object.keys(ESIS_ENDPOINTS) as EsisEndpointKey[]).map(
  (key) => ({ key, ...ESIS_ENDPOINTS[key], ...META[key] }),
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
