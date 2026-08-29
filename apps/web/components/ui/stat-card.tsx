import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TONE_SURFACE, type Tone } from "@/components/ui/tone";

/**
 * A statistic that is itself the content — RFP §12.1 and §12.2.
 *
 * ★ The figure is the largest thing on the card, and the label sits under it.
 *
 * "245" answers the question; "нийт хүүхэд" says which question. Putting the
 * caption first, at the same weight, makes a reader parse a sentence to find a
 * number they could have read at a glance from across a desk.
 *
 * ★★ `art` is a slot the layout reserves whether or not it is filled.
 *
 * An illustration is passed in — a lucide glyph now, a drawing when the artwork
 * arrives — and it is `aria-hidden` in every case: it repeats the label, and a
 * screen reader announcing "picture of two children, total children, 245" is
 * worse than the number alone. Cards with and without art still align in a row,
 * because the figure column is what sets the height.
 */
export function StatCard({
  label,
  value,
  unit,
  art,
  tone = "sky",
  size = "normal",
  trend,
  footer,
  className,
}: {
  label: string;
  /** Pre-formatted: this component never decides how a number is written. */
  value: ReactNode;
  /** "хүүхэд", "%" — the words under the figure. */
  unit?: string;
  art?: ReactNode;
  tone?: Tone;
  /** `wide` spans two columns and gives the art real room. */
  size?: "normal" | "wide";
  /**
   * A comparison against an earlier period — the drawing's "↑ 0 Өмнөх сараас".
   *
   * A slot rather than a number, because only the caller knows what the figure
   * is being compared against and whether the comparison is honest for that
   * statistic. `StatTrend` below renders the usual shape.
   */
  trend?: ReactNode;
  /** A progress bar or a sparkline, below the figure. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      pad="roomy"
      className={cn(
        "flex items-start gap-3 overflow-hidden",
        size === "wide" && "sm:col-span-2",
        className,
      )}
    >
      {/*
        ★ The art leads the card, rather than closing it.

        It sat on the right until the client's 2026-08-29 drawing, opposite the
        figure — which reads as decoration parked in the leftover space, and on
        a two-column phone grid it squeezed the number it was meant to
        illustrate. Leading, it is the thing the eye lands on first and the row
        of cards becomes scannable by shape before any of it is read.

        `size-11` and a tinted square, not a circle: `IconChip`'s `md` step and
        `--radius-card`, so this and every other chip in the product are the
        same object.
      */}
      {art ? (
        <span
          aria-hidden="true"
          className={cn(
            "grid shrink-0 place-items-center rounded-card [&>img]:size-full [&>img]:object-contain",
            size === "wide" ? "size-14" : "size-11",
            TONE_SURFACE[tone],
          )}
        >
          {art}
        </span>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-body text-muted">{label}</p>

        {/*
          `tabular-nums` so a figure that ticks upward does not shift the
          layout under it — the same reason every other count in this product
          uses it.
        */}
        <p
          className={cn(
            "font-semibold tabular-nums leading-heading text-ink",
            size === "wide" ? "text-figure" : "text-display",
          )}
        >
          {value}
        </p>

        {unit ? <p className="text-caption text-muted">{unit}</p> : null}

        {/*
          ★ The trend sits under a rule, so it reads as a second statement
          rather than a third line of the first.

          "0" beside "10" with nothing between them is two numbers a reader has
          to disambiguate; a hairline says the one below is *about* the one
          above. Absent entirely when the caller has nothing honest to put
          there — an empty trend row implies a comparison that was made and
          came out flat.
        */}
        {trend ? (
          <div className="mt-2.5 border-t border-border-soft pt-2 text-caption">{trend}</div>
        ) : null}

        {footer ? <div className="mt-1.5">{footer}</div> : null}
      </div>
    </Card>
  );
}

/**
 * "↑ 2 өмнөх сараас" — a figure's change against an earlier one.
 *
 * ★ The arrow is not the only signal, and the word beside it is not decoration.
 *
 * Colour and a glyph both say "up"; the phrase beside them says *up from
 * what*, which is the part a reader cannot infer. `globals.css` records "no
 * critical meaning through colour alone" as an RFP §13 requirement, and a
 * green triangle on its own is exactly that.
 *
 * ★★ No change renders an em dash rather than an arrow beside a zero.
 *
 * An arrow pointing up next to "0" is a small contradiction the eye has to
 * resolve every time it lands there. A dash says "unchanged" in one glyph and
 * takes the colour off the card, which is right — nothing happened.
 *
 * ★★★ `mint` and `peach`, not green and red.
 *
 * Fewer children this month is not an error, and painting it in the danger
 * colour would tell a director something the number does not. `peach` is
 * `tone.ts`'s "attention", which is what a fall in enrolment deserves.
 */
export function StatTrend({
  current,
  previous,
  /** What the comparison is against — "өмнөх сараас". */
  since,
}: {
  current: number;
  previous: number;
  since: string;
}) {
  const delta = current - previous;

  if (delta === 0) {
    return (
      <p className="text-muted">
        <span aria-hidden="true">—</span> Өөрчлөлтгүй, {since}
      </p>
    );
  }

  const up = delta > 0;

  return (
    <p className={up ? "text-mint-ink" : "text-peach-ink"}>
      <span aria-hidden="true">{up ? "↑" : "↓"}</span>{" "}
      <span className="font-medium tabular-nums">
        {up ? "+" : "−"}
        {Math.abs(delta)}
      </span>{" "}
      <span className="text-muted">{since}</span>
    </p>
  );
}

/**
 * A thin bar under a figure — RFP §12.1's progress, and the mockup's 87%.
 *
 * Its own component because a bar with no accessible name is a decoration a
 * screen reader skips, and the percentage is the point.
 */
export function StatBar({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-pill bg-track"
    >
      <span className="block h-full rounded-pill bg-primary" style={{ width: `${clamped}%` }} />
    </div>
  );
}
