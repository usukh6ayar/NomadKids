"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { groupAttendanceSummarySchema, ATTENDANCE_STATUS_LABEL } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { BarRow } from "@/components/ui/chart/bar-row";
import { ColumnChart } from "@/components/ui/chart/columns";
import { cn } from "@/lib/utils";
import { TONE_SURFACE } from "@/components/ui/tone";
import { Skeleton } from "@/components/ui/states";
import { RegisterProgress, type RegisterCount } from "@/components/register/register-progress";
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
/**
 * Weekdays in `YYYY-MM`, and how many of them have already passed.
 *
 * ★ A calendar count, and deliberately a different thing from the chart's
 * "recorded days" above.
 *
 * The doc comment on this component says a kindergarten's working days are
 * the days somebody recorded — that is right about *columns*, where padding a
 * weekend in as a zero would read as a day the whole group missed. It is the
 * wrong denominator for "how much of the month is filled in", which is the
 * question the client asked: the days nobody recorded are exactly the ones
 * that answer it, so they have to be counted from the calendar rather than
 * from the rows.
 *
 * Mon–Fri. A kindergarten that opens on a Saturday would need its own
 * calendar, which is a setting nothing in the product carries yet.
 */
function workingDaysIn(month: string, today: string): { total: number; elapsed: number } {
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();

  let total = 0;
  let elapsed = 0;
  for (let day = 1; day <= last; day += 1) {
    const date = new Date(Date.UTC(year!, monthNumber! - 1, day));
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    total += 1;
    if (date.toISOString().slice(0, 10) <= today) elapsed += 1;
  }
  return { total, elapsed };
}

/**
 * The month behind the register, with the day's own progress folded in.
 *
 * ★ `progress` arrives from the register — 2026-09-10, at the client's
 * request that the two graphs become one.
 *
 * `RegisterProgress` sat under the date fields at the top of the page and
 * this panel sat at the bottom, and they were answering the same question a
 * scroll apart: how much of the register is done. The ring is about the
 * selected *day* and the bars below are about the month, which is why they are
 * two blocks rather than one chart — but they belong on the same card, and a
 * teacher should not have to hold one in their head while scrolling to the
 * other.
 *
 * Optional, because the journal renders this panel too and has no day being
 * edited to report progress on.
 */
