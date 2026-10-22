/** Үнийн саналын нэг эх сурвалж. Бүх дэлгэц дүнг эндээс бодно. */

import {
  CHILD_PRICES,
  FIRST_TERM_PROMO,
  GROUP_PRICES,
  MONTHS_IN_SCHOOL_YEAR,
  MONTHS_IN_TERM,
  firstTermPromoOpen,
  groupYearPrice,
  localDate,
} from "@kinder/contracts";

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

/*
 * ★ The figures come from the shared sheet (`@kinder/contracts` `pricing.ts`),
 * which the API reads too — 2026-10-18, the client's «I-р улирал 2026» brief:
 * one copy, so the page, the contract and the charge cannot disagree.
 */
export { MONTHS_IN_SCHOOL_YEAR };

export const CHILD_MONTHLY_PRICE = CHILD_PRICES.monthly;
export const CHILD_STANDARD_TERM_PRICE = CHILD_PRICES.termStandard;
export const CHILD_STANDARD_YEAR_PRICE = CHILD_PRICES.yearStandard;
export const CHILD_CURRENT_TERM_PRICE = CHILD_PRICES.termPromo;
export const CHILD_CURRENT_YEAR_PRICE = CHILD_PRICES.year;

export const KINDERGARTEN_MONTHLY_PER_GROUP = GROUP_PRICES.monthly;
export const KINDERGARTEN_STANDARD_TERM_PER_GROUP = GROUP_PRICES.termStandard;
export const KINDERGARTEN_STANDARD_YEAR_PER_GROUP = GROUP_PRICES.yearStandard;
/**
 * ★ «I-р улирал» is priced as a term — 4,000₮ a group since 2026-10-21 (the
 * user), never a monthly rate × 3 (the client, 2026-10-18).
 */
export const KINDERGARTEN_CURRENT_TERM_PER_GROUP = GROUP_PRICES.termPromo;
/**
 * ★ A group's year bought today — 2026-10-22, the user: the months left from
 * the next month to May × 4,000₮ (on 22 October, 7 × 4,000₮ = 28,000₮),
 * June a bonus; 9 × 4,000₮ = 36,000₮ for a whole year. The server prices the
 * same way (`groupYearPrice`, `quote()`).
 */
export function kindergartenYearPerGroup(today: string = localDate()): number {
  return groupYearPrice(today);
}

/**
 * Whether «I-р улирал» is still on sale — through 2026-11-30 in Ulaanbaatar.
 * From 1 December the page offers the year alone: no term price is defined
 * after it, and none is invented here.
 */
export function termOnSale(today: string = localDate()): boolean {
  return firstTermPromoOpen(today);
}

/** «I-р улирал · 2026.11.30 хүртэл хүчинтэй». */
export const DISCOUNT_PERIOD_LABEL = `${FIRST_TERM_PROMO.label} · ${FIRST_TERM_PROMO.validityLabel}`;

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
    // Read when drawn — the year's price follows the day (2026-10-22).
    get perYear() {
      return kindergartenYearPerGroup();
    },
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

/**
 * A kindergarten's term, all groups: «I-р улирал» at 4,000₮ a group through
 * 2026-11-30, and the standard 12,000₮ (4,000₮ × 3) after it — the user's
 * rule of 2026-10-14, which `contractSchedule` applies term by term.
 */
export function kindergartenTermPrice(groups: number, today: string = localDate()): number {
  const perGroup = termOnSale(today)
    ? KINDERGARTEN_CURRENT_TERM_PER_GROUP
    : KINDERGARTEN_STANDARD_TERM_PER_GROUP;
  return Math.max(1, Math.trunc(groups)) * perGroup;
}

