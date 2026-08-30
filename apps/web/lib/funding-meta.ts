import type { RegisterState } from "@kinder/contracts";

/**
 * The register's own labels and tones — нэмэлт.md §6.
 *
 * ★ The state badge reuses the product's status palette, it does not invent
 * a financial one.
 *
 * The words themselves come from `@kinder/contracts` — the API's spreadsheet
 * writes the same five and must not disagree. Only the colour is decided here,
 * because a spreadsheet has none.
 *
 * `CHECK` is `danger` for the same reason `ABSENT` is in `attendance-meta.ts`:
 * it is the one outcome that means something is wrong, and a reader scanning
 * two hundred rows for trouble should find it with the same colour they already
 * associate with trouble everywhere else in this product.
 */
export { REGISTER_STATE_LABEL } from "@kinder/contracts";

export const REGISTER_STATE_TONE: Record<RegisterState, "mint" | "sun" | "danger" | "neutral"> = {
  CHECK: "danger",
  MISSING_DOCUMENT: "sun",
  SETTLED: "mint",
  CALCULATED: "neutral",
  PENDING: "neutral",
};

/** What the badge means, spelled out — the table's own legend and each row's title. */
export const REGISTER_STATE_HINT: Record<RegisterState, string> = {
  CHECK: "Хоолны бүртгэл ирцээс их байна — хоёрын аль нэг нь буруу.",
  MISSING_DOCUMENT: "Тасалсан хоногт баталгаажсан чөлөөний хүсэлт алга.",
  SETTLED: "Баталгаажсан эсвэл хүлээн авсан дүн бүртгэгдсэн.",
  CALCULATED: "Тооцоо хийгдсэн, шийдвэрлэх зүйл алга.",
  PENDING: "Энэ сард тооцоо хийгдээгүй байна.",
};

/**
 * Tögrög, grouped, with the sign — "₮2,450,000".
 *
 * ★ Takes the API's decimal **string**, not a number.
 *
 * `funding.dto.ts` explains why money crosses the wire as a string: a tariff
 * has to survive the round trip to `DECIMAL(12,2)` unchanged. Parsing it here,
 * at the last possible moment and only to format it, keeps that promise — the
 * value is never held as a float anywhere a total is computed from it.
 */
export function formatTugrug(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";

  return `₮${new Intl.NumberFormat("mn-MN").format(Math.round(amount))}`;
}

/** The current month as `YYYY-MM`, in local time — the month a person is in. */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** `YYYY-MM` shifted by whole months, without rolling a day-of-month over. */
export function shiftMonth(month: string, by: number): string {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + by, 1));

  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}
