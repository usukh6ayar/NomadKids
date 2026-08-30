import { Card } from "@/components/ui/card";
import { Ring } from "@/components/ui/chart/ring";
import { TONE_VAR, type Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";

/**
 * How far through a register you are, and what it says so far.
 *
 * ★ The three group registers ask the same two questions and answered neither.
 *
 * Ирц, Хоол ба цэс and Үнэлгээ are the same screen three times — a group's
 * children, one row each, one choice per row — and a teacher working down one
 * of them wants exactly two things they could not get: **how many are left**,
 * and **what the group looks like so far**. Attendance showed neither ("18
 * хүүхэд" and nothing else), meals showed a bare "14/18 бүртгэсэн", assessment
 * showed the headcount. All three had to be counted by eye, on a phone, while
 * being interrupted.
 *
 * ★★ The unrecorded count is the headline, not the recorded one.
 *
 * "14 бүртгэсэн" is a fact about the past; "4 үлдсэн" is the instruction. A
 * teacher stops when that number is zero, so it is the number the ring is
 * about and the one written in words beside it.
 *
 * ★★★ The breakdown is not a chart, and deliberately.
 *
 * `BarRow` and `Donut` exist and are the right shape for a page of analytics.
 * This sits above a list somebody is actively editing on a 390px screen: every
 * pixel it takes is a row they cannot see. A wrapped line of tinted counts is
 * readable at a glance, costs one line on a phone, and — unlike a donut — still
 * says which colour is which without a legend.
 */

export interface RegisterCount {
  /** Stable across renders — the status code, not the label. */
  key: string;
  label: string;
  count: number;
  tone: Tone;
}

export function RegisterProgress({
  recorded,
  total,
  /** What has been recorded — "бүртгэсэн" for a register, "үнэлсэн" for assessment. */
  verb = "бүртгэсэн",
  breakdown,
  className,
}: {
  recorded: number;
  total: number;
  verb?: string;
  /**
   * The counts to show, in a fixed order the caller decides.
   *
   * ★ Never sorted by size here. A register's statuses have a natural order —
   * Ирсэн before Тасалсан, best to worst — and re-ordering them as the day
   * goes on makes a reader re-find the column they were watching. Entries at
   * zero are dropped, not hidden at the end, because a zero carries no
   * information a reader needs while working.
   */
  breakdown: RegisterCount[];
  className?: string;
}) {
  const remaining = Math.max(total - recorded, 0);
  const percent = total === 0 ? 0 : Math.round((recorded / total) * 100);
  const shown = breakdown.filter((item) => item.count > 0);

  return (
    <Card
      className={cn("flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5 sm:px-5", className)}
    >
      {/*
        ★ The ring carries the label, because here it is the only thing that
        carries it — `Ring`'s own doc asks for exactly that case. Everywhere
        else in the product the figure is repeated as text on the same card.
      */}
      <div className="flex items-center gap-3">
        <Ring
          percent={percent}
          size="sm"
          tone={remaining === 0 ? "mint" : "sky"}
          muted={total === 0}
          label={`${total} хүүхдээс ${recorded} нь ${verb}`}
        />

        <div className="min-w-0">
          {/*
            ★ `tabular-nums` on the line, not around each figure.

            Wrapping the digits in their own spans splits the text node, so
            "0/2 бүртгэсэн" stops being findable as one string — which is how
            the meal register's own tests broke the first time this was
            written. The whole line is numerals and words either way, and
            lining up the digits is what the class is for.
          */}
          <p className="text-lead font-semibold leading-tight tabular-nums text-ink">
            {/*
              ★ "Хүүхэд алга", not a dash.

              `Ring` already draws a muted track with "—" in it when there is
              nothing to be a percentage of. Repeating that dash as the headline
              says the same nothing twice; naming the reason says why the
              register below is empty.
            */}
            {total === 0
              ? "Хүүхэд алга"
              : remaining === 0
                ? "Бүгд бүртгэгдсэн"
                : `${remaining} үлдсэн`}
          </p>
          <p className="text-caption tabular-nums text-muted">
            {recorded}/{total} {verb}
          </p>
        </div>
      </div>

      {shown.length > 0 ? (
        /*
          `ms-auto` on desktop only: on a phone the counts wrap onto their own
          line and pushing them right would leave a ragged gap mid-row.
        */
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 sm:ms-auto">
          {shown.map((item) => (
            <li key={item.key} className="flex items-center gap-1.5 text-caption text-muted">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-pill"
                style={{ background: TONE_VAR[item.tone] }}
              />
              {item.label}
              <span className="font-semibold tabular-nums text-ink">{item.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
