"use client";

import { useState } from "react";
import type { GrowthChart, GrowthPoint, ReferenceBand } from "@kinder/contracts";
import { formatDate } from "@/lib/format";
import { cn, isPresent } from "@/lib/utils";

/**
 * Height and weight over time — RFP §7.2.
 *
 * ★ Hand-drawn SVG and a real `<table>`, for the reasons `DevelopmentRadar`
 * already argues: a chart a screen reader cannot navigate is half a feature,
 * and a charting library would cost ~100kb on a product built for a phone on a
 * slow connection to add tooltips and a legend this does not need.
 *
 * ★★ The reference band is drawn *behind* the child's line and labelled with
 * its source.
 *
 * RFP §7.2 requires the source, its version and its date to be shown, and
 * requires the system to say it gives no medical diagnosis. Both come from the
 * API inside the `reference` object, so this component cannot draw the band
 * without them — and when `reference` is null (an unknown sex) it draws the
 * child's line alone rather than a band that would be wrong for half of them.
 *
 * ★★★ The band is a ±2 SD range, never a percentile.
 *
 * "Your child is on the 12th percentile" is a sentence that sends a family to a
 * clinic. The question a kindergarten actually has is whether a measurement
 * sits inside the range most children of this age fall in, which is what a band
 * answers.
 */

const WIDTH = 520;
const HEIGHT = 200;
const PAD = { top: 12, right: 12, bottom: 12, left: 12 };

const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

type Metric = "height" | "weight";

interface Series {
  metric: Metric;
  label: string;
  unit: string;
  /** Points that actually carry this quantity — a gap is not a zero. */
  values: { id: string; ageYears: number; ageMonths: number; value: number; measuredOn: string }[];
  band: ReferenceBand[];
}

function seriesFor(chart: GrowthChart, metric: Metric): Series {
  const pick = (p: GrowthPoint) => (metric === "height" ? p.heightCm : p.weightKg);

  return {
    metric,
    label: metric === "height" ? "Өндөр" : "Жин",
    unit: metric === "height" ? "см" : "кг",
    values: chart.points.flatMap((p) => {
      const value = pick(p);
      // `flatMap` rather than filter-then-map: it narrows the type in the same
      // step, so the plotted value needs no non-null assertion to convince
      // TypeScript that the filter above already checked it.
      return isPresent(value)
        ? [
            {
              id: p.id,
              ageYears: p.ageYears,
              ageMonths: growthPointAgeMonths(p),
              value,
              measuredOn: p.measuredOn,
            },
          ]
        : [];
    }),
    band: (metric === "height" ? chart.reference?.height : chart.reference?.weight) ?? [],
  };
}

/**
 * The drawing area's bounds.
 *
 * ★ The band is included in the extent even where the child has no measurement.
 *
 * Scaling to the child's own values alone would crop the reference band at the
 * edges of the plot, and a band that stops mid-chart reads as "outside the
 * normal range" — the opposite of what it means.
 */
function bounds(series: Series) {
  const xs = [...series.values.map((v) => v.ageYears), ...series.band.map((b) => b.age)];
  const ys = [...series.values.map((v) => v.value), ...series.band.flatMap((b) => [b.low, b.high])];

  if (xs.length === 0 || ys.length === 0) return null;

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    // A single measurement would give a zero-width axis and divide by zero.
    maxX: maxX === minX ? minX + 1 : maxX,
    minY: minY === maxY ? minY - 1 : minY,
    maxY: maxY === minY ? maxY + 1 : maxY,
  };
}

