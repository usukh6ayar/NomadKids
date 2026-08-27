import { TONE_VAR, type Tone } from "@/components/ui/tone";

/**
 * The shape language every chart in this product shares.
 *
 * ★ These are the numbers that were previously a decision per file.
 *
 * `growth-chart.tsx` and `development-radar.tsx` each picked their own
 * viewBox, stroke weight and dot radius, and nothing made them agree — which
 * is the same failure `tokens.test.tsx` catches for type and radii, one layer
 * up. A chart that is 1.5px here and 2px there reads as two products.
 */

/** Stroke weights. A chart line is heavier than its grid, always. */
export const STROKE = {
  /** Axis lines, grid, the unfilled part of a track. */
  grid: 1,
  /** A data line or an arc. */
  data: 2,
} as const;

/** Ring and donut thickness, as a fraction of the radius. */
export const RING_THICKNESS = 0.28;

/**
 * The order accents are handed out when a chart needs several categories.
 *
 * ★ Fixed, so the same category keeps the same colour between renders — and
 * `sky` first, because a single-series chart should read as information rather
 * than as a judgement. A chart that assigns colours by iteration order repaints
 * itself when the data reorders, which is how a reader learns to distrust it.
 */
export const SERIES_TONES: Tone[] = ["sky", "mint", "sun", "peach", "cornflower", "teal"];

/** The CSS colour for a series index, wrapping if there are more than six. */
export function seriesColor(index: number): string {
  return TONE_VAR[SERIES_TONES[index % SERIES_TONES.length]!];
}

/** Clamps a percentage to 0–100 and rounds it. Every chart here takes percents. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
