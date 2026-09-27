/**
 * "Today", as the kindergarten's wall clock reads it.
 *
 * ★ Added 2026-09-26. Every screen and the API computed today as
 * `new Date().toISOString().slice(0, 10)` — the **UTC** date. Mongolia is
 * UTC+8, so from local midnight to 08:00 that is still yesterday: a teacher
 * opening the register at 07:45 was shown yesterday's sheet, could not pick
 * today (the picker is capped at "today"), and the API refused today's marks
 * as a future date. The morning register is exactly the hour this broke.
 *
 * ★★ By IANA zone rather than a fixed +8. Mongolia has used and dropped
 * daylight saving before (last in 2016); the zone database is what follows
 * that, and a hard-coded offset would silently drift if it came back.
 *
 * ★★★ One zone for the product, not a column per kindergarten. Every tenant
 * this product serves is in Mongolia, and the day a second country appears is
 * the day this becomes a `Kindergarten` setting — not before.
 */
export const KINDERGARTEN_TIME_ZONE = "Asia/Ulaanbaatar";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KINDERGARTEN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` in Ulaanbaatar. `en-CA` formats dates in exactly that order. */
export function localDate(now: Date = new Date()): string {
  return formatter.format(now);
}

/** `YYYY-MM` in Ulaanbaatar. */
export function localMonth(now: Date = new Date()): string {
  return localDate(now).slice(0, 7);
}
