import type { TeacherDashboard } from "@kinder/contracts";
import { Card, SectionHeader } from "@/components/ui/card";
import { percentOf } from "./percent";

/**
 * This term's assessment progress — RFP §12.1 "улирлын үнэлгээний явц".
 *
 * ★ A bar, not a chart.
 *
 * The requested design put a radar chart here. Charts are excluded from the MVP
 * (CLAUDE.md §7) and a radar of one term's averages would need a charting
 * dependency to say something a sentence says better. This is one number, its
 * denominator, and a rule showing the ratio — readable at a glance and
 * announced properly to a screen reader, which a canvas chart is not.
 *
 * The stat tile above shows the same percentage. That is a summary and this is
 * its detail: the tile answers "how far along", the bar answers "out of how
 * many, and is that nearly done" — and only one of the two is a `progressbar`
 * an assistive technology can report.
 */
export function TermProgress({
  term,
  progress,
}: {
  term: string;
  progress: TeacherDashboard["termProgress"];
}) {
  const { assessed, total } = progress;
  const percent = percentOf(progress);

  return (
    <section aria-label="Улирлын үнэлгээний явц">
      <SectionHeader title="Улирлын үнэлгээний явц" lede={term} />
      <Card className="px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-body text-muted">
            <span className="text-title font-semibold tabular-nums text-ink">{assessed}</span>
            {" / "}
            <span className="tabular-nums">{total}</span> хүүхэд үнэлэгдсэн
          </p>
          <p className="text-body font-medium tabular-nums text-primary-strong">{percent}%</p>
        </div>

        {/* Track: `--color-track` (slate-100), one step darker than the canvas
            so the empty part of the bar is visible on a white card rather than
            disappearing into it. */}
        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-pill bg-track"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${term} үнэлгээний явц`}
        >
          {/* Fill: `--color-primary` (blue-700). Nothing sits on top of it, but
              it is the same blue as the buttons on purpose — a progress bar in
              a second brand shade reads as a different kind of thing. */}
          <div
            className="h-full rounded-pill bg-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      </Card>
    </section>
  );
}
