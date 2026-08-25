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
/**
 * ★★★ Half a row, holding two cards — not a full-width grid of its own.
 *
 * This rendered `<section className="grid grid-cols-2">` at the page's full
 * width, which stretched two short numbers across the whole viewport: "Хүүхэд
 * 5" filling 600px of a 1200px screen with nothing beside it. That was a
 * leftover rather than a decision — the row held four tiles until two were
 * removed as duplicates of the sections below them, and nothing revisited the
 * columns the survivors sat in.
 *
 * It is one cell of the page's twelve-column grid now, spanning six, with the
 * two counts sharing it. So the numbers end up a quarter of the width each and
 * the group's assessment card takes the other half of the row.
 *
 * ★★★★ The `<section>` stays a real element rather than becoming a fragment or
 * a `display: contents` wrapper. Both would let the cards sit directly in the
 * page grid, and both would cost the landmark: a fragment has nowhere to hang
 * `aria-label`, and `display: contents` has a history of dropping elements out
 * of the accessibility tree. Two bare numbers announced with no name is a worse
 * outcome than a column span this component has to know about.
 */
export function DashboardStats({ counts }: { counts: TeacherDashboard["counts"] }) {
  return (
    <section
      aria-label="Өнөөдрийн тойм"
      className="grid grid-cols-2 gap-4 sm:col-span-2 lg:col-span-6 lg:gap-5"
    >
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
