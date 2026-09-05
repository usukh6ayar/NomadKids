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
import {
  ATTENDANCE_STATUS_BG,
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUS_ORDER,
} from "@/lib/attendance-meta";
import { formatMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const recordsSchema = z.array(attendanceRecordSchema);

const WEEKDAYS = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];

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
  const todayKey = now.toISOString().slice(0, 10);

  const cells: ({ day: number; dateKey: string } | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      dateKey: `${month}-${String(i + 1).padStart(2, "0")}`,
    })),
  ];

  const total = ATTENDANCE_STATUS_ORDER.reduce((sum, s) => sum + (summary.data?.[s] ?? 0), 0);

  return (
    <section aria-labelledby="attendance-calendar-heading">
      <SectionHeader
        id="attendance-calendar-heading"
        title="Ирцийн хуанли"
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

      <Card pad="roomy" className="flex flex-col gap-4">
        {records.isLoading ? <LoadingState rows={2} /> : null}
        {records.isError ? <ErrorState description={errorMessage(records.error)} /> : null}

        {!records.isLoading && !records.isError ? (
          <>
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
                      record
                        ? cn(ATTENDANCE_STATUS_BG[record.status], "text-ink")
                        : "bg-canvas text-muted",
                      isToday && "ring-2 ring-primary ring-offset-1 ring-offset-surface",
                    )}
                  >
                    {cell.day}
                  </span>
                );
              })}
            </div>

            {total > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-pill bg-canvas">
                  {ATTENDANCE_STATUS_ORDER.filter((s) => (summary.data?.[s] ?? 0) > 0).map((s) => (
                    <span
                      key={s}
                      style={{ width: `${((summary.data?.[s] ?? 0) / total) * 100}%` }}
                      className={cn(ATTENDANCE_STATUS_BG[s], "h-full")}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {ATTENDANCE_STATUS_ORDER.filter((s) => (summary.data?.[s] ?? 0) > 0).map((s) => (
                    <span key={s} className="flex items-center gap-1.5 text-caption text-muted">
                      <span
                        className={cn("size-2.5 shrink-0 rounded-pill", ATTENDANCE_STATUS_BG[s])}
                        aria-hidden="true"
                      />
                      {ATTENDANCE_STATUS_LABEL[s]} — {summary.data?.[s] ?? 0}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-body text-muted">Энэ сард ирцийн тэмдэглэл алга.</p>
            )}
          </>
        ) : null}
      </Card>
    </section>
  );
}
