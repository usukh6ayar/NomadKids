import { cn } from "@/lib/utils";
import { TONE_VAR, type Tone } from "@/components/ui/tone";
import { STROKE } from "./chart-tokens";

/**
 * A trend, small enough to sit inside a statistic.
 *
 * ★ No axes, no grid, no labels — that is what makes it a sparkline rather
 * than a small line chart. A reader takes the shape, not the values; the
 * figure beside it carries the number.
 *
 * ★★ `vectorEffect="non-scaling-stroke"` is the load-bearing attribute.
 *
 * The viewBox is normalised to the data's own range, so the horizontal and
 * vertical scales differ by whatever the data happens to be. Without this the
 * stroke would be drawn in that distorted space and a line would appear thicker
 * where it is steep — the classic wrong-looking sparkline.
 *
 * ★★★ A single point draws nothing. One measurement is not a trend, and a flat
 * line through the middle of the box would assert a stability that has not
 * been observed.
 */
export function Sparkline({
  values,
  tone = "sky",
  label,
  width = 96,
  height = 28,
  className,
}: {
  /** In order, oldest first. Fewer than two renders an empty box. */
  values: number[];
  tone?: Tone;
  /** The accessible sentence. Required. */
  label: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const usable = values.filter((v) => Number.isFinite(v));

  if (usable.length < 2) {
    return (
      <div
        role="img"
        aria-label={label}
        className={cn("shrink-0", className)}
        style={{ width, height }}
      />
    );
  }

  const min = Math.min(...usable);
  const max = Math.max(...usable);
  // A flat series has no range to divide by; centre it rather than divide by 0.
  const span = max - min || 1;

  const points = usable
    .map((value, index) => {
      const x = (index / (usable.length - 1)) * 100;
      // SVG's y grows downward; a larger value has to sit higher.
      const y = 100 - ((value - min) / span) * 100;
      return `${x},${max === min ? 50 : y}`;
    })
    .join(" ");

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn("shrink-0 overflow-visible", className)}
      style={{ width, height }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={TONE_VAR[tone]}
        strokeWidth={STROKE.data}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
