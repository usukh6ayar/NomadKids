/** Үнийн саналын нэг эх сурвалж. Бүх дэлгэц дүнг эндээс бодно. */

export type PlanKey = "child" | "teacher" | "kindergarten";
export type BillingPeriod = "term" | "year";

export interface Plan {
  key: PlanKey;
  name: string;
  audience?: string;
  /** The price of a term now. */
  perTerm: number;
  /** The price of the school year now. */
  perYear: number;
  features: string[];
}

/** 9–5 сарын хичээлийн жилийн төлбөртэй сарууд. */
export const MONTHS_IN_SCHOOL_YEAR = 9;

export const CHILD_MONTHLY_PRICE = 3_000;
export const CHILD_STANDARD_TERM_PRICE = CHILD_MONTHLY_PRICE * 3;
export const CHILD_STANDARD_YEAR_PRICE = CHILD_MONTHLY_PRICE * MONTHS_IN_SCHOOL_YEAR;
/**
 * ★ The prices charged now. The first-term discount (5,000₮ / 22,000₮ for a
 * child, 2,000₮ / 34,000₮ a group) ended on 2026-10-11 — the user: "шууд
 * одооноос", the year being the monthly price × 9. A future discount is a
 * lower figure here; the screens show the struck-through price and the saving
 * only while one is lower than the standard.
 */
export const CHILD_CURRENT_TERM_PRICE = CHILD_STANDARD_TERM_PRICE;
export const CHILD_CURRENT_YEAR_PRICE = CHILD_STANDARD_YEAR_PRICE;

export const KINDERGARTEN_MONTHLY_PER_GROUP = 4_000;
export const KINDERGARTEN_STANDARD_TERM_PER_GROUP = KINDERGARTEN_MONTHLY_PER_GROUP * 3;
export const KINDERGARTEN_STANDARD_YEAR_PER_GROUP =
  KINDERGARTEN_MONTHLY_PER_GROUP * MONTHS_IN_SCHOOL_YEAR;
export const KINDERGARTEN_CURRENT_TERM_PER_GROUP = KINDERGARTEN_STANDARD_TERM_PER_GROUP;
export const KINDERGARTEN_CURRENT_YEAR_PER_GROUP = KINDERGARTEN_STANDARD_YEAR_PER_GROUP;

/** Whether a term is sold below its standard price now — what the discount lines hang on. */
export const TERM_DISCOUNTED =
  KINDERGARTEN_CURRENT_TERM_PER_GROUP < KINDERGARTEN_STANDARD_TERM_PER_GROUP;

export const PLANS: Plan[] = [
  {
    key: "child",
    name: "Хүүхэд",
    audience: "Суурь үнэ: сар бүр " + CHILD_MONTHLY_PRICE.toLocaleString("en-US") + "₮",
    perTerm: CHILD_CURRENT_TERM_PRICE,
    perYear: CHILD_CURRENT_YEAR_PRICE,
    features: [
      "Хөгжлийн цахим хавтас: Хүүхдийн ахиц хөгжил, явцын үнэлгээ, баримт нотолгоо",
      "Явцын үнэлгээ, үр дүнгийн үнэлгээ: А/79 тушаалын шалгуураар",
      "Ирцийн бүртгэл",
      "Хоолны цэс",
      "Өсөлт, эрүүл мэнд",
      "Гараас гарт хөтөлбөр",
      "Сургалт үйл ажиллагааны мэдээлэл",
      "Бүлгийн багштай чат",
      "Мэдээ, судалгаа, санал хүсэлт",
    ],
  },
  {
    key: "teacher",
    name: "Багш",
    audience: "Дангаар ашиглах",
    perTerm: 0,
    perYear: 0,
    features: [
      "Хөгжлийн цахим хавтас: Суралцагч бүрийн ахиц хөгжил, баримт нотолгоог эцэг эхтэй хамтран баримтжуулах",
      "Явцын үнэлгээ: Ажиглалт, ярилцлага, бүтээл",
      "Үр дүнгийн үнэлгээ: А/79 тушаалын шалгуураар авах, тайлан гаргах",
      "Өдрийн дэглэм, чиглүүлэгтэй сургалт үйл ажиллагаа",
      "Ирцийн бүртгэл, Гараас гарт хөтөлбөр",
      "Хоолны бүртгэл, Өсөлт, эрүүл мэнд",
      "Эцэг эхийн судалгаа, нэгтгэл",
      "Бүлгийн эцэг эхтэй чат, мэдээлэл дамжуулах",
      "Баримт бичгийн сан, Дуу шүлэг",
      "Бүлгийн нэгдсэн тайлан: PDF, Excel",
    ],
  },
  {
    key: "kindergarten",
    name: "Цэцэрлэг",
    audience: "Бүх багш, бүлгээрээ",
    perTerm: KINDERGARTEN_CURRENT_TERM_PER_GROUP,
    perYear: KINDERGARTEN_CURRENT_YEAR_PER_GROUP,
    features: [
      "Бүлэг, багш, ажилтны эрхийн удирдлага",
      "Хөгжлийн цахим хавтас: Бүх бүлгийн суралцагчийн ахиц хөгжил",
      "Явцын ба үр дүнгийн үнэлгээний нэгдсэн тайлан, хяналт",
      "Ирцийн бүртгэл",
      "ESIS-тэй холболт: Суралцагч, ажилтны бүртгэл, мэргэшлийн зэрэг",
      "Санхүүжилт, нэхэмжлэл, санхүүгийн тайлан",
      "Хоолны цэсийн нэгдсэн хяналт",
      "Бүлэг тус бүрийн судалгааны нэгтгэл, санал хүсэлтийн хайрцаг",
      "Мэдээ, багш нарын чат баримт бичгийн сан",
    ],
  },
];

export function kindergartenTermPrice(groups: number): number {
  return Math.max(1, Math.trunc(groups)) * KINDERGARTEN_CURRENT_TERM_PER_GROUP;
}

export function kindergartenYearlyPrice(groups: number): number {
  return Math.max(1, Math.trunc(groups)) * KINDERGARTEN_CURRENT_YEAR_PER_GROUP;
}

export function kindergartenStandardYearPrice(groups: number): number {
  return Math.max(1, Math.trunc(groups)) * KINDERGARTEN_MONTHLY_PER_GROUP * MONTHS_IN_SCHOOL_YEAR;
}

export function kindergartenPrice(groups: number, period: BillingPeriod): number {
  return period === "year" ? kindergartenYearlyPrice(groups) : kindergartenTermPrice(groups);
}

export function yearlySavingAmount(standardYearPrice: number, discountedYearPrice: number): number {
  return Math.max(0, standardYearPrice - discountedYearPrice);
}

/** Суурь үнэтэй харьцуулсан хэмнэлтийг нэг орны нарийвчлалтай хувиар бодно. */
export function savingPercent(standardPrice: number, discountedPrice: number): number {
  if (standardPrice <= 0) return 0;
  return Math.round((Math.max(0, standardPrice - discountedPrice) / standardPrice) * 1_000) / 10;
}

export function tugrik(amount: number): string {
  return amount.toLocaleString("en-US") + "₮";
}
