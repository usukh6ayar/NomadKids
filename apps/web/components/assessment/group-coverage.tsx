"use client";

import { useQuery } from "@tanstack/react-query";
import { groupObservationStatsSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Card, SectionHeader } from "@/components/ui/card";
import { BarRow } from "@/components/ui/chart/bar-row";
import { ColumnChart } from "@/components/ui/chart/columns";
import { ErrorState, LoadingState } from "@/components/ui/states";

/** `2026-09` → `9-р сар`, the form the rest of the product writes months in. */
function monthLabel(iso: string): string {
  const month = Number(iso.slice(5, 7));
  return Number.isFinite(month) ? `${month}-р сар` : iso;
}

/**
 * The school year around a date — September to the following May.
 *
 * ★ Derived rather than fetched, deliberately.
 *
 * A `SchoolYear` row exists and carries a name, but not the month boundaries
 * this chart needs, and `Term` dates are a kindergarten's own and may not cover
 * the holidays. September–May is the RFP's own year and is what the client's
 * drawing labels its axis with (9, 10, 11, 12, 1 … 5). Getting it from the
 * clock keeps this component free of a second endpoint whose only job would be
 * to say which year it is.
 */
function schoolYearWindow(today: Date): { from: string; to: string } {
  const year = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
  return { from: `${year}-09-01`, to: `${year + 1}-05-31` };
}

/**
 * How a group's note-keeping is going — the client's 2026-08-31 dashboard.
 *
 * ★ It answers "am I writing about every child", not "how many notes exist".
 *
 * The headline is coverage: how many of the group's children have been written
 * about at all this year. A teacher with ninety notes about four children and
 * nothing about the other five is the case this screen exists to make visible,
 * and a total alone hides it completely — which is why `childrenWithNotes` is
 * the number in front and `total` is a supporting figure.
 *
 * ★★ Every chart is a list that happens to be drawn.
 *
 * `BarRow` rows and `ColumnChart` columns both carry their own text, so the
 * whole dashboard is readable at 320px without a horizontal scroller and with
 * a screen reader that draws nothing at all. The client asked specifically that
 * nothing overflow the viewport on a phone; the way to keep that promise is not
 * to have a fixed-width canvas in the first place.
 */
export function GroupCoverage({ groupId }: { groupId: string }) {
  const window_ = schoolYearWindow(new Date());

  const stats = useQuery({
    queryKey: qk.groupObservationStats(groupId, window_.from, window_.to),
    queryFn: () =>
      get(
        `/groups/${groupId}/observation-stats?from=${window_.from}&to=${window_.to}`,
        groupObservationStatsSchema,
      ),
  });

  if (stats.isPending) return <LoadingState rows={4} />;
  if (stats.isError) return <ErrorState description={errorMessage(stats.error)} />;

  const data = stats.data;
  const coverage =
    data.enrolled === 0 ? 0 : Math.round((data.childrenWithNotes / data.enrolled) * 100);

  return (
    <section aria-labelledby="coverage-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="coverage-heading"
        title="Тэмдэглэлийн хамралт"
        lede="Энэ хичээлийн жилд бүлгийн хэдэн хүүхдэд тэмдэглэл хөтөлсөн."
      />

      {/*
        The headline. `sm:grid-cols-3` rather than a row that wraps: three
        numbers of two digits each fit side by side from 640px, and below that
        two columns keep them legible instead of squeezing to three.
      */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Хамрагдсан хүүхэд"
          value={`${data.childrenWithNotes}/${data.enrolled}`}
          hint={`${coverage}%`}
        />
        <Stat label="Нийт тэмдэглэл" value={data.total} />
        <Stat
          label="Тэмдэглэлгүй"
          value={Math.max(0, data.enrolled - data.childrenWithNotes)}
          hint="хүүхэд"
        />
      </dl>

      {/*
        ★ One column below `lg`, two above — the client asked that desktop
        sections stack rather than shrink on a phone.

        Three panels side by side at 390px would give each about 110px, which is
        narrower than the labels inside them. Stacking is not a fallback here;
        it is the only arrangement in which the bars are readable.
      */}
      <div className="grid gap-4 lg:grid-cols-2">
        <BucketPanel
          title="Ажиглалтын төрлийн бүрдэл"
          empty="Тэмдэглэл бүртгэгдээгүй байна."
          rows={data.byType}
        />
        <BucketPanel
          title="Сургалтын чиглэлийн хамралт"
          empty="Хөгжлийн чиглэл тэмдэглэгдээгүй байна."
          rows={data.byDomain}
        />
      </div>

      {data.byActivity.length > 0 ? (
        <BucketPanel
          title="Үйл ажиллагааны явц"
          empty="Үйл ажиллагаа тэмдэглэгдээгүй байна."
          rows={data.byActivity.map((row) => ({ id: row.name, name: row.name, count: row.count }))}
        />
      ) : null}

      <Card pad="roomy" className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-ink">Сарын тэмдэглэлийн хамралт</h3>
        {data.byMonth.length === 0 ? (
          <p className="text-body text-muted">Энэ хичээлийн жилд тэмдэглэл алга байна.</p>
        ) : (
          <ColumnChart
            /*
              Scaled against the busiest month rather than against the child
              count: this chart is about rhythm — which months went quiet — and
              a fixed ceiling would flatten every bar in a group that writes
              little, which is exactly the group whose pattern matters most.
            */
            columns={data.byMonth.map((row) => {
              const peak = Math.max(...data.byMonth.map((entry) => entry.count), 1);
              return {
                label: monthLabel(row.month),
                value: Math.round((row.count / peak) * 100),
                accessibleLabel: `${monthLabel(row.month)}: ${row.count} тэмдэглэл`,
              };
            })}
            axisLabel={() => ""}
            height={120}
          />
        )}
      </Card>
    </section>
  );
}

/** One headline figure. A `<dl>` cell, so the label and number read as a pair. */
function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface px-3 py-2.5">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-lead font-semibold tabular-nums text-ink">{value}</dd>
      {hint ? <p className="text-caption text-faint">{hint}</p> : null}
    </div>
  );
}

/**
 * A titled list of counts drawn as bars.
 *
 * ★ Scaled to the biggest row, not to the total.
 *
 * A share-of-total scale makes every bar tiny as soon as there are eight
 * categories — the exact case here, where seven learning areas split a hundred
 * notes. Against the leader, the shape of "which areas are covered and which
 * are not" is legible at any count, which is the question the panel is asked.
 */
function BucketPanel({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { id: string; name: string; count: number }[];
  empty: string;
}) {
  const peak = Math.max(...rows.map((row) => row.count), 0);

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <h3 className="text-body font-semibold text-ink">{title}</h3>

      {rows.length === 0 || peak === 0 ? (
        <p className="text-body text-muted">{empty}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <BarRow
              key={row.id}
              label={row.name}
              percent={(row.count / peak) * 100}
              value={row.count}
              accessibleLabel={`${row.name}: ${row.count}`}
              // Full width for the label: these are Mongolian compounds
              // ("Нийгэм-сэтгэл хөдлөл"), not two-letter weekday stubs.
              labelWidth="w-[132px] md:w-[168px]"
            />
          ))}
        </div>
      )}
    </Card>
  );
}
