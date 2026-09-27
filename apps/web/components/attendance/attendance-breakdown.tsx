"use client";

import { useQuery } from "@tanstack/react-query";
import { attendanceJournalSchema, type AttendanceJournalRow } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { ATTENDANCE_STATUS_LETTER } from "@/lib/attendance-meta";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

/** A group's roster fits in one request; the API caps a page at 200. */
const PAGE_SIZE = 200;

const WEEKDAY = ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"];

const STATUSES = [
  { key: "PRESENT", label: "Ирсэн", text: "text-mint-ink", chip: "bg-mint text-mint-ink" },
  {
    key: "SICK",
    label: "Өвчтэй",
    text: "text-cornflower-ink",
    chip: "bg-cornflower text-cornflower-ink",
  },
  { key: "EXCUSED", label: "Чөлөөтэй", text: "text-sun-ink", chip: "bg-sun text-sun-ink" },
  { key: "ABSENT", label: "Тасалсан", text: "text-danger", chip: "bg-danger-soft text-danger" },
] as const;

type StatusKey = (typeof STATUSES)[number]["key"];

/** A legacy half day is a day the child came, as on every other attendance screen. */
function bucket(status: string): StatusKey | null {
  if (status === "PRESENT" || status === "HALF_DAY") return "PRESENT";
  if (status === "SICK" || status === "EXCUSED" || status === "ABSENT") return status;
  return null;
}

/**
 * "Ирцийн задаргаа" — one group's month, a child per row and a working day per
 * column, client's drawing of 2026-09-27.
 *
 * ★ Read from `GET …/attendance/register`, the same response as the other
 * tabs. The day totals at the foot are counted from the rows, so the tab asks
 * for a group first: a page of the whole kindergarten would total only the
 * children on it. "Хамрагдах ёстой" — the days a child should have attended —
 * has nothing behind it in this response and reads "—".
 */
