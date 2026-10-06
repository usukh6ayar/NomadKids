/**
 * A 1–5 rating as stars — «4» → «★★★★☆». Client, 2026-10-06: ratings are
 * answered and read back as stars. Anything outside 1–5 (or not a number)
 * comes back as the raw value, so a bad row is visible rather than hidden.
 */
export function stars(value: unknown): string {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return String(value);
  return "★".repeat(n) + "☆".repeat(5 - n);
}
