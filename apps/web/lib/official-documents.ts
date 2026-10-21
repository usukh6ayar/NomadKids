/**
 * Яамны хөтөлбөр, журам — the official preschool documents every kindergarten's
 * staff can open, 2026-10-20, the user: "ачаалал үүсгэхгүй ... дарахаар шууд
 * линк орж pdf нээгдээд татаж болдог".
 *
 * ★ A list in the code, links out. Nothing is stored, uploaded or proxied:
 * a card is an `<a target="_blank">` to the official source, so a download is
 * the source site's traffic, never the VPS's. Adding a document is an edit
 * here and a web deploy.
 *
 * ★★ The register's own warning (sob-documents.json, as of 2026-10-19):
 * every entry is `requires_final_verification`, so nothing here may say
 * «хүчин төгөлдөр»; and a `notice`/`index` source is not the document itself,
 * so its card must not read as one — `actionLabel` follows `display_action`.
 */

/** How close the link is to the document — the register's `source_level`. */
export type OfficialSourceLevel =
  /** The PDF itself, from its publisher — added 2026-10-20 for mnier.mn's files. */
  | "official_pdf"
  | "official_full_text"
  | "official_repository_page"
  | "official_notice_only"
  | "official_index_only";

export type OfficialAudience = "Эрхлэгч" | "Арга зүйч" | "Багш";

export interface OfficialDocument {
  id: string;
  category: string;
  title: string;
  year: number;
  number: string | null;
  url: string;
  sourceLevel: OfficialSourceLevel;
  /** The original not yet matched — the card says so in grey. */
  reviewRequired: boolean;
  audience: OfficialAudience[];
  notes: string;
  checkedOn: string;
  actionLabel: "PDF нээх" | "Албан эхийг нээх" | "Эх сурвалж үзэх";
  /** The PDF's first page, rendered once into `public/official-covers/` — null draws one. */
  cover: string | null;
  /** «Онцлох» — shown first, with a badge (2026-10-20, the user). */
  featured: boolean;
}

/**
 * ★ Онцлох in the shipped list: the 2025 curriculum a teacher plans from, and
 * А/79, the assessment this product records. The operator changes it in the
 * form once the API exists.
 */
const FEATURED = new Set(["SOB-007", "SOB-005"]);

/**
 * ★ The PDFs whose first page ships as a picture — 2026-10-20, the user: "нүүр
 * хэсэг зургаар". Rendered once with `pdftoppm -f 1 -l 1 -scale-to-x 480 -jpeg`
 * (about 25 KB each) and served as static files: no request to the source, no
 * storage. A source without a PDF has no first page and keeps the drawn cover.
 */
const COVERS = new Set([
  "SOB-007",
  "SOB-037",
  "SOB-009",
  "SOB-010",
  "SOB-011",
  "SOB-012",
  // The ministry's own PDFs found on its pages, 2026-10-20 — first pages checked by eye.
  "SOB-013",
  "SOB-026",
  "SOB-027",
  "SOB-033",
  "SOB-034",
  "SOB-035",
  "SOB-036",
]);

/** The day the register was last checked against its sources. */
export const OFFICIAL_DOCUMENTS_AS_OF = "2026-10-19";

/** The register's categories, in the order the shelf offers them. */
export const OFFICIAL_CATEGORIES = [
  "Хууль",
  "Дүрэм, журам",
  "Сургалтын хөтөлбөр",
  "Аргачлал",
  "Гарын авлага",
  "Тогтоол",
  "Норматив",
  "Жагсаалт",
  "Стандарт",
  "Барилгын норм",
  "Бодлогын чиглэл",
] as const;

const ALL: OfficialAudience[] = ["Эрхлэгч", "Арга зүйч", "Багш"];
const TEACHING: OfficialAudience[] = ["Багш", "Арга зүйч"];
const LEADING: OfficialAudience[] = ["Эрхлэгч", "Арга зүйч"];

type Row = [
  id: string,
  category: string,
  title: string,
  year: number,
  number: string | null,
  url: string,
  sourceLevel: OfficialSourceLevel,
  reviewRequired: boolean,
  audience: OfficialAudience[],
  notes?: string,
];

const PDF = "official_pdf";
const FULL = "official_full_text";
const REPO = "official_repository_page";
const NOTICE = "official_notice_only";
const INDEX = "official_index_only";

