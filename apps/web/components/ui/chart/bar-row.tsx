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
  inline = false,
  labelWidth = "w-[104px] md:w-[132px]",
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
  /** Label, bar and figure on one line — see the note in the body. */
  inline?: boolean;
  /**
   * The `inline` label column, as classes.
   *
   * Fixed from `sm` up so bars in one panel start at the same x — bars that
   * begin in different places cannot be compared by length, which is the only
   * thing a bar is for. The default fits a group name; a panel whose labels are
   * longer (the five development domains) passes a wider one rather than
   * truncating every row. Below `sm` it does not apply: the label has its own
   * line there.
   */
  labelWidth?: string;
  className?: string;
}) {
  const width = clampPercent(percent);

  /*
   * ★ `inline` puts the label, the bar and the figure on one line.
   *
   * The stacked default is right where the label can be long and the bars are
   * few — a survey question above its own bar. It is wrong for a table of
   * groups: the client's 2026-08-29 drawing runs `Бага бүлэг ▬▬▬▬ 96%` across
   * one row precisely so the eye can travel *down* the percentages, and a
   * stacked version puts a line of text between every pair of bars it is meant
   * to compare.
   *
   * The label column is fixed rather than shrink-to-fit for the same reason the
   * assessment coverage rows are: bars that start at different x positions
   * cannot be compared by length, which is the only thing a bar is for.
   */
  /*
   * ★ `inline` is a desktop arrangement that folds back to the stacked one on
   * a phone, rather than a second component.
   *
   * One line — `Бага бүлэг ▬▬▬▬ 96%` — is what lets the eye run *down* a
   * column of percentages, and the client's 2026-08-29 drawing uses it for
   * exactly that. It needs a fixed label column, and a fixed column on a 390px
   * screen either truncates the label ("Нийгэмшихүй, сэтгэл х…") or leaves the
   * bar too short to read as a length. So below `sm` the label and figure take
   * a line and the bar takes the next, which is the stacked default — the same
   * responsive-table trade `data-list.tsx` makes, and the reason this is one
   * component with a flag instead of two that drift.
   */
  if (inline) {
    return (
      <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
        <span className={cn("min-w-0 flex-1 truncate text-body text-ink sm:flex-none", labelWidth)}>
          {label}
        </span>

        <span
          role="img"
          aria-label={accessibleLabel ?? label}
          className="order-last h-2 w-full basis-full overflow-hidden rounded-pill bg-track sm:order-none sm:w-auto sm:min-w-0 sm:flex-1 sm:basis-auto"
        >
          <span
            className="block h-full rounded-pill"
            style={{ width: `${width}%`, background: TONE_VAR[tone] }}
          />
        </span>

        {value ? (
          <span className="shrink-0 text-caption tabular-nums text-muted sm:w-[44px] sm:text-right">
            {value}
          </span>
        ) : null}
      </div>
    );
  }

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
