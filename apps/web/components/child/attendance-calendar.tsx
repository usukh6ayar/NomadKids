"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { attendanceRecordSchema, attendanceSummarySchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Card, SectionHeader } from "@/components/ui/card";
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

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return monthKey(d.getFullYear(), d.getMonth());
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
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMonth((cur) => shiftMonth(cur, -1))}
              aria-label="Өмнөх сар"
              className="grid size-11 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <span className="min-w-[130px] text-center text-body font-medium text-ink">
              {formatMonthLabel(month)}
            </span>
            <button
              type="button"
              onClick={() => setMonth((cur) => shiftMonth(cur, 1))}
              aria-label="Дараах сар"
              disabled={month >= monthKey(now.getFullYear(), now.getMonth())}
              className="grid size-11 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        }
      />

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
                    <span className={cn("size-2 rounded-full", item.dot)} aria-hidden="true" />
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
                  <span className="text-center text-[11px] leading-tight text-muted">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-border pt-4">
              <h3 className="mb-3 font-semibold text-ink">Календарь</h3>
              <div className="grid grid-cols-7 gap-1">
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
                    className={cn("size-2.5 shrink-0 rounded-full", item.dot)}
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
