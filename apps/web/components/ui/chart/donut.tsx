import { cn } from "@/lib/utils";
import { TONE_VAR, type Tone } from "@/components/ui/tone";
import { RING_THICKNESS, seriesColor } from "./chart-tokens";

export interface DonutSegment {
  label: string;
  value: number;
  /** Omit to take the next colour from `SERIES_TONES`. */
  tone?: Tone;
}

/**
 * Several parts of a whole, as one ring.
 *
 * ★ SVG, unlike `Ring` — and the difference is the number of segments.
 *
 * A `conic-gradient` can express many stops, but each one needs its start and
 * end as a percentage baked into a template string, and the arithmetic to build
 * that string is the same arithmetic as the arcs below with none of the
 * accessibility. Two or more segments is where SVG earns its viewBox.
 *
 * ★★ Drawn as one `<circle>` per segment with a `strokeDasharray` and an
 * offset, not as `<path>` arcs. Dasharray arithmetic is a circumference and a
 * running total; arc paths need sweep flags and the large-arc rule, which is
 * where hand-drawn donuts get their off-by-one at exactly 50%.
 *
 * ★★★ The whole chart is one `role="img"` with a sentence naming every
 * segment. Six separate `<title>`s would be six things to tab through for a
 * picture a sighted reader takes in at once.
 */
export function Donut({
  segments,
  size = 96,
  label,
  centre,
  className,
}: {
  segments: DonutSegment[];
  /** Pixels. The stroke scales with it. */
  size?: number;
  /** The accessible sentence. Required — a chart with no name is decoration. */
  label: string;
  /** What sits in the hole, if anything. */
  centre?: React.ReactNode;
  className?: string;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);

  // A radius of 1 makes the circumference 2π and every dash a plain fraction,
  // so the viewBox does the scaling instead of a pixel calculation per size.
  const RADIUS = 1;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const stroke = RADIUS * 2 * RING_THICKNESS;
  // The viewBox has to hold the stroke, which straddles the radius.
  const extent = RADIUS + stroke / 2;

  let consumed = 0;

  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`} className="size-full">
        {/* The track, so a chart with no data is still a ring rather than nothing. */}
        <circle r={RADIUS} fill="none" stroke="var(--color-track)" strokeWidth={stroke} />

        {total > 0 &&
          segments.map((segment, index) => {
            const share = Math.max(0, segment.value) / total;
            const dash = share * CIRCUMFERENCE;
            // -90° so the first segment starts at twelve o'clock, which is
            // where a reader expects a total to begin.
            const offset = -consumed * CIRCUMFERENCE;
            consumed += share;

            if (share === 0) return null;

            return (
              <circle
                key={`${segment.label}-${index}`}
                r={RADIUS}
                fill="none"
                stroke={segment.tone ? TONE_VAR[segment.tone] : seriesColor(index)}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={offset}
                transform="rotate(-90)"
              />
            );
          })}
      </svg>

      {centre ? <div className="absolute grid place-items-center">{centre}</div> : null}
    </div>
  );
}
