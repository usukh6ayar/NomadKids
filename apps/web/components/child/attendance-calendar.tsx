"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import {
  attendanceRecordSchema,
  attendanceSummarySchema,
  workingDaysInMonth,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { ChevronDown } from "lucide-react";
import { Card, SectionHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ATTENDANCE_STATUS_LABEL } from "@/lib/attendance-meta";
import { formatMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const recordsSchema = z.array(attendanceRecordSchema);

const WEEKDAYS = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];

const STATUS_CELL: Record<string, string> = {
  PRESENT: "bg-emerald-100 text-emerald-700",
  HALF_DAY: "bg-emerald-100 text-emerald-700",
  ABSENT: "bg-red-500 text-white",
  EXCUSED: "bg-amber-100 text-amber-800",
  SICK: "bg-pink-100 text-pink-700",
};

function monthKey(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}

/**
 * A real month grid — replaces the flat "энэ сарын ирц" list (`ChildAttendance`)
 * with the calendar shape the mock-up asked for. Reads the same two endpoints
 * that component already calls (`GET .../attendance`, `GET .../attendance/summary`
 * — the latter was built and contracted but never wired to any screen until now),
 * so no backend work was needed for this to show real data.
 *
 * ★ A day with no `Attendance` row is not "absent" — it is simply
 * unrecorded (a weekend, a holiday, or not yet reached), so it renders as a
 * plain muted cell rather than borrowing the ABSENT colour for silence. Only
 * a real `ABSENT` record — recorded by staff — gets the danger tone.
 */
