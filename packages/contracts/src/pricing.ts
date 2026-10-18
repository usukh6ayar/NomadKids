/**
 * The platform's price sheet — one copy for the price page, the contract and
 * the API (2026-10-18, the client's «I-р улирал 2026» brief). Whole tugrik.
 *
 * ★ What a family is actually charged for portal access is still the
 * deployment's `ACCESS_FEE_AMOUNT` / `ACCESS_FEE_TERM_AMOUNT` (CLAUDE.md §7:
 * one merchant, price as a deployment setting, "0" turns the gate off). Those
 * must equal the child prices here; the API test `pricing.test.ts` pins the
 * sheet and `AccessService` refuses a term once the promotion has ended,
 * whatever the setting says.
 */

/** Months a fee is counted over: September to May. */
export const MONTHS_IN_SCHOOL_YEAR = 9;
export const MONTHS_IN_TERM = 3;

/** Хүүхэд — a family's portal access, per child. */
export const CHILD_PRICES = {
  monthly: 3_000,
  termStandard: 3_000 * MONTHS_IN_TERM, // 9,000₮
  termPromo: 5_000,
  yearStandard: 3_000 * MONTHS_IN_SCHOOL_YEAR, // 27,000₮
  year: 22_000,
} as const;

/** Цэцэрлэг / Бүлэг — a kindergarten's contract, per group. */
export const GROUP_PRICES = {
  monthly: 4_000,
  termStandard: 4_000 * MONTHS_IN_TERM, // 12,000₮
  termPromo: 6_000,
  yearStandard: 4_000 * MONTHS_IN_SCHOOL_YEAR, // 36,000₮
  year: 30_000,
} as const;

/** Багш — a solo teacher never pays (#195). */
export const TEACHER_PRICE = 0;

/**
 * «I-р улирал» — the first-term promotion.
 *
 * ★ A fixed last day, not a length: a term bought on 2026-10-18 and one bought
 * on 2026-11-29 both end on 2026-11-30 — never the purchase day plus three
 * months, and no past month is charged on top. The day is inclusive and read
 * in Ulaanbaatar (`localDate`): it can be bought, and it opens the portal,
 * through the end of 30 November; from 1 December it is not sold.
 */
export const FIRST_TERM_PROMO = {
  label: "I-р улирал",
  endsOn: "2026-11-30",
  /** «2026.11.30 хүртэл хүчинтэй». */
  validityLabel: "2026.11.30 хүртэл хүчинтэй",
} as const;

/** Whether «I-р улирал» may still be bought on `today` (`YYYY-MM-DD`, Ulaanbaatar). */
export function firstTermPromoOpen(today: string): boolean {
  return today <= FIRST_TERM_PROMO.endsOn;
}

/**
 * The three terms of a school year, by the calendar — the same for every
 * kindergarten, as the price sheet is (the user, 2026-10-18: after
 * «I-р улирал», II and III are sold at the standard term price).
 */
export interface SchoolTerm {
  number: 1 | 2 | 3;
  /** «II улирал». */
  label: string;
  /** `YYYY-MM-DD`, inclusive. */
  startsOn: string;
  endsOn: string;
}

/** The term `day` falls in, or `null` from June to August. */
export function schoolTermOn(day: string): SchoolTerm | null {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  // The school year that began in September of `start`.
  const start = month >= 9 ? year : year - 1;
  const lastOfFebruary = new Date(Date.UTC(start + 1, 2, 0)).getUTCDate();
  const terms: SchoolTerm[] = [
    { number: 1, label: "I улирал", startsOn: `${start}-09-01`, endsOn: `${start}-11-30` },
    {
      number: 2,
      label: "II улирал",
      startsOn: `${start}-12-01`,
      endsOn: `${start + 1}-02-${String(lastOfFebruary).padStart(2, "0")}`,
    },
    {
      number: 3,
      label: "III улирал",
      startsOn: `${start + 1}-03-01`,
      endsOn: `${start + 1}-05-31`,
    },
  ];
  return terms.find((term) => term.startsOn <= day && day <= term.endsOn) ?? null;
}

/** A child's price for a term: «I-р улирал» 5,000₮ through 2026-11-30, then 9,000₮. */
export function childTermPrice(term: SchoolTerm): number {
  return term.endsOn <= FIRST_TERM_PROMO.endsOn
    ? CHILD_PRICES.termPromo
    : CHILD_PRICES.termStandard;
}

/** A group's price for a term: «I-р улирал» 6,000₮ through 2026-11-30, then 12,000₮. */
export function groupTermPrice(term: SchoolTerm): number {
  return term.endsOn <= FIRST_TERM_PROMO.endsOn
    ? GROUP_PRICES.termPromo
    : GROUP_PRICES.termStandard;
}
