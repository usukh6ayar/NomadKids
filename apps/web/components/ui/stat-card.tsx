import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
  footer,
  className,
}: {
  label: string;
  /** Pre-formatted: this component never decides how a number is written. */
  value: ReactNode;
  /** "хүүхэд", "%" — the words under the figure. */
  unit?: string;
  art?: ReactNode;
  tone?: "sky" | "mint" | "sun" | "peach" | "cornflower" | "teal";
  /** `wide` spans two columns and gives the art real room. */
  size?: "normal" | "wide";
  /** A progress bar or a sparkline, below the figure. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      pad="roomy"
      className={cn(
        "flex items-start justify-between gap-3 overflow-hidden",
        size === "wide" && "sm:col-span-2",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
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
        {footer ? <div className="mt-1.5">{footer}</div> : null}
      </div>

      {art ? (
        <span
          aria-hidden="true"
          className={cn(
            "grid shrink-0 place-items-center rounded-card [&>img]:size-full [&>img]:object-contain",
            size === "wide" ? "size-20" : "size-14",
            ART_TONE[tone],
          )}
        >
          {art}
        </span>
      ) : null}
    </Card>
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

const ART_TONE = {
  sky: "bg-sky text-sky-ink",
  mint: "bg-mint text-mint-ink",
  sun: "bg-sun text-sun-ink",
  peach: "bg-peach text-peach-ink",
  cornflower: "bg-cornflower text-cornflower-ink",
  teal: "bg-teal text-teal-ink",
} as const;
