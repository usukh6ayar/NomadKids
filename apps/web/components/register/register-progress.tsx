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
  /**
   * Rendered inside the card above the list rather than as a card of its own.
   *
   * ★ It is where this belongs, and the standalone version was the mistake.
   *
   * Each register opens with a white card holding its controls — the date, the
   * sitting, the term and domain — and the progress was a *second* card under
   * it. Two stacked white blocks saying different things about the same sheet
   * pushed the first child of the register below the fold on a phone, and the
   * one a teacher reads at a glance was the lower of the two.
   *
   * Inside, it is a footer to the controls: no second border, no second
   * shadow, one hairline separating it from the fields, and the whole strip a
   * step quieter — it is a readout, not a heading.
   */
  inset = false,
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
  inset?: boolean;
  className?: string;
}) {
  const remaining = Math.max(total - recorded, 0);
  const percent = total === 0 ? 0 : Math.round((recorded / total) * 100);
  const shown = breakdown.filter((item) => item.count > 0);

  const Frame = inset ? "div" : Card;

  return (
    <Frame
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-3",
        inset ? "border-t border-border-soft pt-3.5" : "px-4 py-3.5 sm:px-5",
        className,
      )}
    >
      {/*
        ★ The ring carries the label, because here it is the only thing that
        carries it — `Ring`'s own doc asks for exactly that case. Everywhere
        else in the product the figure is repeated as text on the same card.
      */}
      <div className="flex items-center gap-3">
        {/*
          `md` inset, `lg` standalone — one step up from what this used to
          draw, at the client's request. The ring is the only thing on the
          strip a teacher reads from across a room.
        */}
        <Ring
          percent={percent}
          size={inset ? "md" : "lg"}
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
          <p
            className={cn(
              "font-semibold leading-tight tabular-nums text-ink",
              inset ? "text-body" : "text-lead",
            )}
          >
            {/*
              ★ "Хүүхэд алга", not a dash.

              `Ring` already draws a muted track with "—" in it when there is
              nothing to be a percentage of. Repeating that dash as the headline
              says the same nothing twice; naming the reason says why the
              register below is empty.
            */}
            {/*
              ★ The count, not "Бүгд бүртгэгдсэн" — 2026-09-10, at the client's
              request. "All registered" is a state, and a teacher checking a
              register wants the number: it is what they compare against the
              children in front of them, and "бүгд" cannot be compared with
              anything. The line below still says what is left.
            */}
            {total === 0 ? "Хүүхэд алга" : `${recorded} хүүхэд ${verb}`}
          </p>
          <p className="text-caption tabular-nums text-muted">
            {total === 0
              ? "—"
              : remaining === 0
                ? `${total} хүүхдээс бүгд`
                : `${total} хүүхдээс · ${remaining} үлдсэн`}
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
    </Frame>
  );
}
