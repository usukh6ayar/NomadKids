import Decimal from "decimal.js";
import type { InvoiceLineType, InvoiceStatus } from "../domain/enums";

/**
 * The arithmetic of an invoice — `нэмэлт.md` §7, §8.
 *
 * ★ Pure functions over `Decimal`, no database access, for the same
 * reason `child-access.ts` is pure: money rules should be testable exhaustively
 * without fixtures, and there should be exactly one place that decides what an
 * invoice totals and whether it is paid.
 *
 * ★★ `Decimal` throughout, never `number`.
 *
 * `0.1 + 0.2 !== 0.3` in binary floating point. A kindergarten's month is a few
 * hundred of these additions, and the error surfaces as a total that disagrees
 * with the bank by a tögrög — the kind of discrepancy that costs an accountant
 * an afternoon and destroys confidence in every other figure on the screen.
 *
 * ★★★ `decimal.js` directly, **not** `Prisma.Decimal`.
 *
 * The first version of this file imported the latter, and the ESLint boundary
 * (CLAUDE.md §2.2) rejected it — correctly. `Prisma.Decimal` is re-exported
 * from the generated client, so importing it here would have opened the query
 * surface to a pure module and to the service beside it; the rule cannot tell
 * "I only wanted the number type" from "I am about to run a query", and it
 * should not have to. Prisma's own decimal *is* `decimal.js` underneath, so the
 * repository's values arrive here unchanged and go back as strings.
 */

export const ZERO = new Decimal(0);

/** A tariff as the invoice builder needs it. Shaped from `FundingRule`. */
export interface Tariff {
  readonly id: string;
  readonly name: string;
  readonly invoiceItemKind: InvoiceLineType;
  readonly ageBand: string | null;
  readonly dailyRate: Decimal | null;
  readonly monthlyRate: Decimal | null;
  readonly dependsOnAttendance: boolean;
  readonly dependsOnMeals: boolean;
}

/** What one child's month looked like, as counters a tariff multiplies. */
export interface BillingCounts {
  readonly daysAttended: number;
  readonly daysFed: number;
}

export interface DraftLine {
  readonly kind: InvoiceLineType;
  readonly label: string;
  readonly quantity: Decimal;
  readonly unitAmount: Decimal;
  readonly amount: Decimal;
  readonly fundingRuleId: string;
}

/**
 * What one tariff charges one child for one month.
 *
 * ★ The three cases come from `нэмэлт.md` §5's own flags, and the mapping is
 * deliberately literal rather than clever:
 *
 *   - `dependsOnAttendance` → daily rate × days attended
 *   - `dependsOnMeals`      → daily rate × days fed
 *   - neither               → the flat monthly rate
 *
 * A tariff that sets both flags bills on attendance: charging a family twice
 * for one day under one tariff is never what "depends on both" could mean, and
 * silently summing them would be a bill nobody could explain. A kindergarten
 * wanting tuition *and* meal charges creates two rules, which is exactly what
 * `invoiceItemKind` exists to distinguish.
 *
 * Returns `null` when the tariff cannot produce a line — no rate configured, or
 * a zero count. A zero-amount line on a bill is noise the parent has to read
 * past.
 */
export function lineFor(tariff: Tariff, counts: BillingCounts): DraftLine | null {
  const base = {
    kind: tariff.invoiceItemKind,
    label: tariff.name,
    fundingRuleId: tariff.id,
  };

  if (tariff.dependsOnAttendance || tariff.dependsOnMeals) {
    if (!tariff.dailyRate) return null;

    const days = tariff.dependsOnAttendance ? counts.daysAttended : counts.daysFed;
    if (days <= 0) return null;

    const quantity = new Decimal(days);
    return {
      ...base,
      quantity,
      unitAmount: tariff.dailyRate,
      amount: tariff.dailyRate.mul(quantity),
    };
  }

  if (!tariff.monthlyRate || tariff.monthlyRate.isZero()) return null;

  return {
    ...base,
    quantity: new Decimal(1),
    unitAmount: tariff.monthlyRate,
    amount: tariff.monthlyRate,
  };
}

