import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_VAR, type Tone } from "@/components/ui/tone";
import { clampPercent } from "./chart-tokens";

/**
 * One labelled horizontal bar — a share of a whole.
 *
 * ★ A `<div>` with a width, not an SVG `<rect>`.
 *
 * `observation-mix.tsx` reached the same conclusion independently: a bar is a
 * box, and a box is what CSS is for. Drawing it in SVG buys nothing and costs a
 * viewBox, a scale and a text element that needs its own font size. This is the
 * shared version of the markup that file already ships.
 *
 * ★★ `role="img"` with a full sentence, not a bare `progressbar`.
 *
 * `progressbar` announces a number out of a hundred, which is right for a task
 * that is loading and wrong for "Хэл яриа: 12 ажиглалт". The label is written
 * by the caller because only the caller knows the unit — this component has a
 * percentage and no idea what it is a percentage *of*.
 */
export function BarRow({
  label,
  percent,
  value,
  tone = "sky",
  accessibleLabel,
  className,
}: {
  /** Shown to the left of the bar. */
  label: string;
  percent: number;
  /**
   * The figure at the right — "12", "68%", or a node when a caller wants to
   * style parts of it differently (a count leading a parenthesised share).
   */
  value?: ReactNode;
  tone?: Tone;
  /**
   * What a screen reader says. Defaults to `label`, but a caller that knows the
   * unit should pass the whole sentence.
   */
  accessibleLabel?: string;
  className?: string;
}) {
  const width = clampPercent(percent);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-body text-ink">{label}</span>
        {value ? (
          <span className="shrink-0 text-caption tabular-nums text-muted">{value}</span>
        ) : null}
      </div>

      <div
        role="img"
        aria-label={accessibleLabel ?? label}
        className="h-1.5 w-full overflow-hidden rounded-pill bg-track"
      >
        <div
          className="h-full rounded-pill transition-[width]"
          style={{ width: `${width}%`, background: TONE_VAR[tone] }}
        />
      </div>
    </div>
  );
}
