import { cn } from "@/lib/utils";
import { TONE_VAR, type Tone } from "@/components/ui/tone";
import { clampPercent } from "./chart-tokens";

/**
 * A vertical bar chart — a small number of named columns, each a percentage.
 *
 * ★ `<div>`s with heights, not an SVG.
 *
 * `bar-row.tsx` argued this for the horizontal case ("a bar is a box, and a box
 * is what CSS is for") and the argument does not change when the box stands up:
 * an SVG would cost a viewBox, a scale and a `<text>` element that needs its own
 * font size, none of which the rest of the product would share. It is also what
 * keeps this file inside `tokens.test.tsx`'s rule — hand-written `<svg>` is
 * banned outside `components/ui/chart/`, and the point of that rule is that
 * stroke weight and scale are not per-file decisions, not that this directory
 * may quietly make them.
 *
 * ★★ A column with no data is not a column of zero.
 *
 * `value: null` renders an empty track where a 0 would render a flat bar on the
 * axis, and the two mean opposite things: "nobody has said yet" against
 * "nobody came". `attendance-today.tsx` makes the same distinction its central
 * argument ("Nobody has marked the register yet is its own state, not 0%"), and
 * a week chart is where that case is the common one — on a Tuesday, three of
 * five columns have not happened yet.
 *
 * ★★★ The accessible name is a sentence per column, not the drawing.
 *
 * The chart itself is a `<ul>`; each column is an `<li>` carrying its own
 * label. A screen reader gets "Даваа: 92%" five times, which is the whole
 * content — where an `aria-label` on the frame would have to compress five
 * facts into one string that nobody maintains.
 */
