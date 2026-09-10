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
import { Field, Input } from "@/components/ui/field";
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

  const range = useQuery({
    queryKey: qk.groupAttendanceRange(groupId, from, to),
    queryFn: () =>
      get(`/groups/${groupId}/attendance/range?from=${from}&to=${to}`, groupAttendanceRangeSchema),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-[220px]">
          <Field label="Сар">
            {({ id }) => (
              <Input
                id={id}
                type="month"
                value={month}
                max={new Date().toISOString().slice(0, 7)}
                onChange={(event) => setMonth(event.target.value)}
              />
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
        <Button asChild variant="secondary">
          <a href={downloadUrl(`/groups/${groupId}/attendance/range/export?from=${from}&to=${to}`)}>
            <Download aria-hidden /> Сарын дэлгэрэнгүй татах
          </a>
        </Button>
      </div>

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
