import type { z } from "zod";
import type { termSchema } from "@kinder/contracts";

export type Term = z.infer<typeof termSchema>;

/**
 * Which of the school year's three terms a date falls in.
 *
 * ★ Lifted out of `child-observations.tsx` on 2026-09-10, when the survey list
 * wanted the same answer. It was private there, which is fine until a second
 * screen needs it — at which point the choice is lifting it or copying it, and
 * a copy is where one of the two stops getting the fix. The same reasoning
 * `ui/disclosure.tsx` records for its own move.
 *
 * ★★ The fallback is not a guess at the configured terms — it is what to say
 * when a kindergarten has not configured any.
 *
 * `Term` rows are administrator-editable (CLAUDE.md §2.3), so a fresh
 * deployment has none, and a register that refused to group until somebody
 * filled in a settings screen would be a blank page on day one. September
 * onwards is the first term, January to March the second, the rest the third —
 * the Mongolian school year, which is what the fallback is allowed to assume
 * when nothing more specific has been said.
 */
export function termNumberForDay(day: string, terms: Term[]): number {
  const configured = terms.find(
    (candidate) =>
      candidate.startsOn &&
      candidate.endsOn &&
      day >= candidate.startsOn &&
      day <= candidate.endsOn,
  );
  if (configured && configured.number >= 1 && configured.number <= 3) return configured.number;

  const month = Number(day.slice(5, 7));
  if (month >= 9) return 1;
  if (month <= 3) return 2;
  return 3;
}

/** "1-р улирал" — the heading a grouped list uses. */
export function termLabel(number: number): string {
  return `${number}-р улирал`;
}

/** The three, in order, for a picker or a set of headings. */
export const TERM_NUMBERS = [1, 2, 3] as const;