export function AttendanceBreakdown({
  from,
  to,
  groupId,
}: {
  from: string;
  to: string;
  groupId: string;
}) {
  const { primaryKindergartenId } = useSession();

  const register = useQuery({
    queryKey: qk.attendanceJournal(primaryKindergartenId ?? "", {
      from,
      to,
      groupId,
      page: 1,
      pageSize: PAGE_SIZE,
    }),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/attendance/register?from=${from}&to=${to}&groupId=${groupId}&page=1&pageSize=${PAGE_SIZE}`,
        attendanceJournalSchema,
      ),
    enabled: Boolean(primaryKindergartenId && groupId),
  });

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-body text-muted" aria-label="Тэмдэглэгээ">
        {STATUSES.map((status) => (
          <li key={status.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "grid size-6 place-items-center rounded-pill text-caption font-bold",
                status.chip,
              )}
            >
              {ATTENDANCE_STATUS_LETTER[status.key]}
            </span>
            {status.label}
          </li>
        ))}
      </ul>

      {!groupId ? (
        <EmptyState
          title="Бүлэг сонгоно уу"
          description="Ирцийн задаргааг харахын тулд дээрх жагсаалтаас бүлэг сонгоно уу."
        />
      ) : register.isError ? (
        <ErrorState description={errorMessage(register.error)} />
      ) : register.isPending ? (
        <LoadingState rows={6} />
      ) : register.data.items.length === 0 ? (
        <EmptyState
          title="Суралцагч олдсонгүй"
          description="Энэ бүлэгт сонгосон сард ирцийн бүртгэлтэй суралцагч алга. Өөр сар эсвэл бүлэг сонгож үзнэ үү."
        />
      ) : (
        <BreakdownTable days={register.data.days} rows={register.data.items} />
      )}
    </div>
  );
}

const CELL = "border-b border-border-soft px-1.5 py-1.5 text-center tabular-nums";
const EDGE = "border-l border-border";

function BreakdownTable({ days, rows }: { days: string[]; rows: AttendanceJournalRow[] }) {
  const perChild = rows.map((row) => {
    const counts: Record<StatusKey, number> = { PRESENT: 0, SICK: 0, EXCUSED: 0, ABSENT: 0 };
    row.days.forEach((cell) => {
      const key = cell ? bucket(cell.status) : null;
      if (key) counts[key] += 1;
    });
    return counts;
  });
  const perDay = days.map((_, index) => {
    const counts: Record<StatusKey, number> = { PRESENT: 0, SICK: 0, EXCUSED: 0, ABSENT: 0 };
    rows.forEach((row) => {
      const cell = row.days[index];
      const key = cell ? bucket(cell.status) : null;
      if (key) counts[key] += 1;
    });
    return counts;
  });
  const grand = (key: StatusKey) => perChild.reduce((sum, counts) => sum + counts[key], 0);

  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full border-collapse text-body">
        <caption className="sr-only">Ирцийн задаргаа</caption>
        <thead className="bg-sunken">
          <tr>
            <th scope="col" rowSpan={2} className="px-3 py-2 text-left font-semibold text-ink">
              №
            </th>
            <th scope="col" rowSpan={2} className="px-3 py-2 text-left font-semibold text-ink">
              Овог
            </th>
            <th scope="col" rowSpan={2} className="px-3 py-2 text-left font-semibold text-ink">
              Нэр
            </th>
            {days.map((day, index) => (
              <th
                key={day}
                scope="col"
                aria-label={day}
                className={cn(
                  "px-1.5 pt-2 text-center text-caption font-medium text-muted",
                  index === 0 && EDGE,
                )}
              >
                {WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]}
              </th>
            ))}
            <th
              scope="colgroup"
              colSpan={6}
              className={cn("px-3 pt-2 text-center font-semibold text-ink", EDGE)}
            >
              Нийт / Суралцагчаар /
            </th>
          </tr>
          <tr>
            {days.map((day, index) => (
              <th
                key={day}
                scope="col"
                className={cn(
                  "px-1.5 pb-2 text-center font-semibold text-ink",
                  index === 0 && EDGE,
                )}
              >
                {Number(day.slice(8))}
              </th>
            ))}
            <th
              scope="col"
              className={cn("px-2 pb-2 text-center text-caption font-semibold text-ink", EDGE)}
            >
              Нийт өдөр
            </th>
            <th scope="col" className="px-2 pb-2 text-center text-caption font-semibold text-ink">
              Хамраг. ёстой
            </th>
            {STATUSES.map((status) => (
              <th
                key={status.key}
                scope="col"
                className={cn("px-2 pb-2 text-center text-caption font-semibold", status.text)}
              >
                {status.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.childId}>
              <td className="border-b border-border-soft px-3 py-1.5 tabular-nums text-muted">
                {rowIndex + 1}
              </td>
              <td className="border-b border-border-soft px-3 py-1.5 whitespace-nowrap text-ink">
                {row.child.lastName ?? "—"}
              </td>
              <td className="border-b border-border-soft px-3 py-1.5 font-semibold whitespace-nowrap text-ink">
                {row.child.firstName}
              </td>
              {days.map((day, index) => {
                const cell = row.days[index];
                const key = cell ? bucket(cell.status) : null;
                const status = STATUSES.find((s) => s.key === key);
                return (
                  <td
                    key={day}
                    title={
                      cell
                        ? `${day} — ${status?.label ?? cell.status}${cell.note ? ` · ${cell.note}` : ""}`
                        : day
                    }
                    className={cn(
                      CELL,
                      "font-semibold",
                      index === 0 && EDGE,
                      status?.text ?? "text-faint",
                    )}
                  >
                    {cell ? (ATTENDANCE_STATUS_LETTER[cell.status] ?? "?") : "·"}
                  </td>
                );
              })}
              <td className={cn(CELL, EDGE, "text-ink")}>{days.length}</td>
              {/* Days the child should have attended — not in this response yet. */}
              <td className={cn(CELL, "text-faint")}>—</td>
              {STATUSES.map((status) => (
                <td key={status.key} className={cn(CELL, status.text)}>
                  {perChild[rowIndex]![status.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {STATUSES.map((status, statusIndex) => (
            <tr key={status.key}>
              {statusIndex === 0 ? (
                <th
                  scope="rowgroup"
                  rowSpan={STATUSES.length}
                  colSpan={2}
                  className="border-t border-border px-3 text-left font-semibold text-ink"
                >
                  Нийт / бүлгээр /
                </th>
              ) : null}
              <th
                scope="row"
                className={cn(
                  "px-3 py-1.5 text-left font-semibold",
                  status.text,
                  statusIndex === 0 && "border-t border-border",
                )}
              >
                {status.label}
              </th>
              {days.map((day, index) => {
                const count = perDay[index]![status.key];
                return (
                  <td
                    key={day}
                    className={cn(
                      "px-1.5 py-1.5 text-center tabular-nums",
                      count ? status.text : "text-faint",
                      index === 0 && EDGE,
                      statusIndex === 0 && "border-t border-border",
                    )}
                  >
                    {count}
                  </td>
                );
              })}
              <td
                colSpan={6}
                className={cn(
                  "px-3 py-1.5 text-center font-semibold tabular-nums",
                  status.text,
                  EDGE,
                  statusIndex === 0 && "border-t border-border",
                )}
              >
                {grand(status.key)}
              </td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}