const ROWS: Row[] = [
  [
    "SOB-001",
    "Хууль",
    "Сургуулийн өмнөх болон ерөнхий боловсролын тухай хууль",
    2023,
    null,
    "https://legalinfo.mn/mn/detail?lawId=16759959012931",
    FULL,
    false,
    ALL,
    "СӨБ болон ЕБС-д хамрах хууль; СӨБ-ийн холбогдох зүйл, заалтыг ашиглана.",
  ],
  [
    "SOB-002",
    "Дүрэм, журам",
    "Хүүхдийн цэцэрлэгийн үлгэрчилсэн дүрэм",
    2023,
    "А/569",
    "https://legalinfo.mn/mn/detail?lawId=17048151375571",
    FULL,
    false,
    ALL,
  ],
  [
    "SOB-003",
    "Дүрэм, журам",
    "Сургуулийн өмнөх боловсролын сургалт, үйл ажиллагаа зохион байгуулах журам",
    2025,
    "А/401",
    "https://moe.gov.mn/post/168746",
    NOTICE,
    true,
    ALL,
    "Албан тайланд баталсныг дурдсан. Журмын эх хавсралтын шууд холбоосыг баталгаажуулах шаардлагатай.",
  ],
  [
    "SOB-004",
    "Дүрэм, журам",
    "Сургуулийн өмнөх боловсролын хувилбарт сургалт зохион байгуулах журам",
    2022,
    "А/224",
    "https://legalinfo.mn/mn/detail?lawId=16530818666131",
    FULL,
    false,
    ALL,
  ],
  [
    "SOB-005",
    "Дүрэм, журам",
    "СӨБ-ын суралцагчийн хөгжил болон сургуульд бэлтгэгдсэн байдлыг үнэлэх журам",
    2026,
    "А/79",
    "https://legalinfo.mn/mn/detail?lawId=17436334882422",
    FULL,
    false,
    ALL,
    "2020 оны А/280 журмыг шинэчилсэн. Журмын хавсралт болох үнэлгээний шалгуурыг албан сайтад нийтлээгүй байна (2026-10-20).",
  ],
  [
    "SOB-006",
    "Дүрэм, журам",
    "Цэцэрлэг, ерөнхий боловсролын сургуулийн зөвлөлийн үйл ажиллагааны нийтлэг журам",
    2024,
    "А/158",
    "https://legalinfo.mn/mn/detail?lawId=17140243487881&showType=1",
    FULL,
    false,
    ALL,
  ],
  [
    "SOB-007",
    "Сургалтын хөтөлбөр",
    "Сургуулийн өмнөх боловсролын сургалтын хөтөлбөр (2025)",
    2025,
    "А/404",
    "https://mnier.mn/api/media/file/sub2025.pdf",
    PDF,
    false,
    ALL,
    "Мөрдөж буй хөтөлбөр.",
  ],
  [
    "SOB-037",
    "Сургалтын хөтөлбөр",
    "Сургуулийн өмнөх боловсролын сургалтын хөтөлбөр, хэрэгжүүлэх зөвлөмж (2019)",
    2019,
    null,
    "https://mnier.mn/api/media/file/sub2019.pdf",
    PDF,
    false,
    ALL,
    "Өмнөх хувилбар; одоо 2025 оны хөтөлбөрийг мөрдөнө.",
  ],
  [
    "SOB-009",
    "Сургалтын хөтөлбөр",
    "Бага бүлгийн багшийн гарын авлага",
    2025,
    null,
    "https://mnier.mn/api/media/file/Bagshiin_gariin_avlaga_Baga_buleg_204ca4f31e.pdf",
    PDF,
    false,
    TEACHING,
  ],
  [
    "SOB-010",
    "Сургалтын хөтөлбөр",
    "Дунд бүлгийн багшийн гарын авлага",
    2025,
    null,
    "https://mnier.mn/api/media/file/Bagshiin_gariin_avlaga_Dund_buleg_e0345ccaa5.pdf",
    PDF,
    false,
    TEACHING,
  ],
  [
    "SOB-011",
    "Сургалтын хөтөлбөр",
    "Ахлах бүлгийн багшийн гарын авлага",
    2025,
    null,
    "https://mnier.mn/api/media/file/Sub_Ahlah_buleg_003f7bc79a.pdf",
    PDF,
    false,
    TEACHING,
  ],
  [
    "SOB-012",
    "Сургалтын хөтөлбөр",
    "Бэлтгэл бүлгийн багшийн гарын авлага",
    2025,
    null,
    "https://mnier.mn/api/media/file/Sub_Beltgel_buleg_34fac6d91e.pdf",
    PDF,
    false,
    TEACHING,
  ],
  [
    "SOB-008",
    "Сургалтын хөтөлбөр",
    "СӨБ, ЕБС-ийн сургалтын хөтөлбөрийн үзэл баримтлал (2024–2036)",
    2024,
    "ЗГ №176",
    "https://legalinfo.mn/mn/detail?lawId=17140353213781",
    FULL,
    true,
    ALL,
    "Холбоос нь зөвхөн баталсан тогтоолыг нээнэ; хавсралт болох «үзэл баримтлал»-ын эх legalinfo.mn-д алга (2026-10-20).",
  ],
  [
    "SOB-013",
    "Дүрэм, журам",
    "Цэцэрлэг, багшийн ажлын гүйцэтгэлийн үнэлгээ зохион байгуулах журам, шалгуур",
    2026,
    "А/27",
    "https://cdn.greensoft.mn/uploads/users/2760/files/%D0%90_27.pdf",
    PDF,
    false,
    ALL,
    "2026.04.27 А/27 тушаал; журам/шалгуурын эх хавсралтыг тусад нь шалгана.",
  ],
  [
    "SOB-014",
    "Дүрэм, журам",
    "Цэцэрлэгийн багш, удирдах ажилтанд мэргэшлийн зэрэг олгох, хүчингүй болгох журам",
    2024,
    "А/95",
    "https://legalinfo.mn/mn/detail?lawId=17141618951041&showType=1",
    FULL,
    true,
    ALL,
    "Энэ нь тушаалын 1-р хавсралт (журам); журамд заасан маягт тусдаа хавсралт бөгөөд legalinfo.mn-д алга (2026-10-20).",
  ],
  [
    "SOB-015",
    "Дүрэм, журам",
    "СӨБ, ЕБС-ийн багш, ажилтны мэргэжлийн ёс зүйн дүрэм",
    2022,
    "А/545",
    "https://legalinfo.mn/mn/detail?lawId=16532345574681",
    FULL,
    true,
    ALL,
    "Энэ нь тушаалын 1-р хавсралт; бусад хавсралт legalinfo.mn-д алга (2026-10-20).",
  ],
  [
    "SOB-016",
    "Дүрэм, журам",
    "Цэцэрлэг, ЕБС-ийн багш, ажилтны мэргэжлийн хөгжлийн үйл ажиллагааны журам",
    2025,
    "А/25",
    "https://moe.gov.mn/post/178023",
    NOTICE,
    true,
    ALL,
    "Яамны тайланд журам батлагдсаныг дурдсан; эх хавсралтыг тусад нь баталгаажуулна.",
  ],
  [
    "SOB-017",
    "Аргачлал",
    "СӨБ-ын байгууллага, ЕБС-ийн хамран сургах тойрог тогтоох аргачлал",
    2024,
    "А/82",
    "https://legalinfo.mn/mn/detail?lawId=17089855565881&showType=1",
    FULL,
    false,
    ALL,
  ],
  [
    "SOB-018",
    "Жагсаалт",
    "СӨБ-ын хүүхдийн хичээлийн хэрэглэл, сургалтын болон эрүүл ахуйн хэрэгслийн жагсаалт",
    2023,
    "А/273; А/192 (2025)",
    "https://www.city.edu.mn/public/br?id=453",
    NOTICE,
    true,
    ALL,
    "2025.08.15 А/192 өөрчлөлт орсон; шинэчилсэн хавсралтын эхийг нягтлах.",
  ],
  [
    "SOB-019",
    "Аргачлал",
    "Ганцаарчилсан сургалтын төлөвлөгөө, төлөвлөгөө боловсруулах аргачлал",
    2022,
    null,
    "https://moe.gov.mn/post/120594",
    REPO,
    true,
    ALL,
    "Аргачлал болон загварын албан нийтлэл; тушаалын дугаарыг баталгаажуулаагүй.",
  ],
  [
    "SOB-020",
    "Дүрэм, журам",
    "Сургалтын байгууллагын хүүхдийн хоол, хүнсний хангамж, үйлчилгээ үзүүлэх журам",
    2024,
    "А/140",
    "https://legalinfo.mn/mn/detail?lawId=17089867347501&showType=1",
    FULL,
    false,
    ALL,
    "Журмын 1.1-т төрийн өмчийн цэцэрлэгийг заасан.",
  ],
  [
    "SOB-021",
    "Норматив",
    "Цэцэрлэг, сургуулийн насны хүүхдийн хоногийн хоолны илчлэгийн хуваарилалт",
    2020,
    "А/166, А/559, 222",
    "https://legalinfo.mn/mn/detail?lawId=211418&showType=1",
    FULL,
    false,
    ALL,
  ],
  [
    "SOB-022",
    "Тогтоол",
    "Цэцэрлэгийн хүүхдийн хоолны зардлын хэмжээг шинэчлэн тогтоох тухай",
    2024,
    "ЗГ №237",
    "https://legalinfo.mn/mn/detail?lawId=17140605192131",
    FULL,
    false,
    ALL,
    "Төрийн болон орон нутгийн өмчийн цэцэрлэгийн зохицуулалт.",
  ],
  [
    "SOB-023",
    "Тогтоол",
    "СӨБ-ын хувьсах зардлын хэмжээ, итгэлцүүр, санхүүжүүлэх журам",
    2026,
    "ЗГ №149",
    "https://legalinfo.mn/mn/detail?lawId=17141293183621",
    FULL,
    true,
    ALL,
    "Анхааруулга: холбоос 2024 оны №53 тогтоол руу заадаг; 2026 оны №149 тогтоолын эх олдоогүй (2026-10-20). 2026.05.01-ээс хэрэгжүүлэхээр заасан; 2024 оны хуучин заалтуудыг бүү ашигла.",
  ],
  [
    "SOB-024",
    "Тогтоол",
    "Цэцэрлэг, ЕБС-д суурилсан урьдчилан сэргийлэх, эрт илрүүлэх үзлэг зохион байгуулах тухай",
    2026,
    "ЗГ №301",
    "https://moe.gov.mn/%D0%B7%D0%B0%D1%81%D0%B3%D0%B8%D0%B9%D0%BD-%D0%B3%D0%B0%D0%B7%D1%80%D1%8B%D0%BD-%D1%82%D0%BE%D0%B3%D1%82%D0%BE%D0%BE%D0%BB",
    INDEX,
    true,
    ALL,
    "Яамны тогтоолын бүртгэл; эх тогтоол болон 2026 оны А/255/А/254 удирдамжийг тодруулна.",
  ],
  [
    "SOB-025",
    "Бодлогын чиглэл",
    "СӨБ болон ЕБС-ийн 2026–2027 оны хичээлийн жилийн зорилго, зорилт",
    2026,
    null,
    "https://www.gov.mn/news/n/9e40",
    NOTICE,
    true,
    ALL,
    "Одоогийн хичээлийн жилийн чиглэл, заавал мөрдөх хууль бус.",
  ],
  [
    "SOB-026",
    "Стандарт",
    "СӨБ-ын байгууллагын сургалтын орчин. Ерөнхий шаардлага",
    2015,
    "MNS 6558:2015",
    "https://cdn.greensoft.mn/uploads/users/2760/files/PDF/kindergarten%20standart.pdf",
    PDF,
    false,
    ALL,
    "Шинэчлэх төсөл явагдаж буй тул хамгийн сүүлийн батлагдсан эхийг шалгах.",
  ],
  [
    "SOB-027",
    "Стандарт",
    "Сургалт, хүмүүжлийн орчны эрүүл ахуйн шаардлага",
    2019,
    "MNS 6799:2019",
    "https://cdn.greensoft.mn/uploads/users/2760/files/PDF/standart%206799.pdf",
    PDF,
    false,
    ALL,
    "Яамны хүснэгтийн гарчигт MNS 6782 гэж алдаатай бичигдсэн; эх стандартыг шалгана.",
  ],
  [
    "SOB-028",
    "Стандарт",
    "ЕБС, дотуур байр, цэцэрлэгийн хоол үйлдвэрлэл, үйлчилгээнд тавих шаардлага",
    2023,
    "MNS 7005:2023",
    "https://www.gov.mn/news/n/96c9",
    NOTICE,
    true,
    ALL,
    "Стандартыг бүрэн эхээр нь нийтлээгүй, эрх бүхий сувгаар үзэх шаардлагатай.",
  ],
  [
    "SOB-029",
    "Барилгын норм",
    "СӨБ-ын байгууллагын барилгын төлөвлөлт",
    2022,
    "БНбД 31-24-22",
    "https://legalinfo.mn/mn/detail?lawId=16531413277491",
    NOTICE,
    true,
    ALL,
    "Баталсан тушаал. Барилгын нормын бүрэн эх хавсралт болон шинэчлэлийг нягтлах. Холбоос нь зөвхөн баталсан тушаалыг нээнэ; БНбД 31-24-22 нормын бүрэн эх legalinfo.mn-д алга (2026-10-20).",
  ],
  [
    "SOB-030",
    "Гарын авлага",
    "Хөгжлөөс хэн ч хоцрох ёсгүй",
    2024,
    null,
    "https://moe.gov.mn/post/156051",
    REPO,
    true,
    ALL,
    "Тэгш хамруулах арга зүйн материал; хууль биш.",
  ],
  [
    "SOB-031",
    "Гарын авлага",
    "Хүүхдийн цэцэрлэгт тэгш хамран сургах үйл ажиллагааг зохион байгуулах нь",
    2024,
    null,
    "https://moe.gov.mn/post/156050",
    REPO,
    true,
    ALL,
    "Арга зүйн зөвлөмж; хууль биш.",
  ],
  [
    "SOB-032",
    "Гарын авлага",
    "Цэцэрлэгийн насны хүүхдэд зориулсан явуулын сургалтын гарын авлага",
    2022,
    null,
    "https://moe.gov.mn/post/123172",
    REPO,
    true,
    ALL,
  ],
  [
    "SOB-033",
    "Гарын авлага",
    "Цэцэрлэгийн менежмент, манлайлал",
    2020,
    null,
    "https://cdn.greensoft.mn/uploads/users/2649/files/PDF%20files/asdasd-201123121518.pdf",
    PDF,
    false,
    LEADING,
    "Удирдах ажилтанд зориулсан арга зүйн материал.",
  ],
  [
    "SOB-034",
    "Гарын авлага",
    "СӨБ-ын байгууллагын сургалтын орчны стандартыг хэрэгжүүлэх зөвлөмж",
    2020,
    null,
    "https://cdn.greensoft.mn/uploads/users/2649/files/PDF%20files/asfasfasf-200918075356.pdf",
    PDF,
    false,
    ALL,
    "2015 оны стандарттай холбоотой материал; шинэ стандартаар солигдсон эсэхийг шалгах.",
  ],
  [
    "SOB-035",
    "Гарын авлага",
    "Цэцэрлэгийн хүүхэд хамгааллын бодлогыг хэрэгжүүлэх зөвлөмж",
    2020,
    null,
    "https://cdn.greensoft.mn/uploads/users/2649/files/PDF%20files/asdasdasd-201123121346.pdf",
    PDF,
    false,
    ALL,
    "2024 оны шинэчилсэн Хүүхэд хамгааллын тухай хуульд нийцүүлэн хэрэглэнэ; хуучин зөвлөмж.",
  ],
  [
    "SOB-036",
    "Гарын авлага",
    "Бага насны хүүхдийг хүчирхийллээс сэргийлэх, хамгаалах сургалтын модуль",
    2020,
    null,
    "https://cdn.greensoft.mn/uploads/users/2649/files/PDF%20files/asdsadd-200918074014.pdf",
    PDF,
    false,
    ALL,
    "2024 оны шинэ хууль, одоо мөрдөх журмыг орлохгүй.",
  ],
];

