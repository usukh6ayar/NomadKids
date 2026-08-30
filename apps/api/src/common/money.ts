/**
 * Exact arithmetic on money, without importing Prisma into a service.
 *
 * ★ Why this exists rather than `Prisma.Decimal`.
 *
 * `Prisma.Decimal` is decimal.js and would do this correctly — but reaching for
 * it means `import { Prisma } from "../generated/prisma/client"` in a service,
 * which CLAUDE.md §2.2's ESLint rule refuses and is right to: the import that
 * carries `Decimal` is the same one that carries `PrismaClient`, and a rule
 * that has to distinguish "this file only wanted the arithmetic" is a rule
 * nobody can enforce mechanically. Repositories hand out strings (see
 * `funding.repository.ts`, which has always done this); this is what a service
 * does with them.
 *
 * ★★ Integers in the smallest unit, not floats.
 *
 * Every amount is scaled by 100 and held as a JS integer — ₮126,900.00 is
 * 12,690,000. Addition and multiplication are then exact, where `0.1 + 0.2` in
 * IEEE 754 is famously not, and these are the figures a bank statement is
 * reconciled against.
 *
 * The ceiling is `Number.MAX_SAFE_INTEGER` — 2^53, about ₮90 trillion once
 * scaled. A kindergarten platform reaching it has larger questions than this
 * file, and `parseMoney` throws rather than silently losing precision if one
 * ever does.
 */

/** `"126900.00"` → `12690000`. Also accepts `"126900"` and `""`. */
export function parseMoney(value: string | null | undefined): number {
  if (!value) return 0;

  const [whole = "0", fraction = ""] = value.trim().split(".");
  const cents = `${fraction}00`.slice(0, 2);
  const scaled = Number(`${whole}${cents}`);

  if (!Number.isSafeInteger(scaled)) {
    throw new Error(`Дүн хэт том байна: ${value}`);
  }
  return scaled;
}

/** `12690000` → `"126900.00"`. Always two decimals — this is money. */
export function formatMoney(scaled: number): string {
  const negative = scaled < 0;
  const abs = Math.abs(Math.round(scaled));
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${cents}`;
}

/**
 * A percentage of an amount, both exact.
 *
 * `percent` arrives as a decimal string ("12.5") and is scaled by 100 the same
 * way, so the division is by 10,000 rather than by 100. Rounded half-up at the
 * last мөнгө, and the caller is expected to report what the roundings leave
 * over rather than absorb it — see `PlatformRevenueService.distribution`.
 */
export function percentOf(scaledAmount: number, percent: string): number {
  const scaledPercent = parseMoney(percent);
  return Math.round((scaledAmount * scaledPercent) / 10_000);
}

/** Sums decimal strings without ever holding a float. */
export function sumMoney(values: (string | null | undefined)[]): number {
  return values.reduce<number>((total, value) => total + parseMoney(value), 0);
}
