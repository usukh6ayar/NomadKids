"use client";

import { useQueries } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import {
  ATTENDANCE_STATUS_LABEL,
  attendanceRecordSchema,
  type attendanceRequestSchema,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { formatDate, todayLocal } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";
import { addDays, hhmm, mondayOf, who } from "@/components/attendance/handover-panel";

const recordsSchema = z.array(attendanceRecordSchema);
type Request = z.infer<typeof attendanceRequestSchema>;

/** A day the child was not handed over, in the family's words. */
const ABSENCE_LABEL: Record<string, string> = {
  EXCUSED: "Чөлөө",
  SICK: "Өвчтэй",
  ABSENT: "Тасалсан",
  OTHER: "Бусад",
};
const PRESENT_LIKE = new Set(["PRESENT", "HALF_DAY"]);
const WEEKDAY = ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"];

/**
 * «Гараас гарт» for a family — client, 2026-10-06: it replaces «Хүсэлтийн
 * түүх» and reads like the teacher's: a week at a time, a line a day, when
 * the child came and with whom, when they left and with whom; a day off says
 * «Чөлөө», «Өвчтэй» or «Тасалсан».
 *
 * ★ The register decides first. A day with no register yet shows what the
 * family itself reported — an arrival, a pickup, a leave — marked
 * «хүлээгдэж буй» while the teacher has not confirmed it. Rejected requests
 * are not shown.
 */
export function GuardianHandover({ childId, requests }: { childId: string; requests: Request[] }) {
  const today = todayLocal();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  // Monday to Friday: the kindergarten is shut at the weekend.
  const days = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];

  const queries = useQueries({
    queries: months.map((month) => ({
      queryKey: qk.attendance(childId, month),
      queryFn: () => get(`/children/${childId}/attendance?month=${month}`, recordsSchema),
    })),
  });
  const pending = queries.some((q) => q.isPending);
  const records = new Map(
    queries.flatMap((q) => q.data ?? []).map((record) => [record.date.slice(0, 10), record]),
  );

  const live = requests.filter((r) => r.reviewStatus !== "REJECTED");
  /* A family sends drop-off and pickup as two requests; a leave is a third kind. */
  const requestsFor = (day: string) => {
    const covering = live.filter(
      (r) => r.dateFrom.slice(0, 10) <= day && r.dateTo.slice(0, 10) >= day,
    );
    return {
      leave: covering.find((r) => r.requestedStatus !== "PRESENT"),
      arrival: covering.find((r) => r.arrivedWith),
      pickup: covering.find((r) => r.pickedUpWith),
    };
  };

  return (
    // The «Гараас гарт» tab names this panel — no section header of its own.
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Өмнөх 7 хоног"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </Button>
        <p className="text-body font-medium tabular-nums text-ink">
          {formatDate(days[0]!)} – {formatDate(days[4]!)}
        </p>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Дараах 7 хоног"
          disabled={addDays(weekStart, 7) > today}
          onClick={() => setWeekStart(addDays(weekStart, 7))}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </Button>
      </div>

      {pending ? (
        <LoadingState rows={3} />
      ) : (
        <TableShell caption="Гараас гарт" minWidth="min-w-0">
          <thead>
            <tr>
              <Th className="px-2 py-2 text-caption">Өдөр</Th>
              <Th className="px-2 py-2 text-caption">Ирсэн</Th>
              <Th className="px-2 py-2 text-caption">Явсан</Th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const record = records.get(day);
              const asked = record ? null : requestsFor(day);
              const label = (
                <span className="tabular-nums">
                  <span className="text-muted">
                    {WEEKDAY[new Date(`${day}T12:00:00`).getDay()]}
                  </span>{" "}
                  {Number(day.slice(5, 7))}.{Number(day.slice(8))}
                </span>
              );
              const isToday = day === today;

              let cells: React.ReactNode;
              if (record && !PRESENT_LIKE.has(record.status)) {
                cells = <Absence colSpan={2} status={record.status} />;
              } else if (asked?.leave) {
                // A leave asked for ahead shows on its future days too.
                cells = (
                  <Absence
                    colSpan={2}
                    status={asked.leave.requestedStatus}
                    waiting={asked.leave.reviewStatus === "PENDING"}
                  />
                );
              } else if (day > today) {
                cells = (
                  <Td colSpan={2} className="px-2 py-2 text-caption text-faint">
                    —
                  </Td>
                );
              } else {
                const arrival = record ?? asked?.arrival;
                const pickup = record ?? asked?.pickup;
                cells = (
                  <>
                    <Moment
                      time={hhmm(arrival?.arrivedAt)}
                      companion={who(arrival?.arrivedWith, arrival?.arrivedWithName)}
                      waiting={!record && asked?.arrival?.reviewStatus === "PENDING"}
                    />
                    <Moment
                      time={hhmm(pickup?.pickedUpAt)}
                      companion={who(pickup?.pickedUpWith, pickup?.pickedUpWithName)}
                      waiting={!record && asked?.pickup?.reviewStatus === "PENDING"}
                    />
                  </>
                );
              }

              return (
                <tr key={day} className={cn(isToday && "bg-primary-soft/40")}>
                  <Td className="whitespace-nowrap px-2 py-2 text-caption text-ink">{label}</Td>
                  {cells}
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}

function Moment({
  time,
  companion,
  waiting,
}: {
  time: string;
  companion: string;
  waiting: boolean;
}) {
  if (!time) {
    return <Td className="px-2 py-2 text-caption text-faint">—</Td>;
  }
  return (
    <Td className="px-2 py-2 text-caption">
      <span className="block font-semibold tabular-nums text-ink">{time}</span>
      <span className="block text-muted">
        {companion}
        {waiting ? " · хүлээгдэж буй" : ""}
      </span>
    </Td>
  );
}

function Absence({
  status,
  colSpan,
  waiting = false,
}: {
  status: string;
  colSpan: number;
  waiting?: boolean;
}) {
  return (
    <Td colSpan={colSpan} className="px-2 py-2 text-caption font-medium text-ink">
      {ABSENCE_LABEL[status] ?? ATTENDANCE_STATUS_LABEL[status] ?? status}
      {waiting ? <span className="font-normal text-muted"> · хүлээгдэж буй</span> : null}
    </Td>
  );
}
