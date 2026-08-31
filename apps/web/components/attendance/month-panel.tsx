"use client";

import { useQuery } from "@tanstack/react-query";
import { groupAttendanceSummarySchema, ATTENDANCE_STATUS_LABEL } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { BarRow } from "@/components/ui/chart/bar-row";
import { ColumnChart } from "@/components/ui/chart/columns";
import { Skeleton } from "@/components/ui/states";
import { ATTENDANCE_STATUS_CHART_TONE, ATTENDANCE_STATUS_ORDER } from "@/lib/attendance-meta";

/**
 * The month behind the day sheet, in the space beside the date.
 *
 * ★ The register's header card was a date field and a progress ring in the
 * left third, and nothing at all in the other two — about 900px of white on a
 * desktop, on the screen a teacher opens every morning. This is what goes
 * there: not a second register, but the question the register cannot answer
 * while you are filling it in — *how has this month gone*.
 *
 * ★★ "Ирсэн" is `PRESENT + HALF_DAY`, defined here and nowhere else.
 *
 * The endpoint returns raw counts on purpose (`groupAttendanceSummarySchema`
 * says why): what counts as attending is a policy question the funding rules
 * answer differently, so each screen states its own definition rather than
 * inheriting one it cannot see. A half day is a day the child was here, which
 * is the reading a teacher wants; the funding register splits them because it
 * bills them differently.
 *
 * ★★★ Only days that carry a register appear on the chart.
 *
 * A kindergarten's working days are the days somebody recorded, not weekdays
 * on a calendar — the same definition the funding register uses. A weekend
 * padded in as a zero column would read as a day the whole group missed.
 */
export function AttendanceMonthPanel({ groupId, month }: { groupId: string; month: string }) {
  const summary = useQuery({
    queryKey: qk.groupAttendanceSummary(groupId, month),
    queryFn: () =>
      get(`/groups/${groupId}/attendance/summary?month=${month}`, groupAttendanceSummarySchema),
    enabled: Boolean(groupId),
    staleTime: 60_000,
  });

  if (summary.isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-[120px] w-full" />
      </div>
    );
  }

  /*
   * A failure here must not take the register with it. The sheet beside this
   * is the thing a teacher came to use; a month panel that cannot load is a
   * missing panel, not a broken screen — the same call `BoardCardEmpty` makes
   * on the dashboard.
   */
  if (summary.isError || !summary.data) return null;

  const { totals, days, roster, children } = summary.data;
  const recordedDays = days.length;

  if (recordedDays === 0) {
    return (
      <div className="flex flex-col justify-center gap-1 rounded-control bg-canvas px-4 py-5 text-center">
        <p className="text-body font-medium text-ink">Энэ сард бүртгэл алга</p>
        <p className="text-caption text-muted">
          Өдрийн ирцийг бүртгэснээр сарын дүр зураг энд харагдана.
        </p>
      </div>
    );
  }

  const marks = Object.values(totals).reduce((sum, n) => sum + n, 0);
  const attended = totals.PRESENT + totals.HALF_DAY;

  /*
   * The share is of *marks*, not of `roster × days`. A day somebody forgot to
   * register is not a day everybody was absent, and dividing by a headcount
   * the register never covered would quietly report exactly that.
   */
  const share = (count: number) => (marks === 0 ? 0 : Math.round((count / marks) * 100));

  /*
   * ★ The last ten recorded days, not the whole month.
   *
   * `ColumnChart` is built for a handful of named columns — its label is
   * `line-clamp-2` and centred, which is right for five weekdays and wrong for
   * twenty-two dates: at nineteen columns "03" wrapped onto two lines and the
   * axis became a grid of loose digits. Ten columns are wide enough for a date
   * to stay on one line, and "how has the last fortnight gone" is the question
   * a trend answers anyway. The month's totals beside it are still the month's.
   *
   * The leading zero goes too: "3" and "17" read as dates, "03" reads as a
   * code, and every character saved is width the label does not have to wrap.
   */
  const RECENT_DAYS = 10;
  const recent = days.slice(-RECENT_DAYS);
  const columns = recent.map((day) => {
    const dayMarks = Object.values(day.counts).reduce((sum, n) => sum + n, 0);
    const here = day.counts.PRESENT + day.counts.HALF_DAY;
    return {
      label: String(Number(day.date.slice(8))),
      value: dayMarks === 0 ? null : Math.round((here / dayMarks) * 100),
      accessibleLabel: `${day.date}: ${here}/${dayMarks} ирсэн`,
    };
  });

  /*
   * Who is missing most, and only when it is worth a name. Sorted by days away
   * and cut at three: this is a prompt to ring a family, not a second roster —
   * the sheet below already lists everyone.
   */
  const absentees = children
    .map((row) => ({
      name: `${row.child.lastName} ${row.child.firstName}`,
      away: row.counts.ABSENT + row.counts.SICK + row.counts.EXCUSED + row.counts.OTHER,
    }))
    .filter((row) => row.away > 0)
    .sort((a, b) => b.away - a.away)
    .slice(0, 3);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-lead font-semibold text-ink">Сарын дүр зураг</h3>
        <p className="text-caption text-muted">
          {recordedDays} өдөр бүртгэсэн · {roster} хүүхэд
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,260px)] xl:gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted">
            {recent.length === recordedDays
              ? "Өдөр бүрийн ирц"
              : `Сүүлийн ${recent.length} өдрийн ирц`}{" "}
            — <span className="font-semibold text-ink">{share(attended)}%</span> сарын дунджаар
          </p>
          <ColumnChart columns={columns} height={104} />
        </div>

        <div className="flex flex-col gap-1.5">
          {ATTENDANCE_STATUS_ORDER.map((status) => (
            <BarRow
              key={status}
              inline
              label={ATTENDANCE_STATUS_LABEL[status] ?? status}
              percent={share(totals[status])}
              value={totals[status]}
              tone={ATTENDANCE_STATUS_CHART_TONE[status] ?? "sky"}
              accessibleLabel={`${ATTENDANCE_STATUS_LABEL[status]}: ${totals[status]} өдөр`}
              labelWidth="w-[92px]"
            />
          ))}
          {/*
            OTHER is out of `ATTENDANCE_STATUS_ORDER` — the map predates the
            sixth status — so it is rendered only when it has been used, rather
            than adding a permanent "Бусад: 0" row to every group's panel.
          */}
          {totals.OTHER > 0 ? (
            <BarRow
              inline
              label={ATTENDANCE_STATUS_LABEL.OTHER ?? "Бусад"}
              percent={share(totals.OTHER)}
              value={totals.OTHER}
              tone="sky"
              accessibleLabel={`Бусад: ${totals.OTHER} өдөр`}
              labelWidth="w-[92px]"
            />
          ) : null}
        </div>
      </div>

      {absentees.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border-soft pt-3">
          <span className="text-caption text-muted">Хамгийн олон өдөр ирээгүй:</span>
          {absentees.map((row) => (
            <span
              key={row.name}
              className="rounded-pill bg-canvas px-2.5 py-1 text-caption text-ink"
            >
              {row.name} · {row.away}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
