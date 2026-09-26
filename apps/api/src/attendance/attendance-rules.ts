import { localDate } from "@kinder/contracts";

/**
 * Who may record and request attendance.
 *
 * Pure predicates, no database — same split as `authz/child-access.ts` and
 * `observations/observation-rules.ts`.
 */

/**
 * A date, as a plain `YYYY-MM-DD` string comparison against "today" in the
 * same form. Recording tomorrow's attendance today is not a thing a
 * kindergarten does.
 *
 * ★ Today is Ulaanbaatar's, not UTC's — 2026-09-26. `date` is a DATE column's
 * UTC-midnight key, so its UTC date *is* the calendar day; `now` is an instant
 * and has to be read on the kindergarten's clock. Comparing both in UTC refused
 * today's register from local midnight to 08:00 — the hour it is taken.
 */
export function isFutureDate(date: Date, now: Date = new Date()): boolean {
  return date.toISOString().slice(0, 10) > localDate(now);
}

/** A request's range must not end before it starts. */
export function isValidRange(dateFrom: Date, dateTo: Date): boolean {
  return dateFrom.getTime() <= dateTo.getTime();
}
