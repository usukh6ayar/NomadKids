"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Thermometer,
  Users,
} from "lucide-react";
import { groupAttendanceSummarySchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Donut, type DonutSegment } from "@/components/ui/chart/donut";
import { TONE_SURFACE, TONE_VAR, type Tone } from "@/components/ui/tone";
import { Skeleton } from "@/components/ui/states";
import type { RegisterCount } from "@/components/register/register-progress";
import { cn } from "@/lib/utils";

/**
 * The report at the foot of the teacher's register — "Өнөөдөр" and "Сар".
 *
 * ★ REDESIGN 2026-09-12, to the client's own two screens ("багшийн ирцийн
 * график яг ингэж харагд").
 *
 * What it replaced answered the same questions in six blocks — an editable
 * working-day field, four labelled facts, two percentage tiles, a ten-column
 * trend, a switchable bar breakdown and a totals line — and a teacher had to
 * assemble the picture from them. The drawing is two readings of one thing:
 * **today**, as a ring of the whole roster with every status named beside it,
 * and **the month**, as one average with the four figures that explain it.
 *
 * ★★ "Ирсэн" is `PRESENT + HALF_DAY`, defined here and nowhere else. The
 * endpoint returns raw counts on purpose (`groupAttendanceSummarySchema` says
 * why): what counts as attending is a policy question the funding rules answer
 * differently, so each screen states its own definition rather than inheriting
 * one it cannot see. A half day is a day the child was here, which is the
 * reading a teacher wants.
 *
 * ★★★ Every percentage on the day card is **of the roster**, not of the marks.
 *
 * That is the client's own arithmetic — 20 of 25 is 80%, and the one child
 * nobody has marked is 4% rather than nothing. It also makes "Бүртгээгүй" a
 * real slice of the ring instead of a rounding error, which is the number a
 * teacher is looking for when they open this at four in the afternoon.
 */

const WEEKDAY = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"] as const;

