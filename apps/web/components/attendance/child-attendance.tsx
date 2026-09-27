"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Eye, Pencil, Send, X } from "lucide-react";
import { attendanceJournalSchema, type AttendanceJournalRow } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { ATTENDANCE_STATUS_LETTER } from "@/lib/attendance-meta";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [20, 50, 100] as const;

/**
 * "Суралцагчаар" — the director's register a child per row, client's drawing
 * of 2026-09-27.
 *
 * ★ Every figure is read from `GET …/attendance/register`, the same response
 * the journal grid draws: `days` is the working days of the range, `counts`
 * the statuses that occurred. "Ирсэн" is `PRESENT + HALF_DAY`, the definition
 * every other attendance screen uses, and "Ирц %" is Ирсэн over the working
 * days. Зөвшөөрсөн and Татгалзсан are the child's absence requests in the
 * range by review state, `row.requests` — counted once per request.
 */
export function ChildAttendance({
  from,
  to,
  groupId,
  status,
  q,
}: {
  from: string;
  to: string;
  groupId: string;
  status: string;
  q: string;
}) {
  const { primaryKindergartenId } = useSession();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20);
  const [open, setOpen] = useState<AttendanceJournalRow | null>(null);

  // A filter change starts the list again from its first page.
  const filterKey = `${from}|${to}|${groupId}|${status}|${q}`;
  const [seenKey, setSeenKey] = useState(filterKey);
  if (seenKey !== filterKey) {
    setSeenKey(filterKey);
    setPage(1);
  }

  const params = new URLSearchParams({ from, to });
  if (groupId) params.set("groupId", groupId);
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  const queryString = params.toString();

  const register = useQuery({
    queryKey: qk.attendanceJournal(primaryKindergartenId ?? "", {
      from,
      to,
      groupId,
      status,
      q,
      page,
      pageSize,
    }),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/attendance/register?${queryString}`,
        attendanceJournalSchema,
      ),
    enabled: Boolean(primaryKindergartenId),
    placeholderData: (previous) => previous,
  });

  const data = register.data;
  const workingDays = data?.days.length ?? 0;
  const offset = (page - 1) * pageSize;

  if (register.isError) return <ErrorState description={errorMessage(register.error)} />;
  if (register.isPending) return <LoadingState rows={6} />;
  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        title="Суралцагч олдсонгүй"
        description="Сонгосон сард тохирох суралцагч алга. Сар, бүлэг, төлөв эсвэл хайлтаа өөрчилж үзнэ үү."
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-body">
          <caption className="sr-only">Суралцагчийн ирцийн бүртгэл</caption>
          <thead className="bg-sunken">
            <tr>
              {HEADINGS.map(([label, align]) => (
                <th
                  key={label}
                  scope="col"
                  className={cn(
                    "border-b border-border px-3 py-2 text-body font-semibold text-ink",
                    align === "left" ? "text-left" : "text-center",
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((row, index) => {
              const counts = tally(row);
              return (
                <tr key={row.childId} className="border-b border-border-soft last:border-0">
                  <td className="px-3 py-1.5 tabular-nums text-muted">{offset + index + 1}</td>
                  <td className="px-3 py-1.5 text-ink">{row.group.name}</td>
                  <td className="px-3 py-1.5 text-ink">{row.child.lastName ?? "—"}</td>
                  <td className="px-3 py-1.5 font-semibold text-ink">{row.child.firstName}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums text-ink">{workingDays}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums text-mint-ink">
                    {counts.present}
                  </td>
                  <td className="px-3 py-1.5 text-center tabular-nums text-cornflower-ink">
                    {counts.sick}
                  </td>
                  <td className="px-3 py-1.5 text-center tabular-nums text-sun-ink">
                    {counts.excused}
                  </td>
                  <td className="px-3 py-1.5 text-center tabular-nums text-danger">
                    {counts.absent}
                  </td>
                  {/* The child's absence requests in the range, by review state. */}
                  <td className="px-3 py-1.5 text-center tabular-nums text-ink">
                    {row.requests.approved}
                  </td>
                  <td className="px-3 py-1.5 text-center tabular-nums text-ink">
                    {row.requests.rejected}
                  </td>
                  <td className="px-3 py-1.5 text-center tabular-nums text-ink">
                    {percent(counts.present, workingDays)}
                  </td>
                  <td className="px-3 py-1 text-center">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setOpen(row)}
                      aria-label={`${row.child.lastName ?? ""} ${row.child.firstName} — харах`.trim()}
                    >
                      <Eye size={16} aria-hidden /> Харах
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lead text-muted">
          Нийт <span className="font-bold tabular-nums text-ink">{data.total}</span> суралцагч
        </p>
        <Pagination page={page} totalPages={data.totalPages} onPage={setPage} />
        <Select
          aria-label="Хуудас тутамд"
          value={String(pageSize)}
          onChange={(event) => {
            setPageSize(Number(event.target.value) as (typeof PAGE_SIZES)[number]);
            setPage(1);
          }}
          className="h-10 w-auto"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={String(size)}>
              {`${size} / хуудас`}
            </option>
          ))}
        </Select>
      </div>

      {open ? (
        <ChildAttendancePanel row={open} month={from.slice(0, 7)} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}

const HEADINGS = [
  ["№", "left"],
  ["Бүлэг", "left"],
  ["Овог", "left"],
  ["Нэр", "left"],
  ["Нийт өдөр", "center"],
  ["Ирсэн", "center"],
  ["Өвчтэй", "center"],
  ["Чөлөөтэй", "center"],
  ["Тасалсан", "center"],
  ["Зөвшөөрсөн", "center"],
  ["Татгалзсан", "center"],
  ["Ирц %", "center"],
  ["Дэлгэрэнгүй", "center"],
] as const;

/** The four a director reads; a legacy half day counts as a day the child came. */
function tally(row: AttendanceJournalRow) {
  const c = row.counts;
  return {
    present: (c.PRESENT ?? 0) + (c.HALF_DAY ?? 0),
    sick: c.SICK ?? 0,
    excused: c.EXCUSED ?? 0,
    absent: c.ABSENT ?? 0,
  };
}

function percent(count: number, of: number): string {
  if (!of) return "—";
  return `${((count / of) * 100).toFixed(1)}%`;
}

const STATUS_CELL: Record<string, string> = {
  PRESENT: "bg-mint text-mint-ink",
  HALF_DAY: "bg-mint text-mint-ink",
  SICK: "bg-cornflower text-cornflower-ink",
  EXCUSED: "bg-sun text-sun-ink",
  ABSENT: "bg-danger-soft text-danger",
};

const LEGEND = [
  ["PRESENT", "И - Ирсэн", "bg-mint-solid"],
  ["SICK", "Ө - Өвчтэй", "bg-cornflower-ink"],
  ["EXCUSED", "Ч - Чөлөөтэй", "bg-sun-ink"],
  ["ABSENT", "Т - Тасалсан", "bg-danger"],
] as const;

const WEEKDAYS = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];

/**
 * "Суралцагчийн дэлгэрэнгүй" — one child's month, opened from Харах.
 *
 * Its own read of the same register, narrowed by `childId`, so the arrows can
 * page through months without moving the table behind it. Nothing here is
 * invented either: the recent-records table has no recorder or ESIS state per
 * child in this response, so those columns read "—", and ESIS руу илгээх has
 * no per-child action to call and is shown disabled.
 */
function ChildAttendancePanel({
  row,
  month: initialMonth,
  onClose,
}: {
  row: AttendanceJournalRow;
  month: string;
  onClose: () => void;
}) {
  const { primaryKindergartenId } = useSession();
  const [month, setMonth] = useState(initialMonth);
  const { from, to } = monthRange(month);
  const today = localToday();

  const detail = useQuery({
    queryKey: qk.attendanceJournal(primaryKindergartenId ?? "", {
      from,
      to,
      childId: row.childId,
    }),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/attendance/register?from=${from}&to=${to}&childId=${row.childId}&page=1&pageSize=1`,
        attendanceJournalSchema,
      ),
    enabled: Boolean(primaryKindergartenId),
  });

  const data = detail.data;
  const child = data?.items[0];
  const workingDays = new Set(data?.days ?? []);
  const marks = new Map<string, { status: string; note: string | null }>();
  (data?.days ?? []).forEach((day, index) => {
    const cell = child?.days[index];
    if (cell) marks.set(day, cell);
  });
  const counts = child ? tally(child) : null;
  const total = data?.days.length ?? 0;
  const recent = [...marks.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, 5);
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/30" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Суралцагчийн дэлгэрэнгүй"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-[560px] flex-col bg-surface shadow-xl"
      >
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-title font-bold text-ink">Суралцагчийн дэлгэрэнгүй</h2>
            <button
              type="button"
              aria-label="Хаах"
              onClick={onClose}
              className="grid size-9 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
            >
              <X size={18} aria-hidden />
            </button>
          </div>

          <div>
            <p className="text-lead font-bold text-ink">
              {row.child.lastName} {row.child.firstName}
            </p>
            <p className="text-body text-muted">{row.group.name}</p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Өмнөх сар"
                onClick={() => setMonth(shiftMonth(month, -1))}
                className="grid size-8 place-items-center rounded-control border border-border text-muted hover:text-ink"
              >
                <ChevronLeft size={16} aria-hidden />
              </button>
              <p className="flex-1 text-center text-body font-semibold text-ink" aria-live="polite">
                {year} оны {monthNumber} сар
              </p>
              <button
                type="button"
                aria-label="Дараагийн сар"
                onClick={() => setMonth(shiftMonth(month, 1))}
                className="grid size-8 place-items-center rounded-control border border-border text-muted hover:text-ink"
              >
                <ChevronRight size={16} aria-hidden />
              </button>
              <Button variant="secondary" size="sm" onClick={() => setMonth(today.slice(0, 7))}>
                Өнөөдөр
              </Button>
            </div>

            {detail.isError ? <ErrorState description={errorMessage(detail.error)} /> : null}
            {detail.isPending ? <LoadingState rows={4} /> : null}

            {data ? (
              <>
                <div
                  role="grid"
                  aria-label={`${year} оны ${monthNumber} сарын ирц`}
                  className="grid grid-cols-7 gap-1 text-center"
                >
                  {WEEKDAYS.map((day) => (
                    <span key={day} role="columnheader" className="text-caption text-muted">
                      {day}
                    </span>
                  ))}
                  {calendarCells(year, monthNumber).map((date, index) => {
                    if (!date) return <span key={`blank-${index}`} aria-hidden />;
                    const mark = marks.get(date);
                    const working = workingDays.has(date);
                    return (
                      <span
                        key={date}
                        role="gridcell"
                        title={
                          mark
                            ? `${date} — ${STATUS_TITLE[mark.status] ?? mark.status}${mark.note ? ` · ${mark.note}` : ""}`
                            : date
                        }
                        className={cn(
                          "grid h-7 place-items-center rounded-control text-caption font-semibold tabular-nums",
                          mark
                            ? (STATUS_CELL[mark.status] ?? "bg-sunken text-ink")
                            : working
                              ? "bg-sunken text-ink"
                              : "text-faint",
                          date === today && "ring-2 ring-primary",
                        )}
                      >
                        {Number(date.slice(8))}
                      </span>
                    );
                  })}
                </div>

                <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-caption text-muted">
                  {LEGEND.map(([status, label, swatch]) => (
                    <li key={status} className="inline-flex items-center gap-1.5">
                      <span aria-hidden className={cn("size-2.5 rounded-control", swatch)} />
                      {label}
                    </li>
                  ))}
                </ul>

                <dl className="grid grid-cols-5 gap-1.5">
                  <Stat label="Нийт өдөр" value={String(total)} />
                  <Stat
                    label="Ирсэн"
                    value={String(counts?.present ?? 0)}
                    share={percent(counts?.present ?? 0, total)}
                    tone="text-mint-ink"
                  />
                  <Stat
                    label="Өвчтэй"
                    value={String(counts?.sick ?? 0)}
                    share={percent(counts?.sick ?? 0, total)}
                    tone="text-cornflower-ink"
                  />
                  <Stat
                    label="Чөлөөтэй"
                    value={String(counts?.excused ?? 0)}
                    share={percent(counts?.excused ?? 0, total)}
                    tone="text-sun-ink"
                  />
                  <Stat
                    label="Тасалсан"
                    value={String(counts?.absent ?? 0)}
                    share={percent(counts?.absent ?? 0, total)}
                    tone="text-danger"
                  />
                </dl>
              </>
            ) : null}
          </div>

          {data ? (
            <>
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lead font-bold text-ink">Сүүлийн бүртгэлүүд</h3>
                </div>
                {recent.length === 0 ? (
                  <p className="rounded-card bg-sunken px-3 py-4 text-center text-body text-muted">
                    Энэ сард ирц бүртгэгдээгүй байна.
                  </p>
                ) : (
                  <table className="w-full border-collapse text-body">
                    <caption className="sr-only">Сүүлийн бүртгэлүүд</caption>
                    <thead className="bg-sunken">
                      <tr>
                        {["Огноо", "Ирц", "Тайлбар", "Багш", "ESIS"].map((label) => (
                          <th
                            key={label}
                            scope="col"
                            className="px-2 py-1.5 text-left text-caption font-semibold text-ink"
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map(([date, mark]) => (
                        <tr key={date} className="border-b border-border-soft last:border-0">
                          <td className="px-2 py-1.5 tabular-nums text-ink">{date}</td>
                          <td className="px-2 py-1.5">
                            <span
                              title={STATUS_TITLE[mark.status] ?? mark.status}
                              className={cn(
                                "inline-grid size-6 place-items-center rounded-control text-caption font-bold",
                                STATUS_CELL[mark.status] ?? "bg-sunken text-ink",
                              )}
                            >
                              {ATTENDANCE_STATUS_LETTER[mark.status] ?? "?"}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-ink">{mark.note || "—"}</td>
                          {/* Recorder and ESIS state per child are not in this response. */}
                          <td className="px-2 py-1.5 text-faint">—</td>
                          <td className="px-2 py-1.5 text-faint">—</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-border p-4">
          <Button variant="secondary" asChild>
            <Link href={`/groups/${row.group.id}/attendance?date=${recent[0]?.[0] ?? today}`}>
              <Pencil size={16} aria-hidden /> Ирц засах
            </Link>
          </Button>
          {/* No per-child ESIS send exists yet — shown, never faked. */}
          <Button disabled title="ESIS руу илгээх үйлдэл хараахан холбогдоогүй байна">
            <Send size={16} aria-hidden /> ESIS руу илгээх
          </Button>
        </div>
      </div>
    </div>
  );
}

const STATUS_TITLE: Record<string, string> = {
  PRESENT: "Ирсэн",
  HALF_DAY: "Хагас өдөр",
  SICK: "Өвчтэй",
  EXCUSED: "Чөлөөтэй",
  ABSENT: "Тасалсан",
  OTHER: "Бусад",
};

function Stat({
  label,
  value,
  share,
  tone = "text-ink",
}: {
  label: string;
  value: string;
  share?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 rounded-control border border-border px-2 py-1">
      <dt className="truncate text-caption text-muted">{label}</dt>
      <dd className={cn("text-body font-bold tabular-nums", tone)}>
        {value}
        {share ? <span className="ml-0.5 text-caption font-medium">({share})</span> : null}
      </dd>
    </div>
  );
}

/** The month's dates in a Monday-first grid, `null` for the leading blanks. */
function calendarCells(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lead = (first + 6) % 7;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: last }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`),
  ];
}

export function monthRange(month: string): { from: string; to: string } {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, m - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