export function GrowthChartFigure({
  chart,
  className,
  /**
   * `"grid"` puts the two figures side by side instead of stacked — the
   * comparison page's own reference screenshot draws them that way, next to
   * each other rather than one above the other. The default stays the
   * original stacked layout so `ChildGrowth`'s existing full-width usage is
   * unchanged.
   */
  layout = "stacked",
  showTable = true,
}: {
  chart: GrowthChart;
  className?: string;
  layout?: "stacked" | "grid";
  /** The editable child screen renders its own full history table. */
  showTable?: boolean;
}) {
  const height = seriesFor(chart, "height");
  const weight = seriesFor(chart, "weight");

  if (chart.points.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className={layout === "grid" ? "grid gap-4 sm:grid-cols-2" : "flex flex-col gap-6"}>
        <MetricChart series={height} />
        <MetricChart series={weight} />
      </div>

      {showTable ? <GrowthTable chart={chart} /> : null}

      {chart.reference ? (
        <p className="text-caption text-muted">
          Жишиг үзүүлэлт: {chart.reference.source.name} · {chart.reference.source.version} ·
          шинэчлэгдсэн {chart.reference.source.publishedOn}.{" "}
          <span className="text-ink">{chart.reference.source.disclaimer}</span>
        </p>
      ) : (
        // Said out loud rather than left as a missing band: an absent reference
        // line is a fact about this record, not a rendering failure.
        <p className="text-caption text-muted">
          Хүүхдийн хүйс тодорхойгүй тул жишиг үзүүлэлт харуулаагүй байна.
        </p>
      )}
    </div>
  );
}