/** `2026-09-11` → `2026 оны 9-р сарын 11`. */
function longDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${year} оны ${month}-р сарын ${day}`;
}

function monthLabelOf(month: string): string {
  return `${month.slice(0, 4)} оны ${Number(month.slice(5, 7))}-р сар`;
}

/** The month before `YYYY-MM`, and the month after. */
function shiftMonth(month: string, by: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, monthNumber! - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** A local calendar date, kept at midday so a positive UTC offset cannot roll it back. */
function weekdayOf(date: string): string {
  return `${WEEKDAY[new Date(`${date}T12:00:00`).getDay()]} гараг`;
}

type Counts = {
  PRESENT: number;
  HALF_DAY: number;
  EXCUSED: number;
  SICK: number;
  ABSENT: number;
  OTHER: number;
};

const ZERO: Counts = { PRESENT: 0, HALF_DAY: 0, EXCUSED: 0, SICK: 0, ABSENT: 0, OTHER: 0 };

/**
 * The five slices of a day, in the drawing's own order and colours.
 *
 * `OTHER` joins the list only when it has been used — the map predates the
 * sixth status, and a permanent "Бусад 0" row is a row every group reads past.
 */
function daySlices(counts: Counts, unrecorded: number) {
  return [
    {
      key: "PRESENT",
      label: "Ирсэн",
      count: counts.PRESENT + counts.HALF_DAY,
      tone: "mint" as Tone,
    },
    { key: "SICK", label: "Өвчтэй", count: counts.SICK, tone: "peach" as Tone },
    { key: "EXCUSED", label: "Чөлөөтэй", count: counts.EXCUSED, tone: "sun" as Tone },
    { key: "ABSENT", label: "Тасалсан", count: counts.ABSENT, tone: "sky" as Tone },
    ...(counts.OTHER > 0
      ? [{ key: "OTHER", label: "Бусад", count: counts.OTHER, tone: "cornflower" as Tone }]
      : []),
    { key: "NONE", label: "Бүртгээгүй", count: unrecorded, tone: undefined },
  ];
}

/**
 * A tinted figure — the four that explain the month's average.
 *
 * ★ Nothing truncates — 2026-09-12, at the client's report that the words had
 * gone missing ("Нийт хичээллэсэн өдөр гэдэг үг хасагдсан").
 *
 * They had not been removed: every line carried `truncate`, and a 2×2 grid on
 * a phone leaves about 120px beside a 36px icon — narrower than "Нийт
 * хичээллэсэн өдөр". The label a reader needs was the first thing the ellipsis
 * ate. A caption that wraps onto a second line costs a few pixels; a caption
 * that disappears costs the tile its meaning.
 */
function StatTile({
  tone,
  icon,
  label,
  value,
  percent,
  note,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  value: string;
  /** Shown in brackets after the figure — "23 (92%)". */
  percent?: number;
  note?: string;
}) {
  return (
    <div className="flex min-w-0 gap-2.5 rounded-card border border-border-soft bg-surface p-3">
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-control",
          TONE_SURFACE[tone],
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-caption leading-snug text-muted">{label}</p>
        <p className="text-lead font-bold leading-tight tabular-nums text-ink">
          {value}
          {percent === undefined ? null : (
            <span className="ms-1 text-body font-semibold text-muted">({percent}%)</span>
          )}
        </p>
        {note ? <p className="text-caption leading-snug text-muted">{note}</p> : null}
      </div>
    </div>
  );
}

/** The one-line verdict under each chart. */
function Verdict({
  tone,
  icon,
  title,
  note,
}: {
  tone: Tone;
  icon: React.ReactNode;
  title: string;
  note?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-card px-4 py-3", TONE_SURFACE[tone])}>
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-body font-semibold">{title}</p>
        {note ? <p className="text-caption opacity-80">{note}</p> : null}
      </div>
    </div>
  );
}

/** The segmented control's two states. */
function tabClass(active: boolean): string {
  return cn(
    "min-h-[44px] rounded-card px-4 text-body font-semibold transition-colors",
    active ? "bg-primary text-primary-contrast" : "bg-canvas text-muted hover:text-ink",
  );
}

/** Better, worse or level — the sentence, not just the number. */
function deltaNote(percent: number, previous: number | null, unit: "day" | "month"): string | null {
  if (previous === null) return null;
  const delta = percent - previous;
  const from = unit === "day" ? "Өмнөх бүртгэсэн өдрөөс" : "Өмнөх сараас";
  if (delta === 0) return `${from} өөрчлөгдөөгүй.`;
  return delta > 0 ? `${from} +${delta}%-иар өссөн байна.` : `${from} ${delta}%-иар буурсан байна.`;
}

export function AttendanceMonthPanel({
  groupId,
  month,
  date,
  progress,
}: {
  groupId: string;
  month: string;
  /**
   * The day the register above is editing, `YYYY-MM-DD`.
   *
   * Optional: the teacher's journal renders this panel with no day open, and
   * the "Өнөөдөр" tab then reports the last day that carries a register —
   * taken from the summary rather than from the calendar, so it can never name
   * a day nobody registered.
   */
  date?: string;
  /**
   * What the register above is holding right now, including rows the teacher
   * has changed and not yet saved.
   *
   * ★ It feeds the day's figures and nothing else — 2026-09-12. The panel used
   * to open with `RegisterProgress`'s strip ("20% · 1 хүүхэд бүртгэсэн · 5
   * хүүхдээс · 4 үлдсэн"), which the client removed: the ring below says the
   * same thing in one picture, and "Бүртгээгүй 4" is the same four children the
   * strip was counting. The other two registers keep their own strip; they have
   * no ring.
   */
  progress?: { recorded: number; total: number; breakdown: RegisterCount[] };
}) {
  /** Which of the two readings is on screen. */
  const [view, setView] = useState<"day" | "month">("day");
  /**
   * The month this panel is reporting on.
   *
   * ★ Its own state, seeded from the register's month — the drawing has arrows
   * either side of the heading. Browsing back here is a read, so it
   * deliberately does not move the register above; picking a different date up
   * there does bring this back to that month, which is the direction that
   * cannot surprise anybody.
   */
  const [viewMonth, setViewMonth] = useState(month);
  useEffect(() => setViewMonth(month), [month]);

  const summary = useQuery({
    queryKey: qk.groupAttendanceSummary(groupId, viewMonth),
    queryFn: () =>
      get(`/groups/${groupId}/attendance/summary?month=${viewMonth}`, groupAttendanceSummarySchema),
    enabled: Boolean(groupId),
    staleTime: 60_000,
  });

  /*
   * The month before, for the one sentence under the ring. Fetched only while
   * that tab is open — it is a comparison, not a figure the screen is about,
   * and a register opened to check today should not pay for it.
   */
  const previousMonth = shiftMonth(viewMonth, -1);
  const previous = useQuery({
    queryKey: qk.groupAttendanceSummary(groupId, previousMonth),
    queryFn: () =>
      get(
        `/groups/${groupId}/attendance/summary?month=${previousMonth}`,
        groupAttendanceSummarySchema,
      ),
    enabled: Boolean(groupId) && view === "month",
    staleTime: 60_000,
  });

  if (summary.isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[180px] w-full" />
      </div>
    );
  }

  /*
   * A failure here must not take the register with it. The sheet beside this is
   * the thing a teacher came to use; a panel that cannot load is a missing
   * panel, not a broken screen — the same call `BoardCardEmpty` makes on the
   * dashboard.
   */
  if (summary.isError || !summary.data) return null;

  const { totals, days, roster, children } = summary.data;
  const recordedDays = days.length;

  if (recordedDays === 0 && !progress) {
    return (
      <div className="flex flex-col justify-center gap-1 rounded-control bg-canvas px-4 py-5 text-center">
        <p className="text-body font-medium text-ink">Энэ сард бүртгэл алга</p>
        <p className="text-caption text-muted">
          Өдрийн ирцийг бүртгэснээр сарын дүр зураг энд харагдана.
        </p>
      </div>
    );
  }

  // ── The day ──────────────────────────────────────────────────────────────
  /*
   * The register above wins over the summary when it is open: it holds what is
   * on screen this second, including the row the teacher has just changed and
   * not yet saved. The summary is the fallback for the journal, which renders
   * this panel with no day being edited.
   */
  const liveCounts = progress
    ? progress.breakdown.reduce<Counts>(
        (acc, row) => ({ ...acc, [row.key]: (acc[row.key as keyof Counts] ?? 0) + row.count }),
        { ...ZERO },
      )
    : null;

  const fallbackDay = date
    ? (days.find((day) => day.date.slice(0, 10) === date) ?? null)
    : (days.at(-1) ?? null);

  const dayDate = date ?? fallbackDay?.date.slice(0, 10) ?? null;
  const dayCounts = liveCounts ?? (fallbackDay ? { ...ZERO, ...fallbackDay.counts } : { ...ZERO });
  const dayRoster = progress?.total ?? roster;
  const dayMarks = Object.values(dayCounts).reduce((sum, n) => sum + n, 0);
  const unrecorded = Math.max(0, dayRoster - dayMarks);
  const dayAttended = dayCounts.PRESENT + dayCounts.HALF_DAY;
  const dayPercent = dayRoster === 0 ? 0 : Math.round((dayAttended / dayRoster) * 100);

  /*
   * The day before it that carries a register — not `dayDate - 1`, which on a
   * Monday is a Sunday nobody registered and would read as a collapse.
   */
  const earlier = dayDate ? days.filter((day) => day.date.slice(0, 10) < dayDate) : [];
  const previousDay = earlier.at(-1) ?? null;
  const previousDayPercent =
    previousDay && roster > 0
      ? Math.round(((previousDay.counts.PRESENT + previousDay.counts.HALF_DAY) / roster) * 100)
      : null;

  const slices = daySlices(dayCounts, unrecorded);
  const daySegments: DonutSegment[] = slices
    .filter((slice) => slice.count > 0)
    .map((slice) => ({
      label: slice.label,
      value: slice.count,
      tone: slice.tone,
      color: slice.tone ? undefined : "var(--color-track)",
    }));

  // ── The month ────────────────────────────────────────────────────────────
  const attended = totals.PRESENT + totals.HALF_DAY;
  /*
   * The average of the daily attendance, not the share of the marks: a day
   * somebody forgot to register is not a day everybody was absent, and the
   * roster is the denominator the client's own figures use ("23 / 25").
   */
  const perDay = recordedDays === 0 ? 0 : attended / recordedDays;
  const monthPercent = roster === 0 ? 0 : Math.round((perDay / roster) * 100);

  /*
   * Every status as a share of the month's day-slots — the recorded days times
   * the roster. It is the denominator the average above already uses, so
   * "Ирсэн 92%" and "Өвчтэй 8%" are shares of one whole and can be read
   * against each other rather than each against its own total.
   */
  const slots = recordedDays * roster;
  const shareOfSlots = (count: number) => (slots === 0 ? 0 : Math.round((count / slots) * 100));

  const previousPercent = (() => {
    const data = previous.data;
    if (!data || data.days.length === 0 || data.roster === 0) return null;
    const attendedThen = data.totals.PRESENT + data.totals.HALF_DAY;
    return Math.round((attendedThen / data.days.length / data.roster) * 100);
  })();

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
      {/*
        Two readings of one register, so a tablist rather than two buttons.

        ★ Written out rather than mapped, and the ids are the reason:
        `landmarks.test.tsx` scans the source for an `aria-labelledby` whose id
        is never rendered, and a template-literal id built from a loop variable
        is invisible to it. Two buttons that say their own ids keep that guard
        working — see the docblock in that file for why it is a source scan.
      */}
      <div role="tablist" aria-label="Ирцийн тайлангийн хугацаа" className="grid grid-cols-2 gap-2">
        <button
          role="tab"
          type="button"
          id="attendance-report-tab-day"
          aria-selected={view === "day"}
          aria-controls="attendance-report-panel-day"
          onClick={() => setView("day")}
          className={tabClass(view === "day")}
        >
          Өнөөдөр
        </button>
        <button
          role="tab"
          type="button"
          id="attendance-report-tab-month"
          aria-selected={view === "month"}
          aria-controls="attendance-report-panel-month"
          onClick={() => setView("month")}
          className={tabClass(view === "month")}
        >
          Сар
        </button>
      </div>

      {view === "day" ? (
        <div
          role="tabpanel"
          id="attendance-report-panel-day"
          aria-labelledby="attendance-report-tab-day"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-4 rounded-card border border-border-soft p-4">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-control",
                  TONE_SURFACE.sky,
                )}
                aria-hidden="true"
              >
                <CalendarDays size={20} />
              </span>
              <div className="min-w-0">
                <p className="text-lead font-semibold text-ink">
                  {dayDate ? longDate(dayDate) : "Бүртгэсэн өдөр алга"}
                </p>
                {dayDate ? <p className="text-caption text-muted">{weekdayOf(dayDate)}</p> : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-5 sm:flex-nowrap sm:justify-start sm:gap-6">
              <Donut
                size={168}
                segments={daySegments}
                label={`${dayDate ?? "Өдөр"}: ${dayAttended}/${dayRoster} ирсэн`}
                centre={
                  <div className="text-center">
                    <p className="text-display font-bold leading-none tabular-nums text-ink">
                      {dayRoster}
                    </p>
                    <p className="mt-1 text-caption text-muted">нийт хүүхэд</p>
                  </div>
                }
              />

              <dl className="min-w-0 flex-1 space-y-2">
                {slices.map((slice) => (
                  <div key={slice.key} className="flex items-center gap-2.5">
                    <span
                      className="size-3 shrink-0 rounded-pill"
                      style={{
                        background: slice.tone ? TONE_VAR[slice.tone] : "var(--color-track)",
                      }}
                      aria-hidden="true"
                    />
                    <dt className="min-w-0 flex-1 truncate text-body text-ink">{slice.label}</dt>
                    <dd className="shrink-0 text-body font-bold tabular-nums text-ink">
                      {slice.count}
                    </dd>
                    <dd className="w-12 shrink-0 text-right text-caption tabular-nums text-muted">
                      ({dayRoster === 0 ? 0 : Math.round((slice.count / dayRoster) * 100)}%)
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <Verdict
            tone={dayPercent >= 85 ? "mint" : dayPercent >= 70 ? "sun" : "peach"}
            icon={<CheckCircle2 size={22} />}
            title={
              dayPercent >= 85
                ? "Өнөөдрийн ирц сайн байна!"
                : dayPercent >= 70
                  ? "Өнөөдрийн ирц дунджийн орчим байна."
                  : "Өнөөдөр ирц бага байна."
            }
            note={deltaNote(dayPercent, previousDayPercent, "day") ?? undefined}
          />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="attendance-report-panel-month"
          aria-labelledby="attendance-report-tab-month"
          className="flex flex-col gap-3"
        >
          <div className="flex items-center gap-2 rounded-card border border-border-soft px-2 py-1.5">
            <button
              type="button"
              aria-label="Өмнөх сар"
              onClick={() => setViewMonth(shiftMonth(viewMonth, -1))}
              className="grid size-10 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>

            <p className="flex min-w-0 flex-1 items-center justify-center gap-2 text-lead font-semibold text-ink">
              <CalendarDays size={18} className="shrink-0 text-muted" aria-hidden="true" />
              <span className="truncate">{monthLabelOf(viewMonth)}</span>
            </p>

            <button
              type="button"
              aria-label="Дараагийн сар"
              disabled={viewMonth >= month}
              onClick={() => setViewMonth(shiftMonth(viewMonth, 1))}
              className="grid size-10 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </div>

          {/*
            ★ The headcount over the ring — 2026-09-12: "диаграммын дээр нийт
            хэдэн хүүхэд байсныг биччихсэн байсан, тэр байхгүй байна."

            Every percentage on this tab is taken against it, and the day tab
            carries the same number in the hole of its own ring. Saying it once,
            above the chart, is what makes "92%" a share of something a reader
            can name.
          */}
          <p
            data-testid="month-roster"
            className="text-center text-caption text-muted sm:text-start"
          >
            Нийт <span className="font-semibold tabular-nums text-ink">{roster}</span> хүүхэд
          </p>

          <div className="flex flex-wrap items-center justify-center gap-5 sm:flex-nowrap sm:gap-6">
            <Donut
              size={168}
              segments={[
                { label: "Ирсэн", value: monthPercent, tone: "mint" },
                { label: "Ирээгүй", value: 100 - monthPercent, color: "var(--color-track)" },
              ]}
              label={`Сарын дундаж ирц ${monthPercent}%`}
              centre={
                <div className="text-center">
                  <p className="text-display font-bold leading-none tabular-nums text-ink">
                    {monthPercent}%
                  </p>
                  <p className="mt-1 text-caption text-muted">
                    Сарын дундаж
                    <br />
                    ирц
                  </p>
                </div>
              }
            />

            {/*
              ★ A count and its percentage, and no arithmetic in words —
              2026-09-12, at the client's correction: "Өвчтэй байсан биш
              Өвчтэй … Дундаж / өдөр, Нийт тохиолдол гэсэн үгнүүдээ бүгдийг нь
              авч хая, хувь болон тоогоор харуул."

              A rate per day ("2.1") is a figure a reader has to multiply back
              out before it means anything. The same fact as "44 (8%)" is the
              count they can check against the register and the share they can
              compare between months, and it needs no caption to explain it.
            */}
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
              {/*
                ★ No caption under either figure — 2026-09-12: "Нийт
                хичээллэсэн өдөр, 5 хүүхдээс үгнүүд хас."

                The headcount those captions explained is written over the ring
                now ("Нийт 25 хүүхэд"), so both lines were saying a second time
                what the card already said once.
              */}
              <StatTile
                tone="mint"
                icon={<CalendarDays size={18} />}
                label="Ажлын хоног"
                value={String(recordedDays)}
              />
              <StatTile
                tone="sky"
                icon={<Users size={18} />}
                label="Өдрийн дундаж ирц"
                value={String(Math.round(perDay))}
                percent={monthPercent}
              />
              <StatTile
                tone="peach"
                icon={<Thermometer size={18} />}
                label="Өвчтэй"
                value={String(totals.SICK)}
                percent={shareOfSlots(totals.SICK)}
              />
              <StatTile
                tone="sun"
                icon={<CalendarDays size={18} />}
                label="Чөлөөтэй"
                value={String(totals.EXCUSED)}
                percent={shareOfSlots(totals.EXCUSED)}
              />
            </div>
          </div>

          {/*
            ★ One sentence, the drawing's, at every level — 2026-09-12.

            It was graded into three bands, and the client's answer to that was
            "зас": the card reads as their drawing reads. The line under it is
            where this card tells a teacher whether the month is going well or
            badly, and that line is computed from the real months either side —
            "Өмнөх сараас -12%-иар буурсан байна." says the thing a band would
            have said, against a number rather than against a threshold
            invented here.
          */}
          <Verdict
            tone="sky"
            icon={<BarChart3 size={22} />}
            title="Энэ сард ирц тогтвортой, сайн байна."
            note={deltaNote(monthPercent, previousPercent, "month") ?? undefined}
          />
        </div>
      )}

      {/*
        ★ Kept at the very foot, across both tabs — 2026-09-12, at the client's
        own instruction ("хамгийн доор Хамгийн олон өдөр ирээгүй: гэдгийг
        байлга"). Sorted by days away and cut at three: this is a prompt to ring
        a family, not a second roster.
      */}
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