/**
 * An invoice's headline figures — `нэмэлт.md` §7.
 *
 * `Нийт төлөх дүн = (Σ lines) − Хөнгөлөлт + Өмнөх үлдэгдэл`
 *
 * ★ The total is clamped at zero. A discount larger than the charges would
 * otherwise produce a negative bill, which is a refund wearing an invoice's
 * clothes — §8 has a `REFUNDED` state and a reversing payment for that, and
 * letting it happen here would put money owed *to* a parent in the same column
 * as money owed *by* them. Every report summing `totalAmount` would then be
 * quietly wrong.
 */
export function invoiceTotals(input: {
  lines: readonly { amount: Decimal }[];
  discountAmount: Decimal;
  previousBalance: Decimal;
}): { subtotalAmount: Decimal; totalAmount: Decimal } {
  const subtotalAmount = input.lines.reduce((sum, line) => sum.add(line.amount), ZERO);
  const total = subtotalAmount.sub(input.discountAmount).add(input.previousBalance);

  return {
    subtotalAmount,
    totalAmount: total.isNegative() ? ZERO : total,
  };
}

/**
 * What an invoice's status is, given what has been received against it.
 *
 * ★ Derived, never typed in. A status column a human can set drifts from the
 * payments beneath it, and then the overdue report and the invoice screen
 * disagree about whether a family has paid — with the family holding a receipt.
 *
 * ★★ `REFUNDED` is the one status this does not compute. It is a decision an
 * accountant makes when reversing a settled invoice, not a fact about the
 * arithmetic: a fully reversed invoice has a zero paid total, which is
 * indistinguishable here from one never paid at all. The service preserves it.
 */
export function statusFor(input: {
  totalAmount: Decimal;
  paidAmount: Decimal;
  dueDate: Date | null;
  now: Date;
  current: InvoiceStatus;
}): InvoiceStatus {
  if (input.current === "REFUNDED") return "REFUNDED";

  // `cmp` rather than `>=`: comparing Decimals with JavaScript's relational
  // operators coerces both to numbers, reintroducing the float error this
  // module exists to avoid.
  if (input.paidAmount.cmp(input.totalAmount) >= 0 && !input.totalAmount.isZero()) {
    return "PAID";
  }

  const overdue = input.dueDate !== null && input.now > input.dueDate;

  if (input.paidAmount.isPositive() && !input.paidAmount.isZero()) {
    return overdue ? "OVERDUE" : "PARTIALLY_PAID";
  }

  return overdue ? "OVERDUE" : "UNPAID";
}

/**
 * The next invoice number in a kindergarten's yearly sequence.
 *
 * `2026-000042` — the year, then a zero-padded counter. Scoped per kindergarten
 * by `@@unique([kindergartenId, number])`, so two kindergartens issuing their
 * forty-second invoice of the year do not collide, and a parent quoting
 * "2026-000042" on a transfer is unambiguous within the one that billed them.
 *
 * ★ Derived from the highest number already issued rather than from a count.
 * A count would reuse a number after a void — `lastInvoiceNumber` deliberately
 * includes soft-deleted rows — and two different documents answering to one
 * reference is the kind of error that surfaces in a dispute.
 */
export function nextInvoiceNumber(year: number, lastNumber: string | null): string {
  const prefix = `${year}-`;
  const previous = lastNumber?.startsWith(prefix)
    ? Number.parseInt(lastNumber.slice(prefix.length), 10)
    : 0;
  const next = Number.isFinite(previous) ? previous + 1 : 1;

  return `${prefix}${String(next).padStart(6, "0")}`;
}

/** The prefix `lastInvoiceNumber` searches on, kept beside the format it matches. */
export function invoiceNumberPrefix(year: number): string {
  return `${year}-`;
}

/**
 * A month string (`"2026-03"`) as the first and last day of that month, in UTC.
 *
 * ★ UTC on purpose. `@db.Date` columns hold a calendar date with no zone, and
 * building the bounds with a local-time constructor makes the month shift by a
 * day for anyone running the server outside UTC — a child's last attendance of
 * March lands in April's invoice, and the totals stop reconciling with the
 * funding calculation that used a different boundary.
 */
export function monthBounds(month: string): { from: Date; to: Date; first: Date } {
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const to = new Date(Date.UTC(year, monthIndex, 0));

  return { from: first, to, first };
}
