/** Үнийн саналын нэг эх сурвалж. Бүх дэлгэц дүнг эндээс бодно. */

export type PlanKey = "child" | "teacher" | "kindergarten";
export type BillingPeriod = "term" | "year";

export interface Plan {
  key: PlanKey;
  name: string;
  audience?: string;
  /** Одоогийн 1-р улирлын хөнгөлөлттэй үнэ. */
  perTerm: number;
  /** Энэ улирлын хөнгөлөлтийг шингээсэн хичээлийн жилийн үнэ. */
  perYear: number;
  features: string[];
}

/** 9–5 сарын хичээлийн жилийн төлбөртэй сарууд. */
export const MONTHS_IN_SCHOOL_YEAR = 9;

export const CHILD_MONTHLY_PRICE = 3_000;
export const CHILD_STANDARD_TERM_PRICE = CHILD_MONTHLY_PRICE * 3;
export const CHILD_STANDARD_YEAR_PRICE = CHILD_MONTHLY_PRICE * MONTHS_IN_SCHOOL_YEAR;
export const CHILD_CURRENT_TERM_PRICE = 5_000;
/** 9–5 сарын хичээлийн жилийн хөнгөлөлттэй нийт дүн. */
export const CHILD_CURRENT_YEAR_PRICE = 22_000;

export const KINDERGARTEN_MONTHLY_PER_GROUP = 4_000;
export const KINDERGARTEN_STANDARD_TERM_PER_GROUP = KINDERGARTEN_MONTHLY_PER_GROUP * 3;
/** 1-р улирал талдаа орсон тул 11 сар хүртэл нэг бүлгийн төлөх дүн. */
export const KINDERGARTEN_CURRENT_TERM_PER_GROUP = 2_000;
/** 9–5 сарын хичээлийн жилийн хөнгөлөлттэй нэг бүлгийн нийт дүн. */
export const KINDERGARTEN_CURRENT_YEAR_PER_GROUP = 34_000;

export const PLANS: Plan[] = [
  {
    key: "child",
    name: "Хүүхэд",
    audience: "Суурь үнэ: сар бүр " + CHILD_MONTHLY_PRICE.toLocaleString("en-US") + "₮",
    perTerm: CHILD_CURRENT_TERM_PRICE,
    perYear: CHILD_CURRENT_YEAR_PRICE,
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
    perTerm: 0,
    perYear: 0,
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
    perTerm: KINDERGARTEN_CURRENT_TERM_PER_GROUP,
    perYear: KINDERGARTEN_CURRENT_YEAR_PER_GROUP,
    features: [
      "Бүх бүлэг, багш, ажилтны эрх",
      "Явцын ба үр дүнгийн үнэлгээний нэгдсэн тайлан",
      "Тогооч, санхүү, удирдлагад зориулсан нэгдсэн тайлан",
      "ESIS-тэй холболт, суралцагчийн бүртгэл",
      "Санхүүжилт, нэхэмжлэл, санхүүгийн тайлан",
      "Эцэг эхийн санал хүсэлтийн хайрцаг",
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
