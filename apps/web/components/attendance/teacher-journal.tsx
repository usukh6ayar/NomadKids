"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { groupAttendanceRangeSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { AttendanceWeekGrid } from "@/components/attendance/week-grid";

/** The last day of `YYYY-MM`, as an ISO date. */
function endOfMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  // Day 0 of the *next* month is the last day of this one, and `Date.UTC`
  // rolls December over to January on its own.
  return new Date(Date.UTC(year!, monthNumber!, 0)).toISOString().slice(0, 10);
}

/**
 * Ирцийн дэлгэрэнгүй — the teacher's journal, a month at a time.
 *
 * ★ The register's own grid, read-only, over a whole month. Reusing
 * `AttendanceWeekGrid` rather than writing a second table is the point: the
 * client asked for the totals here to look "яг энэ ирцийн бүртгэл шиг", and
 * two tables that are meant to look identical are two tables that drift. The
 * tally rows, the cell colours and the Б.Батзориг names all come from the one
 * component, so they cannot disagree.
 *
 * ★★ Nothing here is editable, whatever the month.
 *
 * A journal is the record read back, and the register above is where it is
 * written — `editableDay={null}` says so. Correcting a past day is the
 * register's end-date field, which is one deliberate act on the screen that
 * owns the writing.
 *
 * ★★★ A month is at most 31 columns and the grid scrolls horizontally for
 * them. That is why the month is a picker rather than a year of columns: the
 * API caps a span at 31 days (§3.4), and a journal nobody can scroll to the
 * end of answers nothing.
 */
/** Ten years back from this one — a kindergarten's whole archive and no more. */
const YEARS = Array.from({ length: 10 }, (_, index) => String(new Date().getFullYear() - index));
const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));

/** Weekdays in `YYYY-MM`. Mon–Fri; see `month-panel.tsx` for the same count. */
function workingDaysIn(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  let total = 0;
  for (let day = 1; day <= last; day += 1) {
    const weekday = new Date(Date.UTC(year!, monthNumber! - 1, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) total += 1;
  }
  return total;
}

export function TeacherJournal({
  groupId,
  initialMonth,
}: {
  groupId: string;
  initialMonth: string;
}) {
  const [month, setMonth] = useState(initialMonth);
  const from = `${month}-01`;
  const to = endOfMonth(month);
  const year = month.slice(0, 4);
  const monthNumber = month.slice(5, 7);
  const workingDays = workingDaysIn(month);

  const range = useQuery({
    queryKey: qk.groupAttendanceRange(groupId, from, to),
    queryFn: () =>
      get(`/groups/${groupId}/attendance/range?from=${from}&to=${to}`, groupAttendanceRangeSchema),
  });

  /** Days in the span that carry at least one mark. */
  const recordedDays =
    range.data?.days.filter((day) => range.data!.rows.some((row) => row.records[day])).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/*
        ★ Two selects, not `<input type="month">` — 2026-09-10.

        The native control renders its own label in the *browser's* locale, so
        it read "September 2026" on a Mongolian screen and nothing this app
        does could change it. Two selects say "2026 он" and "9-р сар" because
        this app wrote the words.

        They share a row with the download at every width, which is what the
        client asked for; the button loses its label on a phone rather than
        wrapping, keeping the icon that survives without one.
      */}
      <div className="flex items-end gap-2 sm:gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:max-w-[320px] sm:gap-3">
          <Field label="Он">
            {({ id }) => (
              <Select
                id={id}
                value={year}
                onChange={(event) => setMonth(`${event.target.value}-${monthNumber}`)}
              >
                {YEARS.map((option) => (
                  <option key={option} value={option}>
                    {option} он
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Сар">
            {({ id }) => (
              <Select
                id={id}
                value={monthNumber}
                onChange={(event) => setMonth(`${year}-${event.target.value}`)}
              >
                {MONTHS.map((option) => (
                  <option key={option} value={option}>
                    {Number(option)}-р сар
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {/*
          ★ A plain link, not a fetch-then-blob.

          The endpoint answers with `Content-Disposition: attachment`, so the
          browser saves it and never navigates away — the same thing the
          director's journal does, and it keeps the cookie the API authorises
          on without this component having to hold a file in memory.
        */}
        <Button asChild variant="secondary" size="sm" className="shrink-0 sm:h-[48px]">
          <a href={downloadUrl(`/groups/${groupId}/attendance/range/export?from=${from}&to=${to}`)}>
            <Download aria-hidden />
            <span className="sr-only sm:not-sr-only">Сарын дэлгэрэнгүй татах</span>
          </a>
        </Button>
      </div>

      {/*
        ★ The month's working days, under the control that names the month.

        The register's own report carries this figure too, but the journal is
        where somebody reads a month they are not standing in — and "22 хоног"
        is the denominator every count in the grid below is against.
      */}
      <p className="text-caption text-muted">
        <span className="font-semibold text-ink">{workingDays}</span> ажлын хоног
        {range.data ? (
          <>
            {" · "}
            <span className="font-semibold text-ink">{recordedDays}</span> хоног бүртгэсэн
          </>
        ) : null}
      </p>

      {range.isLoading ? <LoadingState rows={6} shape="register" /> : null}
      {range.isError ? <ErrorState description={errorMessage(range.error)} /> : null}
      {range.data ? (
        range.data.rows.length === 0 ? (
          <EmptyState
            title="Бүлэгт хүүхэд алга"
            description="Энэ бүлэгт идэвхтэй бүртгэлтэй хүүхэд байхгүй байна."
          />
        ) : (
          <AttendanceWeekGrid
            data={range.data}
            editableDay={null}
            draft={{}}
            onSet={() => {}}
            showChildTotals
          />
        )
      ) : null}
    </div>
  );
}
