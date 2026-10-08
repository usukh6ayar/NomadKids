/**
 * Үнийн санал — the client's price sheet, 2026-10-08, as data.
 *
 * ★ A year is three terms (`TERMS`): the third runs March to August, so a
 * "per term" price × 3 is what a year bought term by term costs, and the
 * saving is measured against that — not against four quarters.
 *
 * ★★ The saving is computed, never typed. The sheet printed «4.4% хэмнэлт» on
 * the child's plan, where 3 × 9,000₮ = 27,000₮ against 26,000₮ is 3.7%; a
 * figure written by hand beside two prices is a figure that disagrees with
 * them the first time either changes.
 */

export type PlanKey = "child" | "teacher" | "kindergarten";

export interface Plan {
  key: PlanKey;
  name: string;
  /** The line under the name; none on the child's plan since 2026-10-08. */
  audience?: string;
  perTerm: number;
  perYear: number;
  /** The new customer's price for the first term — see `FIRST_TERM_OFFER`. */
  firstTermOffer: number;
  features: string[];
}

/**
 * ★ The features are what the system does, in the words of the preschool
 * curriculum (СӨБ) and of its own screens — 2026-10-08, the client: the
 * sheet's list ("Цахим ном, аудио ном", "24/7") was not this product.
 */
export const PLANS: Plan[] = [
  {
    key: "child",
    name: "Хүүхэд",
    perTerm: 9_000,
    perYear: 26_000,
    firstTermOffer: 5_000,
    features: [
      "Цахим хувийн хавтас: зураг, бүтээл, ажиглалт",
      "Явцын үнэлгээ, багшийн тэмдэглэл",
      "А/79 шалгуураар үр дүнгийн үнэлгээ",
      "Ирц, хоолны цэс, өсөлт, эрүүл мэнд",
      "Багштай чат, мэдээ, санал хүсэлт",
    ],
  },
  {
    key: "teacher",
    name: "Багш",
    audience: "Дангаар ашиглах",
    perTerm: 40_000,
    perYear: 115_000,
    firstTermOffer: 25_000,
    features: [
      "Ажиглалт, ярилцлага, бүтээлийн явцын үнэлгээ",
      "А/79 шалгуурт холбох, шалгуур санал болгох",
      "Сургалтын 7 чиглэлийн хамрах хүрээ",
      "Ирц, хоолны бүртгэл, эцэг эхийн судалгаа",
      "Бүлгийн тайлан, PDF ба Excel",
    ],
  },
  {
    key: "kindergarten",
    name: "Цэцэрлэг",
    audience: "Бүх багш, бүлгээрээ",
    perTerm: 150_000,
    perYear: 430_000,
    firstTermOffer: 100_000,
    features: [
      "Бүх бүлэг, багш, ажилтны эрх",
      "Явцын ба үр дүнгийн үнэлгээний нэгдсэн тайлан",
      "ESIS-тэй холболт, суралцагчийн бүртгэл",
      "Санхүүжилт, нэхэмжлэл, санхүүгийн тайлан",
      "Эцэг эхийн санал хүсэлтийн хайрцаг",
    ],
  },
];

/**
 * ★ New customers, first term — 2026-10-08, the client: "шинэ хэрэглэгч 1-р
 * улирал буюу 11 сар хүртэл хүүхэд 5000, багш 25000, цэцэрлэг 110000" — the
 * kindergarten's lowered to 100,000₮ the same day ("110,000₮-100000 болго").
 *
 * It ends itself: after `until` the page shows the ordinary term price, so a
 * December visitor is never offered a price that has run out.
 */
export const FIRST_TERM_OFFER = {
  label: "Шинэ хэрэглэгч",
  note: "1-р улирал (11 сар хүртэл)",
  until: "2026-11-30",
} as const;

/** Whether the offer still runs on `today` (`YYYY-MM-DD`, local). */
export function firstTermOfferRuns(today: string): boolean {
  return today <= FIRST_TERM_OFFER.until;
}

/** The term calendar the yearly saving is measured against; not drawn. */
export const TERMS = [
  { name: "1-р улирал", months: "9 – 11 сар", length: 3 },
  { name: "2-р улирал", months: "12 – 2 сар", length: 3 },
  { name: "3-р улирал", months: "3 – 8 сар", length: 6 },
] as const;

/**
 * Whether the page shows «Цэцэрлэгийн багцын дэлгэрэнгүй үнэ» — hidden for
 * now, 2026-10-08, the client: "одоогоор нуучих". The tiers below stay, so
 * turning this back on is the whole change.
 */
export const SHOW_KINDERGARTEN_TIERS = false;

/** The kindergarten package by number of groups; `null` is «Тусгай санал». */
export const KINDERGARTEN_TIERS: {
  groups: string;
  perTerm: number | null;
  perYear: number | null;
}[] = [
  { groups: "1 – 4 бүлэг", perTerm: 150_000, perYear: 430_000 },
  { groups: "5 – 9 бүлэг", perTerm: 300_000, perYear: 860_000 },
  { groups: "10 – 14 бүлэг", perTerm: 450_000, perYear: 1_290_000 },
  { groups: "15 – 19 бүлэг", perTerm: 600_000, perYear: 1_720_000 },
  { groups: "20+ бүлэг", perTerm: null, perYear: null },
];

/** The share a year saves over three terms bought one by one, to `digits`. */
export function yearlySaving(perTerm: number, perYear: number, digits = 1): number {
  const termByTerm = perTerm * TERMS.length;
  const factor = 10 ** digits;
  return Math.round(((termByTerm - perYear) / termByTerm) * 100 * factor) / factor;
}

/** «150,000₮» — the sheet's own grouping. */
export function tugrik(amount: number): string {
  return `${amount.toLocaleString("en-US")}₮`;
}
