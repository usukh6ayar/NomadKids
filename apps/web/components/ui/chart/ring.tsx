import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { clampPercent } from "./chart-tokens";

/**
 * A single percentage, as a ring.
 *
 * ★ A `conic-gradient`, not an SVG arc — and this is the older, better idea in
 * this codebase rather than a compromise.
 *
 * `attendance-today.tsx` worked this out first: an arc drawn as an SVG
 * `<circle>` with a `strokeDasharray` needs a viewBox, a stroke weight and a
 * rotation, all of which become per-file decisions, and its label needs a
 * `font-size` — the arbitrary value `tokens.test.tsx` exists to catch. A conic
 * gradient says the same thing in one declaration, the label is an ordinary DOM
 * node that inherits the type scale, and both colours are read live from the
 * palette so a repaint moves them.
 *
 * ★★ The hole is an inner circle in `--color-surface`, not a `mask`. More
 * portable, and it costs one element.
 *
 * ★★★ `aria-hidden` unless a `label` is given.
 *
 * On every screen that has one of these today the figure is also on the card as
 * text. A ring that re-announces it is noise. Pass `label` only where the ring
 * is the sole carrier — then it becomes an `img` with a name.
 */
export function Ring({
  percent,
  size = "md",
  muted = false,
  label,
  children,
  className,
}: {
  percent: number;
  size?: keyof typeof SIZE;
  /** Nothing to show yet — draws a flat track and no fill. */
  muted?: boolean;
  /** An accessible name. Omit when the figure is already on screen as text. */
  label?: string;
  /** What sits in the hole. Defaults to the percentage. */
  children?: ReactNode;
  className?: string;
}) {
  const value = clampPercent(percent);

  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" })}
      className={cn(
        "relative grid shrink-0 place-items-center rounded-pill",
        SIZE[size].outer,
        className,
      )}
      style={{
        background: muted
          ? "var(--color-track)"
          : `conic-gradient(var(--color-primary) 0 ${value}%, var(--color-track) ${value}% 100%)`,
      }}
    >
      <span className={cn("grid place-items-center rounded-pill bg-surface", SIZE[size].inner)}>
        {children ?? (
          <span
            className={cn(
              "font-semibold tabular-nums",
              SIZE[size].text,
              muted ? "text-faint" : "text-ink",
            )}
          >
            {muted ? "—" : `${value}%`}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * The hole is ~70% of the outer, which is `RING_THICKNESS` expressed in the
 * two Tailwind sizes a conic ring actually needs. Kept as literal pairs rather
 * than computed, because a `calc()` in a class name is not a class name.
 */
const SIZE = {
  sm: { outer: "size-12", inner: "size-9", text: "text-caption" },
  md: { outer: "size-16", inner: "size-12", text: "text-body" },
  lg: { outer: "size-24", inner: "size-[4.5rem]", text: "text-title" },
} as const;
