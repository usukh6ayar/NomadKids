"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import {
  attendanceJournalSchema,
  groupListItemSchema,
  paginated,
  schoolYearSchema,
  type AttendanceJournal,
  type AttendanceJournalRow,
} from "@kinder/contracts";
import { z } from "zod";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { fullName } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

const yearsSchema = z.array(schoolYearSchema);
const groupsSchema = paginated(groupListItemSchema);

type Cell = z.infer<typeof import("@kinder/contracts").attendanceJournalCellSchema>;
type Window = { from: string; to: string };

const STATUS_CELL: Record<string, { short: string; className: string }> = {
  PRESENT: { short: "1", className: "bg-mint text-mint-ink" },
  HALF_DAY: { short: "½", className: "bg-sun text-sun-ink" },
  SICK: { short: "Ө", className: "bg-sun text-sun-ink" },
  EXCUSED: { short: "Ч", className: "bg-sky text-sky-ink" },
  ABSENT: { short: "Т", className: "bg-peach text-peach-ink" },
  OTHER: { short: "Б", className: "bg-canvas text-muted" },
};

function schoolYearBounds(name: string, startsOn?: string | null, endsOn?: string | null) {
  const parsed = name.match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
  const startYear = parsed ? Number(parsed[1]) : Number(startsOn?.slice(0, 4));
  if (!Number.isFinite(startYear)) return null;
  return {
    from: startsOn?.slice(0, 10) || `${startYear}-09-01`,
    to: endsOn?.slice(0, 10) || `${startYear + 1}-06-30`,
  };
}

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** The API accepts at most 92 days, so a school year is read in safe windows. */
function windows(from: string, to: string): Window[] {
  const result: Window[] = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const last = new Date(cursor);
    last.setUTCDate(last.getUTCDate() + 91);
    const stop = last < end ? last : end;
    result.push({
      from: cursor.toISOString().slice(0, 10),
      to: stop.toISOString().slice(0, 10),
    });
    cursor = new Date(stop);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

async function readWindow(
  kindergartenId: string,
  window: Window,
  filters: { groupId: string; status: string; q: string },
): Promise<AttendanceJournal[]> {
  const params = new URLSearchParams({
    from: window.from,
    to: window.to,
    page: "1",
    pageSize: "200",
  });
  if (filters.groupId) params.set("groupId", filters.groupId);
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  const path = `/kindergartens/${kindergartenId}/attendance/register`;
  const first = await get(`${path}?${params}`, attendanceJournalSchema);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) => {
      params.set("page", String(index + 2));
      return get(`${path}?${params}`, attendanceJournalSchema);
    }),
  );
  return [first, ...rest];
}

interface YearRow {
  child: AttendanceJournalRow["child"];
  group: AttendanceJournalRow["group"];
  cells: Map<string, Cell | null>;
}

function mergeRows(parts: AttendanceJournal[][]): Map<string, YearRow> {
  const merged = new Map<string, YearRow>();
  for (const pages of parts) {
    for (const page of pages) {
      for (const row of page.items) {
        const entry = merged.get(row.childId) ?? {
          child: row.child,
          group: row.group,
          cells: new Map<string, Cell | null>(),
        };
        page.days.forEach((day, index) => entry.cells.set(day, row.days[index] ?? null));
        merged.set(row.childId, entry);
      }
    }
  }
  return merged;
}

