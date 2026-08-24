/**
 * Display formatting.
 *
 * Mongolian conventions, and every function tolerates null — these run against
 * live API data where "not recorded yet" is the normal case for most fields,
 * and a formatter that throws on null turns a missing birthday into a blank
 * screen.
 */

const MONTHS = [
  "1-р сар",
  "2-р сар",
  "3-р сар",
  "4-р сар",
  "5-р сар",
  "6-р сар",
  "7-р сар",
  "8-р сар",
  "9-р сар",
  "10-р сар",
  "11-р сар",
  "12-р сар",
];

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `2026.08.19` — compact, unambiguous, and what the reference system used. */
export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}.${m}.${d}`;
}

/** `2026 оны 8-р сарын 19` — for a heading, where the date is the subject. */
export function formatLongDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${date.getFullYear()} оны ${MONTHS[date.getMonth()]}ын ${date.getDate()}`;
}

/**
 * "3 хоногийн өмнө".
 *
 * Falls back to an absolute date past a fortnight: "23 хоногийн өмнө" is
 * harder to place than the date itself.
 */
export function formatRelative(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";

  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / 86_400_000);

  if (diffMs < 0) return formatDate(date);
  if (days === 0) return "Өнөөдөр";
  if (days === 1) return "Өчигдөр";
  if (days < 14) return `${days} хоногийн өмнө`;
  return formatDate(date);
}

/**
 * Age in years, or years and months while under two.
 *
 * Under two the month matters — the difference between a 14-month-old and a
 * 23-month-old is most of what a nursery teacher plans around.
 */
export function formatAge(dateOfBirth: string | Date | null | undefined): string {
  const months = monthsSinceBirth(dateOfBirth);
  if (months === null) return "—";

  const years = Math.floor(months / 12);
  const rest = months % 12;

  if (years < 2) return rest === 0 ? `${years} нас` : `${years} нас ${rest} сар`;
  return `${years} нас`;
}

/**
 * Whole years since birth. `null` when the date is missing or in the future.
 *
 * ★ Shares `monthsSinceBirth` with `formatAge` rather than recomputing.
 *
 * The portfolio prints an age with one and decides which age sections open with
 * the other. Two independent date calculations for one fact disagree on exactly
 * one day a year — the child's birthday — which is both the day it matters most
 * and the day nobody is testing on.
 */
export function ageInYears(dateOfBirth: string | Date | null | undefined): number | null {
  const months = monthsSinceBirth(dateOfBirth);
  return months === null ? null : Math.floor(months / 12);
}

/** Completed months since `dateOfBirth`; `null` if absent or not yet reached. */
function monthsSinceBirth(dateOfBirth: string | Date | null | undefined): number | null {
  const dob = toDate(dateOfBirth);
  if (!dob) return null;

  const now = new Date();
  let months = (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
  // The month has turned but the day has not: still the previous month.
  if (now.getDate() < dob.getDate()) months -= 1;

  return months < 0 ? null : months;
}

/** `Ганболд Батбаяр` — surname first, as Mongolian names are written. */
export function fullName(
  person: { lastName?: string | null; firstName?: string | null } | null | undefined,
): string {
  if (!person) return "—";
  return [person.lastName, person.firstName].filter(Boolean).join(" ") || "—";
}

/** Initials for a photoless avatar. */
export function initials(
  person: { lastName?: string | null; firstName?: string | null } | null | undefined,
): string {
  const first = person?.firstName?.trim()?.[0] ?? "";
  const last = person?.lastName?.trim()?.[0] ?? "";
  return (first || last || "?").toUpperCase();
}

/** `4.7 MB` */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Truncates on a word boundary so a preview does not end mid-word. */
export function excerpt(text: string | null | undefined, max = 120): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}
