import type { TeacherDashboard } from "@kinder/contracts";
import { Card } from "@/components/ui/card";

/**
 * How big this teacher's world is — and nothing else.
 *
 * ★ This row was four tiles, and two of them were already on the screen.
 *
 * "Улирлын явц" showed `47%` and `12 / 26 үнэлэгдсэн` about three hundred pixels
 * above a `TermProgress` section showing `12 / 26 хүүхэд үнэлэгдсэн` and `47%`.
 * The argument for keeping both was that the tile summarises and the section
 * details — but the tile carried *both* numbers, so it was not a summary of the
 * section, it was the section minus the bar.
 *
 * `term-progress.tsx` settled it in its own note: "only one of the two is a
 * `progressbar` an assistive technology can report." That is a reason to keep
 * the bar, not the tile.
 *
 * "Хянах" was the same shape of duplication with a sharper edge: a number you
 * could not act on, directly above the same number on an alert card that
 * carries the button. A count with no verb teaches people to look past the row.
 *
 * ★★ What is left is two counts, which is the point.
 *
 * The docblock this component has always carried opens "Context, not the point
 * of the screen" and warns that "a dashboard whose largest elements are four
 * numbers teaches a teacher to read numbers rather than to act". Four tiles were
 * arguing with that sentence. Two agree with it.
 */
export function DashboardStats({ counts }: { counts: TeacherDashboard["counts"] }) {
  return (
    <section aria-label="Өнөөдрийн тойм" className="grid grid-cols-2 gap-3">
      <Stat label="Хүүхэд" value={counts.children} />
      <Stat label="Бүлэг" value={counts.groups} />
    </section>
  );
}

/**
 * One tile.
 *
 * ★ No `tone` and no `detail` any more. Both existed for the two tiles that are
 * gone — the tint marked a share rather than a count, and the detail line
 * disambiguated a bare number. A count of children needs neither, and a prop
 * nothing passes is the next person's puzzle.
 */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card pad="compact">
      <p className="text-body text-muted">{label}</p>
      <p className="mt-1 text-display font-semibold tabular-nums text-ink">{value}</p>
    </Card>
  );
}