export function kindergartenYearlyPrice(groups: number, today: string = localDate()): number {
  return Math.max(1, Math.trunc(groups)) * kindergartenYearPerGroup(today);
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

/**
 * The promotional term price holds for a term that begins on or before this
 * day. The year's price has no end date: 28,000₮ a group stays after it.
 */
export const TERM_DISCOUNT_ENDS = FIRST_TERM_PROMO.endsOn;

export interface ContractLine {
  label: string;
  /**
   * A standard term's monthly rate a group; `null` for a school year and for
   * «I-р улирал», which is priced as a term (4,000₮), not as a month.
   */
  perMonth: number | null;
  /** 3 for a term, `null` for a school year. */
  months: number | null;
  groups: number;
  /** The year's price a group, or the term's (perMonth × months). */
  perGroup: number;
  amount: number;
  /** Below the standard price — the line says «Хямдрал». */
  discounted: boolean;
  /**
   * When it is paid: the day its term (or school year) begins — the user,
   * 2026-10-14. The 14-day reminder runs up to it; unpaid on it, the
   * kindergarten's access is suspended.
   */
  dueOn: string;
}

export interface ContractSchedule {
  lines: ContractLine[];
  /** What the contract prints as «Нийт төлбөр» (the user, 2026-10-14). */
  total: number;
  /** The same contract at the standard price, for the saving. */
  standardTotal: number;
}

const TERMS = [
  // `fromNext` / `toNext`: the day falls in the calendar year after September's.
  { name: "I улирал (9–11 сар)", from: "09-01", to: "11-30", fromNext: false, toNext: false },
  { name: "II улирал (12–2 сар)", from: "12-01", to: "02-29", fromNext: false, toNext: true },
  { name: "III улирал (3–5 сар)", from: "03-01", to: "05-31", fromNext: true, toNext: true },
] as const;

/** `2026-10-14` → 2026, the school year that began that September; `2027-03-01` → 2026. */
function schoolYearOf(date: string): number {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 9 ? year : year - 1;
}

/**
 * A kindergarten contract, period by period: each term — or school year — the
 * dates touch, at the price of the day. `null` while the groups or the dates
 * cannot be read. Whole terms: a contract starting mid-term pays that whole
 * term — the user's decision, 2026-10-14 («бүтнээр»).
 */
export function contractSchedule(
  groups: number,
  period: BillingPeriod,
  startsOn: string,
  endsOn: string,
): ContractSchedule | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!Number.isInteger(groups) || groups < 1) return null;
  if (!iso.test(startsOn) || !iso.test(endsOn) || endsOn <= startsOn) return null;

  const first = schoolYearOf(startsOn);
  const last = Math.min(schoolYearOf(endsOn), first + 4);
  const lines: ContractLine[] = [];
  let standardTotal = 0;

  for (let year = first; year <= last; year += 1) {
    const span = `${year}–${year + 1}`;
    if (period === "year") {
      lines.push({
        label: `${span} хичээлийн жил`,
        perMonth: null,
        months: null,
        groups,
        // The first year from the day it starts (its months left); a later one whole.
        perGroup: year === first ? groupYearPrice(startsOn) : GROUP_PRICES.year,
        amount: groups * (year === first ? groupYearPrice(startsOn) : GROUP_PRICES.year),
        discounted:
          (year === first ? groupYearPrice(startsOn) : GROUP_PRICES.year) <
          KINDERGARTEN_STANDARD_YEAR_PER_GROUP,
        dueOn: `${year}-09-01`,
      });
      standardTotal += groups * KINDERGARTEN_STANDARD_YEAR_PER_GROUP;
      continue;
    }
    for (const term of TERMS) {
      const from = `${term.fromNext ? year + 1 : year}-${term.from}`;
      const to = `${term.toNext ? year + 1 : year}-${term.to}`;
      if (from > endsOn || to < startsOn) continue;
      const discounted = from <= TERM_DISCOUNT_ENDS;
      // A promotional term is priced as a term (4,000₮), never as a month.
      const perGroup = discounted
        ? KINDERGARTEN_CURRENT_TERM_PER_GROUP
        : KINDERGARTEN_STANDARD_TERM_PER_GROUP;
      lines.push({
        label: first === last ? term.name : `${span} · ${term.name}`,
        perMonth: discounted ? null : KINDERGARTEN_MONTHLY_PER_GROUP,
        months: MONTHS_IN_TERM,
        groups,
        perGroup,
        amount: groups * perGroup,
        discounted,
        dueOn: from,
      });
      standardTotal += groups * KINDERGARTEN_STANDARD_TERM_PER_GROUP;
    }
  }

  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return { lines, total, standardTotal };
}