function MetricChart({ series }: { series: Series }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const box = bounds(series);
  if (!box || series.values.length === 0) return null;

  const x = (age: number) => PAD.left + ((age - box.minX) / (box.maxX - box.minX)) * PLOT_W;
  const y = (value: number) =>
    PAD.top + PLOT_H - ((value - box.minY) / (box.maxY - box.minY)) * PLOT_H;

  const bandPath =
    series.band.length > 1
      ? [
          ...series.band.map((b, i) => `${i === 0 ? "M" : "L"}${x(b.age)},${y(b.high)}`),
          ...[...series.band].reverse().map((b) => `L${x(b.age)},${y(b.low)}`),
          "Z",
        ].join(" ")
      : null;

  const line = series.values
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(v.ageYears)},${y(v.value)}`)
    .join(" ");
  const active = series.values.find((value) => value.id === activeId) ?? null;
  const activeX = active ? x(active.ageYears) : 0;
  const activeY = active ? y(active.value) : 0;
  const tooltipAlign =
    activeX < WIDTH * 0.2
      ? "translate-x-0"
      : activeX > WIDTH * 0.8
        ? "-translate-x-full"
        : "-translate-x-1/2";

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 text-body font-medium text-ink">
        {series.label} ({series.unit})
      </figcaption>

      {/* Each measured point is a keyboard-focusable, touch-sized control. */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="group"
          aria-label={`${series.label}-ийн хугацааны график`}
          className="w-full"
          onMouseLeave={() => setActiveId(null)}
        >
          {/* Axis lines, so the plot has a floor and a left edge to read against. */}
          <line
            x1={PAD.left}
            y1={PAD.top}
            x2={PAD.left}
            y2={PAD.top + PLOT_H}
            className="stroke-border"
          />
          <line
            x1={PAD.left}
            y1={PAD.top + PLOT_H}
            x2={PAD.left + PLOT_W}
            y2={PAD.top + PLOT_H}
            className="stroke-border"
          />

          {/* The reference band, behind everything the child's own line draws. */}
          {bandPath ? <path d={bandPath} className="fill-mint/40 stroke-none" /> : null}
          {series.band.length > 1 ? (
            <path
              d={series.band
                .map((b, i) => `${i === 0 ? "M" : "L"}${x(b.age)},${y(b.median)}`)
                .join(" ")}
              className="fill-none stroke-muted"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          ) : null}

          <path d={line} className="fill-none stroke-primary" strokeWidth={2} />

          {series.values.map((v) => (
            <g
              key={v.id}
              role="button"
              tabIndex={0}
              aria-label={`${formatDate(v.measuredOn)}, ${formatGrowthAge(v.ageMonths)}, ${v.value} ${series.unit}`}
              className="cursor-pointer outline-none"
              onMouseEnter={() => setActiveId(v.id)}
              onFocus={() => setActiveId(v.id)}
              onBlur={() => setActiveId(null)}
              onClick={() => setActiveId(v.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setActiveId(v.id);
              }}
            >
              <circle cx={x(v.ageYears)} cy={y(v.value)} r={30} className="fill-transparent" />
              <circle
                cx={x(v.ageYears)}
                cy={y(v.value)}
                r={activeId === v.id ? 6 : 4}
                className="pointer-events-none fill-primary stroke-surface stroke-2"
              />
            </g>
          ))}
        </svg>

        {active ? (
          <div
            role="tooltip"
            className={cn(
              "pointer-events-none absolute z-10 mb-2 w-max max-w-48 -translate-y-full rounded-control bg-ink px-3 py-2 text-caption text-white shadow-md",
              tooltipAlign,
            )}
            style={{
              left: `${(activeX / WIDTH) * 100}%`,
              top: `${(Math.max(activeY, 72) / HEIGHT) * 100}%`,
            }}
          >
            <span className="block font-semibold">{formatDate(active.measuredOn)}</span>
            <span className="block text-white/80">{formatGrowthAge(active.ageMonths)}</span>
            <span className="block tabular-nums">
              {series.label}: {active.value} {series.unit}
            </span>
          </div>
        ) : null}
      </div>

      {/*
        ★ The scale is rendered as HTML beneath the figure, not as `<text>`
        inside it.

        `DevelopmentRadar` does the same, and the reason is the type scale: an
        SVG label needs a font size, the only sizes this product has are the
        `--text-*` tokens, and inventing a `text-[9px]` for a chart is exactly
        what `tokens.test.tsx` fails a build over. Rendering the bounds in a
        `text-caption` row keeps one scale for the whole product — and puts the
        numbers where a screen reader meets them in reading order rather than
        stranded in an `aria-hidden` figure.
      */}
      <div className="flex justify-between text-caption text-muted">
        <span>
          {formatAxisAge(box.minX)} · {box.minY.toFixed(0)}
          {series.unit}
        </span>
        <span>
          {formatAxisAge(box.maxX)} · {box.maxY.toFixed(0)}
          {series.unit}
        </span>
      </div>
    </figure>
  );
}

/**
 * The same measurements, navigable — and the place RFP §7.2's "өөрчлөлтийг тоон
 * хэлбэрээр харуулах" actually lives. The chart shows the shape; this shows the
 * numbers and the change since the previous measurement.
 */
function GrowthTable({ chart }: { chart: GrowthChart }) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center text-caption font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
        Тоон утгыг харах
      </summary>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-caption">
          <caption className="sr-only">Өсөлтийн хэмжилтүүд, өмнөх хэмжилттэй харьцуулсан</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Огноо
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Өндөр
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Жин
              </th>
              <th scope="col" className="py-1.5 font-medium">
                Өөрчлөлт
              </th>
            </tr>
          </thead>
          <tbody>
            {chart.points.map((p) => (
              <tr key={p.id} className="border-b border-border/60">
                <th scope="row" className="py-1.5 pr-3 font-normal text-ink">
                  {p.measuredOn}
                </th>
                <td className="py-1.5 pr-3 tabular-nums text-ink">
                  {isPresent(p.heightCm) ? `${p.heightCm} см` : "—"}
                </td>
                <td className="py-1.5 pr-3 tabular-nums text-ink">
                  {isPresent(p.weightKg) ? `${p.weightKg} кг` : "—"}
                </td>
                <td className="py-1.5 tabular-nums text-muted">
                  {/*
                    An em dash for the first measurement and for any quantity the
                    previous row did not carry — never "+0", which would claim a
                    comparison nobody made.
                  */}
                  {isPresent(p.heightChangeCm) ? `${signed(p.heightChangeCm)} см` : "—"}
                  {isPresent(p.weightChangeKg) ? ` · ${signed(p.weightChangeKg)} кг` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatAxisAge(ageYears: number): string {
  return formatGrowthAge(Math.round(ageYears * 12));
}

export function formatGrowthAge(ageMonths: number): string {
  const years = Math.floor(ageMonths / 12);
  const months = ageMonths % 12;
  return months === 0 ? `${years} нас` : `${years} нас ${months} сар`;
}

/** Keeps the screen usable while an older API process still sends whole years only. */
export function growthPointAgeMonths(point: Pick<GrowthPoint, "ageMonths" | "ageYears">): number {
  return point.ageMonths ?? Math.round(point.ageYears * 12);
}