export const OFFICIAL_DOCUMENTS: OfficialDocument[] = ROWS.map(
  ([id, category, title, year, number, url, sourceLevel, reviewRequired, audience, notes]) => ({
    id,
    category,
    title,
    year,
    number,
    url,
    sourceLevel,
    reviewRequired,
    audience,
    notes: notes ?? "",
    checkedOn: OFFICIAL_DOCUMENTS_AS_OF,
    cover: coverFor(id),
    featured: FEATURED.has(id),
    actionLabel: actionLabelFor(sourceLevel),
  }),
);

/** The register's `display_action`: only a full text is "the original", only a PDF a PDF. */
export function actionLabelFor(level: OfficialSourceLevel): OfficialDocument["actionLabel"] {
  if (level === PDF) return "PDF нээх";
  if (level === FULL) return "Албан эхийг нээх";
  return "Эх сурвалж үзэх";
}

/** The shipped first-page picture for a register code, if one was rendered. */
export function coverFor(code: string): string | null {
  return COVERS.has(code) ? `/official-covers/${code}.jpg` : null;
}

/** «legalinfo.mn» — the site a card says it opens. */
export function sourceHost(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    // moe.gov.mn serves its files from its site builder's CDN — say whose they are.
    return host === "cdn.greensoft.mn" ? "moe.gov.mn" : host;
  } catch {
    return url;
  }
}