export function AttendanceCalendar({ childId }: { childId: string }) {
  const now = new Date();
  const [month, setMonth] = useState(() => monthKey(now.getFullYear(), now.getMonth()));
  /** Whether the day grid is unfolded — closed by default; see its own note. */
  const [calendarOpen, setCalendarOpen] = useState(false);

  const records = useQuery({
    queryKey: qk.attendance(childId, month),
    queryFn: () => get(`/children/${childId}/attendance?month=${month}`, recordsSchema),
  });

  const summary = useQuery({
    queryKey: qk.attendanceSummary(childId, month),
    queryFn: () =>
      get(`/children/${childId}/attendance/summary?month=${month}`, attendanceSummarySchema),
  });

  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y!, m!, 0).getDate();
  // Monday-first offset: `getDay()` is Sunday-first (0-6), shifted so Monday is 0.
  const startOffset = (new Date(y!, m! - 1, 1).getDay() + 6) % 7;

  const byDate = new Map((records.data ?? []).map((r) => [r.date.slice(0, 10), r]));
  const offset = now.getTimezoneOffset() * 60_000;
  const todayKey = new Date(now.getTime() - offset).toISOString().slice(0, 10);

  const cells: ({ day: number; dateKey: string } | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      dateKey: `${month}-${String(i + 1).padStart(2, "0")}`,
    })),
  ];

  /*
    ★ The month's own working days — 2026-09-12, at the client's definition:
    "тухайн сард ажиллах хоног … 9 сард бямба ням гарагт ажиллахгүй, бас
    нийтээр амрах баяр тохиолдоогүй учир ажлын 22 хоногтой."

    ★★ Not the sum of the statuses, which is what this was for an hour. That
    counts the days the register *holds*, so a month a teacher had not finished
    marking would report itself as a shorter month — and the figure a parent
    reads would shrink to match the omission instead of exposing it.

    `workingDaysInMonth` lives in contracts because the teacher's report needs
    the same denominator: two implementations of it is two different attendance
    percentages for one month.
  */
  const workingDays = workingDaysInMonth(month);

  /** The twelve months up to this one — the dropdown's range. */
  const monthOptions = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    return monthKey(date.getFullYear(), date.getMonth());
  });

  const summaryItems = [
    {
      key: "present",
      label: "Ирсэн",
      value: (summary.data?.PRESENT ?? 0) + (summary.data?.HALF_DAY ?? 0),
      bar: "bg-emerald-500",
      dot: "bg-emerald-500",
    },
    {
      key: "absent",
      label: "Тасалсан",
      value: summary.data?.ABSENT ?? 0,
      bar: "bg-red-500",
      dot: "bg-red-500",
    },
    {
      key: "excused",
      label: "Чөлөөтэй",
      value: summary.data?.EXCUSED ?? 0,
      bar: "bg-amber-400",
      dot: "bg-amber-400",
    },
    {
      key: "sick",
      label: "Өвчтэй",
      value: summary.data?.SICK ?? 0,
      bar: "bg-pink-400",
      dot: "bg-pink-400",
    },
  ];
  const maxCount = Math.max(1, ...summaryItems.map((item) => item.value));

  return (
    <section aria-labelledby="attendance-calendar-heading">
      <SectionHeader
        id="attendance-calendar-heading"
        title="Ирцийн нэгтгэл"
        lede="Сарын төлөв болон календарийн бүртгэл"
      />

      {/*
        ★ The control row is its own full-width line — 2026-09-12, after two
        client notes: "Ажилласан 22 хоног баруун тийш шах" and "Сар сонгох
        хэсгийг зүүн тийш шах."

        It was in `SectionHeader`'s action slot, which is a `shrink-0` box: the
        two sat glued together at one end of it and neither could be moved
        without moving the other. A row of its own gives each an end —
        `justify-between` puts the picker at the left and the count at the
        right, at every width rather than only when the header happens not to
        wrap.

        ★★ A dropdown, not a pager. Two arrows reach last March in six presses
        and give no sign of how far back the record goes; twelve named months is
        one press to any of them.
      */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <label className="sr-only" htmlFor="attendance-month">
          Сар сонгох
        </label>
        <Select
          id="attendance-month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          /*
            ★ It takes the line's leftover width on a phone — 2026-09-12, from
            two client notes a few minutes apart: "2026 оны 9 сар утсан дээр
            уртаар харуулаад өг", then "нэг нь баруун талдаа нэг нь зүүн
            талдаа нэг цуваанд харагдмаар байна."

            170px truncated "2026 оны 9-р сар" to "2026 оны 9-р…", which is the
            one word that says which month is on screen — so it needs room. But
            `w-full` claimed the whole line and wrapped the day count onto a
            second one. `flex-1` with `min-w-0` is the pair that grows into
            what the count leaves and still allows the ellipsis rather than
            forcing the row wider than the screen.
          */
          className="h-10 min-w-0 flex-1 sm:w-[190px] sm:flex-none"
        >
          {monthOptions.map((option) => (
            <option key={option} value={option}>
              {formatMonthLabel(option)}
            </option>
          ))}
        </Select>

        {workingDays === null ? null : (
          <span className="shrink-0 rounded-pill bg-canvas px-2.5 py-1 text-caption font-medium tabular-nums text-muted">
            Ажилласан {workingDays} хоног
          </span>
        )}
      </div>

      <Card pad="roomy" className="flex flex-col gap-5">
        {records.isLoading || summary.isLoading ? <LoadingState rows={2} /> : null}
        {records.isError ? <ErrorState description={errorMessage(records.error)} /> : null}
        {summary.isError ? <ErrorState description={errorMessage(summary.error)} /> : null}

        {!records.isLoading && !records.isError && !summary.isLoading && !summary.isError ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {summaryItems.map((item) => (
                <div key={item.key} className="rounded-row bg-sunken px-3 py-3">
                  <span className="flex items-center gap-1.5 text-caption text-muted">
                    <span className={cn("size-2 rounded-pill", item.dot)} aria-hidden="true" />
                    {item.label}
                  </span>
                  <strong className="mt-1 block text-title font-semibold text-ink">
                    {item.value} <span className="text-caption font-normal text-muted">өдөр</span>
                  </strong>
                </div>
              ))}
            </div>

            <div
              className="grid h-36 grid-cols-4 items-end gap-3 rounded-row bg-sunken px-4 pb-3 pt-5"
              role="img"
              aria-label={summaryItems.map((item) => `${item.label} ${item.value} өдөр`).join(", ")}
            >
              {summaryItems.map((item) => (
                <div
                  key={item.key}
                  className="flex h-full flex-col items-center justify-end gap-1.5"
                >
                  <span className="text-caption font-semibold text-ink">{item.value}</span>
                  <span
                    className={cn(
                      "w-full max-w-12 rounded-t-control transition-[height]",
                      item.bar,
                    )}
                    style={{
                      height: `${Math.max(item.value === 0 ? 4 : 16, (item.value / maxCount) * 76)}px`,
                    }}
                    aria-hidden="true"
                  />
                  <span className="text-center text-caption leading-tight text-muted">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>

            {/*
              ★ The calendar folds — 2026-09-12, at the client's request:
              "календарь dropdown болго."

              Thirty-five cells is the tallest thing on this screen and the part
              a parent reads least: the month's figures above answer "how has it
              gone", and the grid answers "which day was which", which is a
              question you go looking for. Closed by default, so the summary and
              the day's actions sit together on one phone screen.
            */}
            <div className="border-t border-border pt-4">
              <button
                type="button"
                aria-expanded={calendarOpen}
                aria-controls="attendance-calendar-grid"
                onClick={() => setCalendarOpen((open) => !open)}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-control text-left font-semibold text-ink transition-colors hover:text-primary"
              >
                Календарь
                <ChevronDown
                  size={18}
                  aria-hidden="true"
                  className={cn(
                    "shrink-0 text-muted transition-transform",
                    calendarOpen && "rotate-180",
                  )}
                />
              </button>

              {/*
                ★ Rendered away, not `hidden` — the trap CLAUDE.md records: the
                `hidden` attribute is `display: none` at the lowest specificity
                and `grid` from the class list beats it, so the grid would have
                stayed on screen with the chevron claiming it was folded.
              */}
              <div
                id="attendance-calendar-grid"
                className={cn("mt-3 grid-cols-7 gap-1", calendarOpen ? "grid" : "hidden")}
              >
                {WEEKDAYS.map((w) => (
                  <span key={w} className="text-center text-caption font-semibold text-muted">
                    {w}
                  </span>
                ))}
                {cells.map((cell, i) => {
                  if (!cell) return <span key={`empty-${i}`} aria-hidden="true" />;
                  const record = byDate.get(cell.dateKey);
                  const isToday = cell.dateKey === todayKey;
                  const label = record
                    ? `${cell.day} — ${ATTENDANCE_STATUS_LABEL[record.status]}${record.note ? `, ${record.note}` : ""}`
                    : `${cell.day} — тэмдэглэгдээгүй`;

                  return (
                    <span
                      key={cell.dateKey}
                      role="img"
                      aria-label={label}
                      title={label}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-control text-caption font-medium",
                        record ? STATUS_CELL[record.status] : "bg-canvas text-muted",
                        isToday && "ring-2 ring-primary ring-offset-1 ring-offset-surface",
                      )}
                    >
                      {cell.day}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4">
              {summaryItems.map((item) => (
                <span key={item.key} className="flex items-center gap-1.5 text-caption text-muted">
                  <span
                    className={cn("size-2.5 shrink-0 rounded-pill", item.dot)}
                    aria-hidden="true"
                  />
                  {item.label}
                </span>
              ))}
            </div>
          </>
        ) : null}
      </Card>
    </section>
  );
}