export function ColumnChart({
  columns,
  /**
   * Gridlines, as percentages. The default draws the floor, the middle and the
   * ceiling — the three a reader needs to place a bar without counting.
   */
  gridlines = [0, 50, 100],
  axisLabel = (percent) => `${percent}%`,
  /** How tall the plot area is. The labels and the axis sit outside it. */
  height = 140,
  emptyLabel = "бүртгэлгүй",
  /**
   * Turn the labels 45° and let them run under the axis.
   *
   * ★ For categories that are sentences rather than abbreviations.
   *
   * Five weekdays are two characters each and sit flat. Five survey answers —
   * "Маш сэтгэл ханамжтай", "Сайжруулах шаардлагатай" — are twenty, and in a
   * column about 60px wide they either truncate to one word or wrap to four
   * lines. The client's own sketch turns them, which is the conventional
   * answer and the one that keeps every label whole.
   *
   * `truncate` is deliberately not applied in this mode: a turned label has
   * the diagonal to run along, and clipping it would give back exactly what
   * turning it bought.
   */
  tilted = false,
  className,
}: {
  columns: {
    /** The short label under the column — "Да", "Мя". */
    label: string;
    /** 0–100, or `null` for a day with no register. */
    value: number | null;
    /** The full name for a screen reader — "Даваа". Defaults to `label`. */
    accessibleLabel?: string;
    /**
     * The column's own accent.
     *
     * ★ Omit for a single series; pass one when the columns are *categories*.
     *
     * Five weekdays are one series measured five times and share a colour —
     * painting them differently would imply a distinction that is not there.
     * Five development domains are five different things, and a reader has to
     * carry each one down to a legend or a row of bars below; giving each its
     * own accent is what lets them do that without counting positions.
     *
     * Colour is never the only carrier: every column is named under the axis.
     */
    tone?: Tone;
  }[];
  gridlines?: number[];
  /**
   * How a gridline's position becomes its printed value.
   *
   * ★ The chart works in percentages; what they *mean* is the caller's.
   *
   * A column's height is a share of the plot, so this component has always
   * taken 0–100 — and it printed "50%" beside the rule, which is right when the
   * value is a share and wrong when it is not. A 1–4 assessment scale drawn
   * against its own maximum is still a percentage internally, but a director
   * reading "50%" against a domain scored 2.0 has to do the conversion in their
   * head every time.
   *
   * Defaults to the percentage, so every existing caller is unchanged.
   */
  axisLabel?: (percent: number) => string;
  height?: number;
  /** What a screen reader hears for a column with no value. */
  emptyLabel?: string;
  tilted?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-2", className)}>
      {/*
        The scale, outside the plot. `justify-between` with `flex-col-reverse`
        puts 0% at the foot and the top gridline at the head, so the numbers
        line up with the rules they name without any of them being positioned
        absolutely.
      */}
      <div
        aria-hidden="true"
        className="flex shrink-0 flex-col-reverse justify-between text-caption tabular-nums text-faint"
        style={{ height }}
      >
        {gridlines.map((line) => (
          // `-my-2` lets each number overhang its slot by half its own line
          // box, so `justify-between` seats it *on* its rule rather than
          // stacking it inside the band above — which would read as a label
          // for the band rather than for the line.
          <span key={line} className="-my-2 leading-none">
            {axisLabel(line)}
          </span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height }}>
          {/*
            The rules. Absolutely positioned inside the plot only — the columns
            below sit in normal flow on top of them, so a bar never has to know
            a gridline exists.
          */}
          <div aria-hidden="true" className="absolute inset-0">
            {gridlines.map((line) => (
              <span
                key={line}
                className="absolute inset-x-0 border-t border-border-soft"
                style={{ bottom: `${clampPercent(line)}%` }}
              />
            ))}
          </div>

          <ul className="relative flex h-full items-end justify-around gap-2">
            {columns.map((column) => {
              const empty = column.value === null;
              const percent = empty ? 0 : clampPercent(column.value!);
              const name = column.accessibleLabel ?? column.label;

              return (
                <li
                  key={column.label}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end"
                  // The whole content of the column, as one phrase. `<li>`
                  // rather than the bar itself, so the label under it is not
                  // announced a second time.
                  aria-label={empty ? `${name}: ${emptyLabel}` : `${name}: ${percent}%`}
                >
                  {empty ? (
                    /*
                      A hairline outline the full height of the plot: visibly a
                      column that exists and has no value, rather than a bar of
                      nothing (invisible) or a bar at zero (a claim).
                    */
                    <span
                      aria-hidden="true"
                      className="mx-auto h-full w-full max-w-[36px] rounded-t-control border border-dashed border-border lg:max-w-[56px]"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      /*
                        `min-height` rather than letting a 1% day vanish: a bar
                        two pixels tall still says "somebody was counted", which
                        is a different fact from the dashed track beside it.

                        The cap widens at `lg`: 36px is right when five columns
                        share a 280px card, and a hairline when they share 1132.
                      */
                      className="mx-auto w-full max-w-[36px] rounded-t-control transition-[height] lg:max-w-[56px]"
                      style={{
                        height: `${percent}%`,
                        minHeight: percent > 0 ? 4 : 0,
                        background: column.tone ? TONE_VAR[column.tone] : "var(--color-primary)",
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/*
          The labels, in a row that mirrors the columns' own flex rules exactly
          — same `justify-around`, same `flex-1`, same gap — so each one stays
          under its bar at any width without a grid to tie them together.

          ★ Turned labels need the row to reserve their height, because a
          `rotate` is a transform: it paints outside the flow and contributes
          nothing to layout, so without `h-[84px]` the diagonals would run over
          whatever sits under the chart. `origin-top-left` pins each one to the
          left of its own column so the text hangs *from* the axis rather than
          drifting away from the bar it names.
        */}
        <ul
          aria-hidden="true"
          className={cn(
            "mt-2 flex items-start justify-around gap-2 border-t border-border pt-2",
            tilted && "h-[104px]",
          )}
        >
          {columns.map((column) =>
            tilted ? (
              /*
                ★ Anchored by its right end, so the label hangs *below* the
                axis instead of climbing into the plot.

                It was `left-1/2 origin-top-left -rotate-45`: the text starts at
                the tick and a counter-clockwise turn swings it up and to the
                right, straight through the columns it is labelling. Anchoring
                the right end at the tick and turning about that corner swings
                the other end down-left, which is the arrangement every chart
                library uses for turned labels — the label ends where its
                column begins and the space it occupies is the margin below the
                axis, which is what `h-[104px]` reserves.

                104px rather than 84: at 45° a label needs its own length ÷ √2
                of vertical room, and "Нийгэмшихүй, сэтгэл хөдлөл" is about
                145px — so 84 clipped the longest names of the five this was
                turned for in the first place.
              */
              <li key={column.label} className="relative min-w-0 flex-1">
                <span className="absolute right-1/2 top-0 origin-top-right -rotate-45 whitespace-nowrap text-caption text-muted">
                  {column.label}
                </span>
              </li>
            ) : (
              /*
                ★ Two lines, not one truncated one.

                Five weekdays are two characters and never wrap. A category
                name — "Нийгэмшихүй, сэтгэл хөдлөл" — is twenty, and `truncate`
                turned it into "Нийгэмшихүй, сэ…", which is the point at which a
                chart stops naming its own columns. `line-clamp-2` keeps the
                short case identical and gives the long one the room it needs.

                This is also what makes `tilted` a *narrow card* measure rather
                than a long-label one: at 226px per column a wrapped label costs
                34px of height where a turned one costs 104.
              */
              <li
                key={column.label}
                className="line-clamp-2 min-w-0 flex-1 text-center text-caption leading-tight text-muted"
              >
                {column.label}
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}
