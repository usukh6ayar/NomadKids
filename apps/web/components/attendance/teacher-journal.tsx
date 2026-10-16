"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Download, PencilLine } from "lucide-react";
import { z } from "zod";
import {
  groupAttendanceRangeSchema,
  localDate,
  type GroupAttendanceRange,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { AttendanceWeekGrid, isWeekend } from "@/components/attendance/week-grid";

type RangeRow = GroupAttendanceRange["rows"][number];
/** Unsaved marks of the month being filled in: day → child → status. */
type MonthDraft = Record<string, Record<string, string>>;

/**
 * May this cell be filled in? A working day of the month (the calendar's,
 * from the API; Mon–Fri when it sent none), up to today in Ulaanbaatar, and
 * one the child spent in this group — `enrolledOn`'s rule, the end exclusive.
 */
function cellOpen(row: RangeRow, day: string, data: GroupAttendanceRange, today: string) {
  if (day > today) return false;
  if (data.workingDays ? !data.workingDays.includes(day) : isWeekend(day)) return false;
  if (row.startedOn && day < row.startedOn) return false;
  if (row.endedOn && day >= row.endedOn) return false;
  return true;
}

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
 * ★★ Read-only until «Сараар нөхөх» is pressed — 2026-10-16, the user: "Ирц
 * сараар нөхөх". Until then a journal was the record read back and nothing
 * here was editable; a kindergarten that came to the product mid-year, or a
 * teacher back from leave, had to open a past month one day at a time. The
 * mode is a deliberate press, so the read-only month cannot be changed by a
 * stray tap: the cells it opens are the child's own working days up to today
 * (`cellOpen`), «Бүгдийг ирсэн болгох» fills only the empty ones of those, and
 * nothing is written until Хадгалах.
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

  const toast = useToast();
  const queryClient = useQueryClient();
  const today = localDate();
  const [filling, setFilling] = useState(false);
  const [fillDraft, setFillDraft] = useState<MonthDraft>({});

  /** The draft's cells that differ from what is saved. */
  const changes = range.data
    ? range.data.rows.flatMap((row) =>
        Object.entries(fillDraft).flatMap(([day, byChild]) => {
          const status = byChild[row.child.id];
          return status && status !== row.records[day]?.status
            ? [{ childId: row.child.id, date: day, status }]
            : [];
        }),
      )
    : [];

  const stopFilling = () => {
    setFilling(false);
    setFillDraft({});
  };

  const changeMonth = (next: string) => {
    stopFilling();
    setMonth(next);
  };

  /** Every open, empty cell → Ирсэн. Never a cell that already has a mark. */
  const fillPresent = () => {
    if (!range.data) return;
    const data = range.data;
    setFillDraft((current) => {
      const next: MonthDraft = { ...current };
      for (const day of data.days) {
        for (const row of data.rows) {
          if (!cellOpen(row, day, data, today)) continue;
          if (row.records[day] || current[day]?.[row.child.id]) continue;
          next[day] = { ...(next[day] ?? {}), [row.child.id]: "PRESENT" };
        }
      }
      return next;
    });
  };

  const save = useMutation({
    mutationFn: () =>
      mutate(
        `/groups/${groupId}/attendance/range`,
        z.object({ created: z.number(), updated: z.number() }),
        { method: "PUT", body: { entries: changes } },
      ),
    onSuccess: ({ created, updated }) => {
      toast.success(`${created + updated} нүдний ирц хадгалагдлаа.`);
      stopFilling();
      void queryClient.invalidateQueries({ queryKey: ["group", groupId, "attendance"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
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
                onChange={(event) => changeMonth(`${event.target.value}-${monthNumber}`)}
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
                onChange={(event) => changeMonth(`${year}-${event.target.value}`)}
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

      {range.data && range.data.rows.length > 0 && month <= today.slice(0, 7) ? (
        filling ? (
          <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface p-3">
            <p className="min-w-0 flex-1 text-caption text-muted">
              {changes.length > 0
                ? `${changes.length} нүд хадгалагдаагүй байна.`
                : "Нүдэн дээр дарж ирцийг сонгоно уу. Өнөөдрөөс хойших болон амралтын өдөр хаалттай."}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={fillPresent}>
              <CheckCheck aria-hidden />
              Бүгдийг «ирсэн» болгох
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={stopFilling}>
              Болих
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={changes.length === 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </div>
        ) : (
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setFilling(true)}>
              <PencilLine aria-hidden />
              Сараар нөхөх
            </Button>
          </div>
        )
      ) : null}

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
            disabled={save.isPending}
            backfill={
              filling
                ? {
                    canEdit: (row, day) => cellOpen(row, day, range.data!, today),
                    draft: fillDraft,
                    onSet: (childId, day, status) =>
                      setFillDraft((current) => {
                        const forDay = { ...(current[day] ?? {}) };
                        if (status) forDay[childId] = status;
                        else delete forDay[childId];
                        return { ...current, [day]: forDay };
                      }),
                  }
                : undefined
            }
          />
        )
      ) : null}
    </div>
  );
}
