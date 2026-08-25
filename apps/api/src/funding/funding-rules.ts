/**
 * The funding arithmetic — нэмэлт.md §5.
 *
 * §5 states the formula in words:
 *
 *   Санхүүжилт = эрхтэй хүүхэд × санхүүжилтэд тооцогдох ирсэн өдөр × тариф
 *
 * ★ Pure functions, taking numbers and returning numbers.
 *
 * This is the file whose output ends up on an invoice and in a reconciliation
 * against a bank statement. Keeping it free of Prisma, dates-from-requests and
 * authorization means the arithmetic can be reasoned about — and read — on its
 * own, which is not true of the same expressions inlined in a service method.
 */

/** A rule, reduced to what the calculation actually needs. */
export interface RuleInput {
  dailyRate: number | null;
  monthlyRate: number | null;
  dependsOnAttendance: boolean;
  dependsOnMeals: boolean;
}

export interface CountsInput {
  daysAttended: number;
  daysFed: number;
}

/**
 * Which counter the daily rate multiplies — §5's two "хамаарах эсэх" flags.
 *
 * ★ When a rule depends on **both**, the smaller count wins.
 *
 * A rule that funds "days the child attended *and* ate" cannot pay for a day
 * that fails either test, and the honest reading of two conditions joined by
 * "and" is the intersection. Adding them would pay twice for one day; taking
 * attendance alone would pay for a day nobody cooked for.
 *
 * The exact intersection is not derivable from two totals — a child could have
 * eaten on a day they were marked absent, which is itself a data-entry error
 * worth surfacing rather than silently pricing. The minimum is the safe bound:
 * it never over-claims, which is the direction an audit forgives.
 */
export function billableDays(rule: RuleInput, counts: CountsInput): number {
  if (rule.dependsOnAttendance && rule.dependsOnMeals) {
    return Math.min(counts.daysAttended, counts.daysFed);
  }
  if (rule.dependsOnMeals) return counts.daysFed;
  if (rule.dependsOnAttendance) return counts.daysAttended;

  // Neither: a flat monthly charge, where the day count is irrelevant.
  return 0;
}

/**
 * One child's funding for one month.
 *
 * ★ Rounded to whole tögrög, once, at the end.
 *
 * Tögrög has no subunit in practice, and rounding each day's share before
 * summing would drift by up to half a tögrög per day — about fifteen a month
 * per child, which across three hundred children is a figure somebody has to
 * explain. `Math.round` at the end, on a value that has not yet been through a
 * float division, keeps the total exact.
 *
 * Returns `0` rather than throwing when a rule carries no usable rate: a
 * kindergarten mid-way through configuring its rules should see a zero it can
 * investigate, not a month that refuses to calculate.
 */
export function calculateFunding(rule: RuleInput, counts: CountsInput): number {
  // A flat monthly rate ignores the counters entirely — §5's "Сарын тариф".
  if (!rule.dependsOnAttendance && !rule.dependsOnMeals) {
    return Math.round(rule.monthlyRate ?? 0);
  }

  if (rule.dailyRate === null) return 0;

  return Math.round(rule.dailyRate * billableDays(rule, counts));
}

/**
 * Whether a rule was in force on a given day — §5's date bounds.
 *
 * Inclusive at both ends: a rule "effective from 1 March to 31 March" covers
 * the whole of March, which is how anybody reading a government circular would
 * understand it. Dates compare as `YYYY-MM-DD` strings, which sort correctly
 * and sidestep the timezone question entirely.
 */
export function ruleAppliesOn(
  rule: { effectiveFrom: string; effectiveTo: string | null },
  isoDate: string,
): boolean {
  if (isoDate < rule.effectiveFrom) return false;
  if (rule.effectiveTo !== null && isoDate > rule.effectiveTo) return false;
  return true;
}