export function YearlyAttendance() {
  const { primaryKindergartenId } = useSession();
  const kindergartenId = primaryKindergartenId ?? "";
  const [yearId, setYearId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());

  const years = useQuery({
    queryKey: qk.adminSchoolYears(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/school-years`, yearsSchema),
    enabled: Boolean(kindergartenId),
  });
  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled: Boolean(kindergartenId),
    staleTime: 5 * 60_000,
  });
  const year =
    years.data?.find((item) => item.id === yearId) ??
    years.data?.find((item) => item.isCurrent) ??
    years.data?.[0];
  const bounds = useMemo(
    () => (year ? schoolYearBounds(year.name, year.startsOn, year.endsOn) : null),
    [year?.endsOn, year?.name, year?.startsOn],
  );
  const ranges = useMemo(() => (bounds ? windows(bounds.from, bounds.to) : []), [bounds]);
  const days = useMemo(() => (bounds ? dateRange(bounds.from, bounds.to) : []), [bounds]);

  const reads = useQueries({
    queries: ranges.map((range) => ({
      queryKey: ["attendance", "yearly", kindergartenId, range, groupId, status, q],
      queryFn: () => readWindow(kindergartenId, range, { groupId, status, q }),
      enabled: Boolean(kindergartenId),
      staleTime: 60_000,
    })),
  });

  const rows = useMemo(
    () => [...mergeRows(reads.map((read) => read.data ?? [])).values()],
    [reads],
  );
  const pending = years.isPending || groups.isPending || reads.some((read) => read.isPending);
  const failure = years.error ?? groups.error ?? reads.find((read) => read.isError)?.error;

  const months = useMemo(() => {
    const result: { key: string; label: string; days: string[] }[] = [];
    for (const day of days) {
      const key = day.slice(0, 7);
      const current = result[result.length - 1];
      if (current?.key === key) current.days.push(day);
      else result.push({ key, label: `${Number(day.slice(5, 7))}-р сар`, days: [day] });
    }
    return result;
  }, [days]);

  const attended = (row: YearRow) =>
    [...row.cells.values()].filter(
      (cell) => cell?.status === "PRESENT" || cell?.status === "HALF_DAY",
    ).length;
  const dayTotal = (day: string) =>
    rows.filter((row) => {
      const cell = row.cells.get(day);
      return cell?.status === "PRESENT" || cell?.status === "HALF_DAY";
    }).length;

  const download = () => {
    const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const header = ["№", "Суралцагчийн нэр", "Бүлэг", "Нийт ирсэн", ...days];
    const body = rows.map((row, index) => [
      index + 1,
      fullName(row.child),
      row.group.name,
      attended(row),
      ...days.map((day) => row.cells.get(day)?.status ?? ""),
    ]);
    const csv = [header, ...body].map((line) => line.map(quote).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `irts-${year?.name ?? "school-year"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(260px,400px)_minmax(220px,320px)_minmax(220px,280px)_minmax(280px,1fr)]">
        <Select
          aria-label="Хичээлийн жил"
          value={year?.id ?? ""}
          onChange={(event) => setYearId(event.target.value)}
        >
          {(years.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} оны хичээлийн жил
            </option>
          ))}
        </Select>
        <Select
          aria-label="Бүлэг"
          value={groupId}
          onChange={(event) => setGroupId(event.target.value)}
        >
          <option value="">Бүх бүлэг</option>
          {(groups.data?.items ?? []).map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Төлөв"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">Бүх төлөв</option>
          <option value="PRESENT,HALF_DAY">Ирсэн</option>
          <option value="SICK">Өвчтэй</option>
          <option value="EXCUSED">Чөлөөтэй</option>
          <option value="ABSENT">Тасалсан</option>
        </Select>
        <SearchField
          label="Суралцагч хайх"
          placeholder="Хайх..."
          value={search}
          onChange={setSearch}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-muted">
          1 = ирсэн · ½ = хагас өдөр · Ө = өвчтэй · Ч = чөлөөтэй · Т = тасалсан
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || rows.length === 0}
          onClick={download}
        >
          <Download size={16} aria-hidden /> Excel
        </Button>
      </div>

      {failure ? <ErrorState description={errorMessage(failure)} /> : null}
      {pending ? <LoadingState rows={8} /> : null}
      {!pending && !failure && rows.length === 0 ? (
        <EmptyState
          title="Ирцийн мэдээлэл алга"
          description="Сонгосон хичээлийн жил, бүлэг эсвэл төлөвт тохирох мэдээлэл олдсонгүй."
        />
      ) : null}

      {!pending && !failure && rows.length > 0 ? (
        <div className="max-h-[72vh] overflow-auto rounded-card border border-border bg-surface">
          <table className="border-separate border-spacing-0 text-[11px]">
            <caption className="sr-only">Хичээлийн жилийн ирцийн тайлан</caption>
            <thead className="sticky top-0 z-20">
              <tr>
                <th
                  rowSpan={2}
                  className="sticky left-0 z-40 min-w-12 border-b border-r border-border bg-sunken px-2 py-2 text-left"
                >
                  №
                </th>
                <th
                  rowSpan={2}
                  className="sticky left-12 z-40 min-w-52 border-b border-r border-border bg-sunken px-3 py-2 text-left"
                >
                  Суралцагчийн нэр
                </th>
                <th
                  rowSpan={2}
                  className="sticky left-64 z-40 min-w-32 border-b border-r border-border bg-sunken px-3 py-2 text-left"
                >
                  Бүлэг
                </th>
                <th
                  rowSpan={2}
                  className="sticky left-96 z-40 min-w-20 border-b border-r border-border bg-sunken px-2 py-2 text-center"
                >
                  Нийт
                </th>
                {months.map((month) => (
                  <th
                    key={month.key}
                    colSpan={month.days.length}
                    className="border-b border-r border-border bg-sunken px-2 py-2 text-center font-semibold text-ink"
                  >
                    {month.label}
                  </th>
                ))}
              </tr>
              <tr>
                {days.map((day) => (
                  <th
                    key={day}
                    className="min-w-8 border-b border-r border-border bg-sunken px-1 py-1.5 text-center font-medium text-muted"
                  >
                    {Number(day.slice(8))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const stickyBackground = index % 2 === 1 ? "bg-sunken" : "bg-surface";
                return (
                  <tr key={row.child.id} className={index % 2 === 1 ? "bg-sunken/40" : undefined}>
                    <td
                      className={cn(
                        "sticky left-0 z-10 border-b border-r border-border-soft px-2 py-2 text-muted",
                        stickyBackground,
                      )}
                    >
                      {index + 1}
                    </td>
                    <td
                      className={cn(
                        "sticky left-12 z-10 border-b border-r border-border-soft px-3 py-2 font-semibold text-ink",
                        stickyBackground,
                      )}
                    >
                      {fullName(row.child)}
                    </td>
                    <td
                      className={cn(
                        "sticky left-64 z-10 border-b border-r border-border-soft px-3 py-2 text-muted",
                        stickyBackground,
                      )}
                    >
                      {row.group.name}
                    </td>
                    <td
                      className={cn(
                        "sticky left-96 z-10 border-b border-r border-border-soft px-2 py-2 text-center font-semibold tabular-nums text-ink",
                        stickyBackground,
                      )}
                    >
                      {attended(row)}
                    </td>
                    {days.map((day) => {
                      const cell = row.cells.get(day);
                      const style = cell ? STATUS_CELL[cell.status] : null;
                      return (
                        <td
                          key={day}
                          title={cell?.status ?? "Бүртгэлгүй"}
                          className="border-b border-r border-border-soft p-0.5 text-center"
                        >
                          <span
                            className={cn(
                              "grid h-6 min-w-7 place-items-center rounded-sm tabular-nums",
                              style?.className ?? "text-faint",
                            )}
                          >
                            {style?.short ?? "·"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-20">
              <tr className="font-semibold text-ink">
                <th
                  colSpan={3}
                  className="sticky left-0 z-30 border-r border-t border-border bg-sunken px-3 py-2 text-right"
                >
                  Нийт ирсэн
                </th>
                <td className="sticky left-96 z-30 border-r border-t border-border bg-sunken px-2 py-2 text-center tabular-nums">
                  {rows.reduce((sum, row) => sum + attended(row), 0)}
                </td>
                {days.map((day) => (
                  <td
                    key={day}
                    className="border-r border-t border-border bg-sunken px-1 py-2 text-center tabular-nums"
                  >
                    {dayTotal(day)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </div>
  );
}