export function AttendanceMonthPanel({
  groupId,
  month,
  progress,
}: {
  groupId: string;
  month: string;
  progress?: { recorded: number; total: number; breakdown: RegisterCount[] };
}) {
  const auto = workingDaysIn(month, new Date().toISOString().slice(0, 10));
  const [workingDays, setWorkingDays] = useState(auto.total);
  /** Which of the two readings of the same statuses is on screen. */
  const [view, setView] = useState<"day" | "month">("month");

  // A different month is a different calendar; the last month's correction is
  // not an assertion about this one.
  useEffect(() => setWorkingDays(auto.total), [auto.total]);

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

  const monthLabel = `${month.slice(0, 4)} оны ${Number(month.slice(5, 7))}-р сар`;
  /*
   * The override shifts the whole month, so the elapsed half moves with it —
   * a holiday that removed two working days removed two that have passed, not
   * two that are still to come.
   */
  const adjustment = workingDays - auto.total;
  const elapsedDays = Math.max(0, Math.min(workingDays, auto.elapsed + adjustment));
  const remainingDays = Math.max(0, workingDays - elapsedDays);

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
  /*
   * The most recent day that carries a register — the "today" figure whenever
   * today has been filled in, and the last one filed otherwise. Taken from
   * `days` rather than from the calendar so it can never name a day nobody
   * registered.
   */
  const lastRecorded = days.at(-1) ?? null;
  const lastDay = lastRecorded
    ? (() => {
        const marks = Object.values(lastRecorded.counts).reduce((sum, n) => sum + n, 0);
        const here = lastRecorded.counts.PRESENT + lastRecorded.counts.HALF_DAY;
        return { here, marks, percent: marks === 0 ? 0 : Math.round((here / marks) * 100) };
      })()
    : null;
  const lastDayLabel = lastRecorded
    ? `${Number(lastRecorded.date.slice(5, 7))}/${Number(lastRecorded.date.slice(8))}`
    : null;

  const absentees = children
    .map((row) => ({
      name: `${row.child.lastName} ${row.child.firstName}`,
      away: row.counts.ABSENT + row.counts.SICK + row.counts.EXCUSED + row.counts.OTHER,
    }))
    .filter((row) => row.away > 0)
    .sort((a, b) => b.away - a.away)
    .slice(0, 3);

  /*
   * `OTHER` is out of `ATTENDANCE_STATUS_ORDER` — the map predates the sixth
   * status — so it joins the list only when it has been used, rather than
   * adding a permanent "Бусад: 0" row to every group's panel.
   */
  const monthStatuses = [
    ...ATTENDANCE_STATUS_ORDER,
    ...(totals.OTHER > 0 ? (["OTHER"] as const) : []),
  ];

  const breakdownRows =
    view === "day" && progress
      ? progress.breakdown
          .filter((row) => row.count > 0)
          .map((row) => ({
            ...row,
            percent: progress.total === 0 ? 0 : Math.round((row.count / progress.total) * 100),
          }))
      : monthStatuses.map((status) => ({
          key: status,
          label: ATTENDANCE_STATUS_LABEL[status] ?? status,
          count: totals[status],
          tone: ATTENDANCE_STATUS_CHART_TONE[status] ?? "sky",
          percent: share(totals[status]),
        }));

  return (
    <div className="flex flex-col gap-4">
      {progress && progress.total > 0 ? (
        <RegisterProgress
          inset
          recorded={progress.recorded}
          total={progress.total}
          breakdown={progress.breakdown}
        />
      ) : null}

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="flex flex-wrap items-baseline gap-x-1.5 text-lead font-semibold text-ink">
          <span>{monthLabel} · ажлын</span>
          {/*
            ★ Auto from the calendar, and correctable — the client asked for
            both. Mon–Fri is right for most months and wrong for the ones with
            a public holiday in them, and nothing in the product carries a
            holiday calendar to know which. So the number is computed and the
            teacher can say otherwise.

            ★★ It does not persist. There is nowhere to put it: a working-day
            count is a fact about a kindergarten's month, which by §2.3 would
            be a table rather than a column somewhere, and inventing one to
            hold a number nobody has asked to store yet is the wrong order.
            Typing over it corrects the two figures below for this visit.
          */}
          <input
            type="number"
            min={0}
            max={31}
            value={workingDays}
            aria-label={`${monthLabel}-ийн ажлын хоног`}
            onChange={(event) => setWorkingDays(Number(event.target.value))}
            className="w-14 rounded-control border border-border bg-surface px-1.5 py-0.5 text-center text-lead font-semibold tabular-nums text-ink focus-visible:outline-2 focus-visible:outline-primary"
          />
          <span>хоног</span>
        </h3>
        {/*
          Two facts, not one: how much of the month is filled in, and how much
          of it is still to come. "8 өдөр бүртгэсэн" alone cannot tell a teacher
          whether they are up to date or four days behind.
        */}
        <p className="text-caption text-muted">
          {recordedDays}/{elapsedDays} бүртгэсэн · {remainingDays} үлдсэн · {roster} хүүхэд
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,260px)] xl:gap-6">
        <div className="flex flex-col gap-3">
          {/*
            ★ Two named figures above the chart — 2026-09-10, at the client's
            request. The caption read "Өдөр бүрийн ирц — 76% сарын дунджаар",
            which puts two different measurements in one sentence and leaves
            the reader to work out which number belongs to which: the words
            are about the daily columns and the percentage is about the month.

            Named separately, each says what it is and over what. "Ирсэн" is
            PRESENT + HALF_DAY on both, so the day and the month are the same
            question asked over different spans rather than two definitions.
          */}
          <dl className="grid grid-cols-2 gap-2 sm:gap-3">
            {[
              {
                key: "day",
                term: lastDayLabel ? `${lastDayLabel} — ирсэн` : "Сүүлийн өдөр",
                value: lastDay ? `${lastDay.percent}%` : "—",
                note: lastDay ? `${lastDay.here}/${lastDay.marks} хүүхэд` : "бүртгэл алга",
                tone: "sky" as const,
              },
              {
                key: "month",
                term: "Сарын дундаж — ирсэн",
                value: `${share(attended)}%`,
                note: `${recordedDays} өдрийн дунджаар`,
                tone: "mint" as const,
              },
            ].map((tile) => (
              <div
                key={tile.key}
                className={cn(
                  "flex min-w-0 flex-col gap-0.5 rounded-card px-3 py-2.5",
                  TONE_SURFACE[tile.tone],
                )}
              >
                <dt className="truncate text-caption opacity-80">{tile.term}</dt>
                <dd className="text-display font-bold leading-none tabular-nums">{tile.value}</dd>
                <dd className="truncate text-caption opacity-80">{tile.note}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-col gap-1.5">
            <p className="text-caption text-muted">
              {recent.length === recordedDays
                ? "Өдөр бүрийн ирсэн хувь"
                : `Сүүлийн ${recent.length} өдрийн ирсэн хувь`}
            </p>
            <ColumnChart columns={columns} height={104} />
          </div>
        </div>

        {/*
          ★ The same four statuses, two ways — 2026-09-10, at the client's
          request that this section read "өдрийн ... ба сарын".

          One breakdown that silently means "the month" is the version a
          teacher misreads on the morning they are checking today. Naming the
          reading, and letting it switch, is cheaper than a second panel:
          `progress` already carries the day's counts, because the register
          above is counting them for its own ring.
        */}
        <div className="flex flex-col gap-2">
          <div
            role="group"
            aria-label="Ирцийн задаргааны хугацаа"
            className="flex gap-1 self-start rounded-pill bg-canvas p-0.5"
          >
            {(
              [
                ["day", "Өдрийн"],
                ["month", "Сарын"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                disabled={key === "day" && !progress}
                onClick={() => setView(key)}
                className={cn(
                  "min-h-8 rounded-pill px-3 text-caption font-semibold transition-colors disabled:opacity-40",
                  view === key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            {breakdownRows.map((row) => (
              <BarRow
                key={row.key}
                inline
                label={row.label}
                percent={row.percent}
                value={row.count}
                tone={row.tone}
                accessibleLabel={`${row.label}: ${row.count} ${view === "day" ? "хүүхэд" : "өдөр"}`}
                labelWidth="w-[92px]"
              />
            ))}
            <p className="mt-0.5 text-caption text-muted" data-testid="breakdown-total">
              Нийт{" "}
              <span className="font-semibold text-ink">
                {breakdownRows.reduce((sum, row) => sum + row.count, 0)}
              </span>{" "}
              {view === "day" ? "хүүхэд бүртгэсэн" : "өдрийн тэмдэглэгээ"}
            </p>
          </div>
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
