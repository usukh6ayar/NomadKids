/**
 * The assessed-share of a roster, as a whole percent.
 *
 * ★ Its only job is the guard, and the guard is why it is shared.
 *
 * A group with no children is a real state on the first day of a school year,
 * and `Math.round(0 / 0)` renders the string "NaN%" on the dashboard. Two
 * components show this number — the stat tile and the progress bar — so the
 * division lives in one place rather than being written correctly once and
 * copied a third time by whoever adds the next one.
 *
 * `flows.test.tsx` pins the behaviour ("does not print NaN when the roster is
 * empty").
 */
export function percentOf({ assessed, total }: { assessed: number; total: number }): number {
  if (total <= 0) return 0;
  return Math.round((assessed / total) * 100);
}
