/**
 * Ажлын өдөр — how many days a month is actually worked.
 *
 * ★ Weekdays minus Mongolia's public holidays, not a count of attendance rows.
 *
 * The client's own definition, 2026-09-12: "тухайн сард ажиллах хоног … 9 сард
 * бямба ням гарагт ажиллахгүй, бас нийтээр амрах баяр тохиолдоогүй учир ажлын
 * 22 хоногтой." It is what the month *should* hold, so a month with an
 * unmarked day reads as a gap in the register rather than as a shorter month.
 *
 * ★★ Lives in contracts because two screens need the same answer: the family's
 * "Ирцийн нэгтгэл" and the teacher's report. Two implementations of a
 * denominator is two different attendance percentages for one month.
 */

/**
 * Нийтээр амрах баярын өдрүүд that fall on the same date every year —
 * Хөдөлмөрийн тухай хууль.
 *
 * `MM-DD`. Цагаан сар is **not** here: it follows the lunar calendar and moves,
 * so it lives in `LUNAR_NEW_YEAR` below where a wrong guess cannot hide.
 */
const FIXED_HOLIDAYS = [
  "01-01", // Шинэ жил
  "03-08", // Олон улсын эмэгтэйчүүдийн эрхийг хамгаалах өдөр
  "06-01", // Эх үрсийн баяр
  "07-11", // Үндэсний их баяр наадам
  "07-12",
  "07-13",
  "07-14",
  "07-15",
  "11-26", // Бүгд Найрамдах Улс тунхагласан өдөр
  "12-29", // Тусгаар тогтнолоо сэргээсэн өдөр
] as const;

/**
 * Цагаан сарын шинийн 1–3, by year.
 *
 * ★ Empty on purpose, and this is the honest state rather than an oversight.
 *
 * The date moves with the lunar calendar and cannot be computed from the
 * Gregorian one. Seeding it with dates nobody has checked would quietly shorten
 * a February by three days in a figure a kindergarten reads as fact — so until
 * the real dates are supplied, February and March are counted as ordinary
 * months and the error is visible rather than invented.
 *
 * ★★ This is the point at which §2.3 applies: the moment a kindergarten needs
 * to close on a day of its own, or to correct one of these, holidays become a
 * table and this constant goes away. One year of hand-entered dates is the
 * cheapest thing that works; two is the signal to build the table.
 *
 * Keys are years; values are `YYYY-MM-DD`, three days each.
 */
const LUNAR_NEW_YEAR: Record<number, readonly string[]> = {};

/** Every non-working date in a month, as `YYYY-MM-DD`. */
function holidaysIn(year: number, month: number): Set<string> {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const dates = new Set<string>();

  for (const day of FIXED_HOLIDAYS) {
    if (day.startsWith(`${String(month).padStart(2, "0")}-`)) dates.add(`${year}-${day}`);
  }
  for (const day of LUNAR_NEW_YEAR[year] ?? []) {
    if (day.startsWith(prefix)) dates.add(day);
  }

  return dates;
}

/**
 * The working days in a `YYYY-MM`.
 *
 * ★ A holiday landing on a Saturday takes nothing off, because that day was
 * never worked. The subtraction is over weekdays only, which is why the check
 * happens inside the loop rather than as `weekdays - holidays.size`.
 *
 * Returns `null` for a month it cannot read, so a caller renders nothing rather
 * than a confident zero.
 */
export function workingDaysInMonth(month: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;

  const holidays = holidaysIn(year, monthNumber);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  let count = 0;
  for (let day = 1; day <= lastDay; day += 1) {
    const weekday = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    const iso = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (holidays.has(iso)) continue;

    count += 1;
  }

  return count;
}
