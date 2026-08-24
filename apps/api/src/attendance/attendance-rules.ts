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
 */
export function isFutureDate(date: Date, now: Date = new Date()): boolean {
  const dateOnly = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const nowOnly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return dateOnly.getTime() > nowOnly.getTime();
}

/** A request's range must not end before it starts. */
export function isValidRange(dateFrom: Date, dateTo: Date): boolean {
  return dateFrom.getTime() <= dateTo.getTime();
}
