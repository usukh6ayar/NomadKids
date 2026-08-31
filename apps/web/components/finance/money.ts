/**
 * Money, formatted from the decimal **string** the API sends.
 *
 * ★ Never `Number(value)`. The API deliberately serialises every amount as a
 * decimal string (`invoices.dto.ts`, `contracts/domain.ts`), because a JSON
 * number is an IEEE 754 double and a bill a family is asked to pay cannot pass
 * through one. Parsing it here to format it would reintroduce exactly the error
 * the whole chain avoids — and it would do so in the last place anyone thinks
 * to look, the one that renders the figure.
 *
 * So the string is split on its decimal point and the integer part is grouped
 * by hand. `"126900.00"` → `"126 900₮"`, `"126900.50"` → `"126 900.50₮"`.
 *
 * ★★ A non-breaking space between the thousands, so a total never wraps across
 * two lines mid-number on a phone.
 */
export function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", cents] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const body = cents && cents !== "00" ? `${grouped}.${cents}` : grouped;

  return `${negative ? "−" : ""}${body}₮`;
}

/** `"2026-02"` → `"2026 оны 2 сар"`. */
export function monthLabel(month: string): string {
  const [year, index] = month.split("-");
  if (!year || !index) return month;
  return `${year} оны ${Number(index)} сар`;
}
