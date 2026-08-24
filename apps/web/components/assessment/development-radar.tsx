import type { AssessmentRadar } from "@kinder/contracts";
import { cn } from "@/lib/utils";

/**
 * One child's standing across the five development domains — RFP §12.1.
 *
 * ★ Hand-drawn SVG rather than a charting library, and the reasons are the
 * ones this codebase already argues elsewhere.
 *
 * `term-progress.tsx` holds out against a chart on the grounds that a bar can
 * be "announced properly to a screen reader, which a canvas chart is not", and
 * `ui/menu.tsx` declines a Radix package for a three-item menu. Both apply. A
 * radar of five fixed axes and two series is a pair of polygons and a ring of
 * labels; what a library would add is tooltips, responsive containers and a
 * legend, and what it would cost is roughly 100kb on a product built for a
 * phone on a slow connection — plus its own DOM, which is the part that is hard
 * to make readable without sight.
 *
 * ★★ The figure is `aria-hidden` and the numbers live in a real `<table>`.
 *
 * Not a caption, not an `aria-label` summarising the shape — the same data, in
 * a structure a screen reader can navigate cell by cell. A sighted reader gets
 * the shape and a blind reader gets the values, and neither is a degraded
 * version of the other. The table is visually hidden by default and can be
 * revealed, because "show me the numbers" is a request sighted people make of
 * charts too.
 *
 * ★★★ Scores are levels, not percentages.
 *
 * `AssessmentLevel` is an ordinal 1–4 scale a kindergarten may rename, so the
 * value only positions the point and every label the reader sees is the level's
 * own word — "Хүрсэн", not "75%".
 */

/** The scale's maximum. `SYSTEM_LEVELS` defines values 1–4. */
const MAX_LEVEL = 4;

const SIZE = 260;
const CENTRE = SIZE / 2;
const RADIUS = 92;

/**
 * Where an axis ends, in SVG coordinates.
 *
 * Starts at twelve o'clock (`-90°`) and runs clockwise, so the first domain in
 * the kindergarten's configured order is at the top rather than at three
 * o'clock where the maths would otherwise put it.
 */
function point(index: number, count: number, distance: number) {
  const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
  return {
    x: CENTRE + Math.cos(angle) * distance,
    y: CENTRE + Math.sin(angle) * distance,
  };
}

function polygon(values: (number | null)[], count: number): string {
  return values
    .map((value, index) => {
      // A missing score sits at the origin — a visible dent rather than a
      // side the polygon quietly skips, which would change its shape.
      const distance = ((value ?? 0) / MAX_LEVEL) * RADIUS;
      const { x, y } = point(index, count, distance);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function DevelopmentRadar({
  radar,
  className,
}: {
  radar: AssessmentRadar;
  className?: string;
}) {
  const { axes, cohort } = radar;
  const count = axes.length;
  if (count < 3) return null;

  const own = axes.map((a) => a.score);
  const average = cohort ? axes.map((a) => cohort.averageByDomain[a.domain.id] ?? null) : null;

  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6", className)}>
      {/*
        `aria-hidden`: everything this draws is in the table below, and a
        screen reader walking a polygon's coordinates learns nothing.
      */}
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
        focusable="false"
        className="mx-auto w-full max-w-[260px] shrink-0"
      >
        {/* The rings, one per level, so the grid itself is the scale. */}
        {Array.from({ length: MAX_LEVEL }, (_, ring) => (
          <polygon
            key={ring}
            points={polygon(Array(count).fill(ring + 1), count)}
            className="fill-none stroke-border"
            strokeWidth={1}
          />
        ))}

        {axes.map((axis, index) => {
          const { x, y } = point(index, count, RADIUS);
          return (
            <line
              key={axis.domain.id}
              x1={CENTRE}
              y1={CENTRE}
              x2={x}
              y2={y}
              className="stroke-border"
              strokeWidth={1}
            />
          );
        })}

        {/*
          The cohort first, so the child's own figure is never hidden behind it.
          Dashed as well as tinted: on a greyscale print or to a colour-blind
          reader the two series still separate.
        */}
        {average ? (
          <polygon
            points={polygon(average, count)}
            className="fill-muted/10 stroke-muted"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        ) : null}

        <polygon
          points={polygon(own, count)}
          className="fill-primary/15 stroke-primary"
          strokeWidth={2}
        />

        {axes.map((axis, index) =>
          axis.score === null ? null : (
            <circle
              key={axis.domain.id}
              {...point(index, count, (axis.score / MAX_LEVEL) * RADIUS)}
              r={3}
              className="fill-primary"
            />
          ),
        )}
      </svg>

      <div className="min-w-0 flex-1">
        <Legend hasCohort={Boolean(cohort)} sampleSize={cohort?.sampleSize} />
        <ScoreTable radar={radar} />
      </div>
    </div>
  );
}

/**
 * What the two outlines are.
 *
 * The cohort's size is stated rather than implied: "18 хүүхдийн дундаж" is a
 * fact a reader can weigh, and an unlabelled second line invites them to read a
 * group of five as if it were the whole kindergarten.
 */
function Legend({ hasCohort, sampleSize }: { hasCohort: boolean; sampleSize?: number }) {
  return (
    <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption">
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="h-0.5 w-5 rounded-pill bg-primary" />
        <span className="text-ink">Энэ хүүхэд</span>
      </li>
      {hasCohort ? (
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="h-0 w-5 border-t-2 border-dashed border-muted" />
          <span className="text-muted">Бүлгийн дундаж · {sampleSize} хүүхэд</span>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The same data, navigable.
 *
 * ★ `<details>` rather than a permanently hidden table.
 *
 * `sr-only` alone would mean sighted readers cannot check a number they think
 * they are misreading off the shape, which is the commonest thing anyone wants
 * from a chart. Open it and the numbers are there for everyone; closed, the
 * table is still in the accessibility tree and still reachable.
 */
function ScoreTable({ radar }: { radar: AssessmentRadar }) {
  const { axes, cohort } = radar;

  return (
    <details className="group">
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center text-caption font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
        Тоон утгыг харах
      </summary>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-caption">
          <caption className="sr-only">
            {radar.term.name} — хөгжлийн чиглэл тус бүрийн үнэлгээ
            {cohort ? ` болон ${cohort.group.name} бүлгийн дундаж` : ""}
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Чиглэл
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Үнэлгээ
              </th>
              {cohort ? (
                <th scope="col" className="py-1.5 font-medium">
                  Бүлгийн дундаж
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {axes.map((axis) => (
              <tr key={axis.domain.id} className="border-b border-border-soft">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink">
                  {axis.domain.name}
                </th>
                {/*
                  The level's own word, not the number. "Хүрсэн" is what a
                  kindergarten calls a 3, and the numeral only exists to place
                  the point on the axis.
                */}
                <td className="py-1.5 pr-3 text-ink">{axis.level?.label ?? "Үнэлээгүй"}</td>
                {cohort ? (
                  <td className="py-1.5 tabular-nums text-muted">
                    {cohort.averageByDomain[axis.domain.id]?.toFixed(1) ?? "—"}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
