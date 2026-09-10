"use client";

import type { GroupAttendanceRange } from "@kinder/contracts";
import {
  ATTENDANCE_STATUS_CHART_TONE,
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUS_LETTER,
  TEACHER_ATTENDANCE_STATUSES,
} from "@/lib/attendance-meta";
import { TONE_SURFACE } from "@/components/ui/tone";
import { shortName } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Мя · Лх · Пү — the column head a register uses, which is the weekday
 * abbreviated to two letters and the day of the month under it.
 *
 * ★ Written out rather than taken from `Intl`. `toLocaleDateString("mn-MN", {
 * weekday: "short" })` is not stable across runtimes — Node without full ICU
 * answers in English — and a register whose columns say "Tue" in one
 * deployment is worse than a seven-entry array.
 */
const WEEKDAY_SHORT = ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"] as const;

/** Saturday and Sunday, which a kindergarten register greys rather than hides. */
function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function columnLabel(iso: string) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return { weekday: WEEKDAY_SHORT[date.getUTCDay()]!, day: date.getUTCDate() };
}

/**
 * The register's own cell colours.
 *
 * ★ `ATTENDANCE_STATUS_CHART_TONE` + `TONE_SURFACE`, not a fifth palette.
 *
 * The client named four: ирсэн green, чөлөөтэй blue, өвчтэй yellow, тасалсан
 * red. Those are `mint`, `sky`, `sun` and `peach` — the tone map already says
 * exactly that, and `TONE_SURFACE` pairs each tint with an ink whose contrast
 * `tone.test.tsx` pins. A hand-written set here would be a fifth copy of the
 * status palette and the first one nobody had measured.
 */
function cellSurface(status: string): string {
  return TONE_SURFACE[ATTENDANCE_STATUS_CHART_TONE[status] ?? "sky"];
}

/**
 * The group's register as a child per row and a day per column.
 *
 * ★ Only `editableDay` can be written. The client was explicit that a teacher
 * fills in today and reads the rest: the earlier columns are the account they
 * already gave of those mornings, and a grid where every cell is a control
 * invites correcting last Tuesday by accident on a phone. Corrections to a
 * past day still exist — they are `?date=` on this same screen, which is one
 * deliberate act rather than a mis-tap.
 *
 * ★★ An editable cell is a styled `<select>`, not a popover.
 *
 * §5 asks for mobile first, and on a phone a native select opens the OS picker
 * — one tap, no custom focus trap, no menu that scrolls off a 390px screen.
 * The visible chip is a `<span>` behind a transparent full-cell select, so the
 * control keeps its own keyboard behaviour and accessible name while the grid
 * keeps the client's coloured letters.
 */
export function AttendanceWeekGrid({
  data,
  editableDay,
  draft,
  onSet,
  disabled = false,
  showChildTotals = false,
}: {
  data: GroupAttendanceRange;
  /** The one ISO date whose column accepts input, or null for a read-only grid. */
  editableDay: string | null;
  /** Unsaved statuses for `editableDay`, keyed by child id. */
  draft: Record<string, string>;
  onSet: (childId: string, status: string) => void;
  disabled?: boolean;
  /**
   * Trailing columns counting each child's own month — Ирсэн · Өвчтэй ·
   * Чөлөөтэй · Тасалсан, then the days they carry a record at all.
   *
   * ★ Off by default, and on for the journal — 2026-09-10, at the client's
   * request. The register above is one morning's work and a per-child total
   * there would be a column about a month nobody is looking at; the journal
   * *is* the month, and "how often was this child ill" is the question it
   * exists to answer.
   */
  showChildTotals?: boolean;
}) {
  const statusFor = (row: GroupAttendanceRange["rows"][number], day: string) =>
    (day === editableDay ? draft[row.child.id] : undefined) ?? row.records[day]?.status ?? null;

  /*
   * The tally strip under the grid — one column per day, the four a teacher
   * assigns plus a total.
   *
   * ★ Counted from what is on screen, including the unsaved draft, for the
   * reason the day sheet's own summary already gives: a teacher marking a
   * child sick and watching "өвчтэй" not move learns to distrust both numbers.
   */
  const tally = data.days.map((day) => {
    const counts: Record<string, number> = {};
    let recorded = 0;
    for (const row of data.rows) {
      const status = statusFor(row, day);
      if (!status) continue;
      counts[status] = (counts[status] ?? 0) + 1;
      recorded += 1;
    }
    return { day, counts, recorded };
  });

  /** One child's month, counted across the span the grid is drawing. */
  const totalsFor = (row: GroupAttendanceRange["rows"][number]) => {
    const counts: Record<string, number> = {};
    let recorded = 0;
    for (const day of data.days) {
      const status = statusFor(row, day);
      if (!status) continue;
      counts[status] = (counts[status] ?? 0) + 1;
      recorded += 1;
    }
    return { counts, recorded };
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-body">
        <caption className="sr-only">Бүлгийн ирцийн бүртгэл — хүүхэд мөрөөр, өдөр баганаар</caption>
        <thead>
          <tr className="border-b border-border">
            <th
              scope="col"
              className="w-10 px-2 py-2.5 text-left text-caption font-medium text-muted"
            >
              <span className="sr-only">Дугаар</span>
            </th>
            <th scope="col" className="px-2 py-2.5 text-left text-caption font-medium text-muted">
              Хүүхэд
            </th>
            {data.days.map((day) => {
              const { weekday, day: number } = columnLabel(day);
              return (
                <th
                  key={day}
                  scope="col"
                  className={cn(
                    "w-12 px-1 py-2.5 text-center text-caption font-medium",
                    isWeekend(day) ? "text-faint" : "text-muted",
                    day === editableDay && "rounded-t-control bg-sky/40 text-sky-ink",
                  )}
                >
                  <span className="block leading-tight">{weekday}</span>
                  <span className="block font-semibold text-ink">{number}</span>
                </th>
              );
            })}
            {showChildTotals
              ? [...TEACHER_ATTENDANCE_STATUSES, "TOTAL" as const].map((key, index) => (
                  <th
                    key={key}
                    scope="col"
                    className={cn(
                      "w-12 px-1 py-2.5 text-center text-caption font-semibold text-ink",
                      index === 0 && "border-l border-border",
                    )}
                  >
                    {key === "TOTAL" ? "Нийт" : ATTENDANCE_STATUS_LETTER[key]}
                    <span className="sr-only">
                      {key === "TOTAL" ? " бүртгэсэн өдөр" : ` ${ATTENDANCE_STATUS_LABEL[key]}`}
                    </span>
                  </th>
                ))
              : null}
          </tr>
        </thead>

        <tbody>
          {data.rows.map((row, index) => (
            <tr key={row.enrollmentId} className="border-b border-border-soft">
              <td className="px-2 py-2 text-caption tabular-nums text-faint">{index + 1}</td>
              <td className="whitespace-nowrap px-2 py-2 font-medium text-ink">
                {shortName(row.child)}
              </td>
              {data.days.map((day) => (
                <td key={day} className={cn("px-1 py-2", day === editableDay && "bg-sky/25")}>
                  <StatusCell
                    childName={shortName(row.child)}
                    day={day}
                    status={statusFor(row, day)}
                    editable={day === editableDay && !disabled}
                    onSet={(status) => onSet(row.child.id, status)}
                  />
                </td>
              ))}
              {showChildTotals
                ? (() => {
                    const { counts, recorded } = totalsFor(row);
                    return [...TEACHER_ATTENDANCE_STATUSES, "TOTAL" as const].map((key, index) => (
                      <td
                        key={key}
                        className={cn(
                          "px-1 py-2 text-center text-caption tabular-nums",
                          index === 0 && "border-l border-border",
                          key === "TOTAL" ? "font-bold text-ink" : "text-muted",
                        )}
                      >
                        {key === "TOTAL" ? recorded : (counts[key] ?? 0)}
                      </td>
                    ));
                  })()
                : null}
            </tr>
          ))}
        </tbody>

        <tfoot className="text-caption">
          {TEACHER_ATTENDANCE_STATUSES.map((status) => (
            <tr key={status}>
              <td />
              <th scope="row" className="px-2 py-0.5 text-right font-normal text-muted">
                {ATTENDANCE_STATUS_LABEL[status]}
              </th>
              {tally.map(({ day, counts }) => (
                <td
                  key={day}
                  className={cn(
                    "px-1 py-0.5 text-center tabular-nums text-ink",
                    day === editableDay && "bg-sky/25",
                  )}
                >
                  {counts[status] ?? 0}
                </td>
              ))}
              {showChildTotals ? <td colSpan={TEACHER_ATTENDANCE_STATUSES.length + 1} /> : null}
            </tr>
          ))}
          <tr>
            <td />
            <th scope="row" className="px-2 pb-1 pt-0.5 text-right font-semibold text-ink">
              нийт
            </th>
            {tally.map(({ day, recorded }) => (
              <td
                key={day}
                className={cn(
                  "px-1 pb-1 pt-0.5 text-center font-bold tabular-nums text-ink",
                  day === editableDay && "rounded-b-control bg-sky/25",
                )}
              >
                {recorded}
              </td>
            ))}
            {showChildTotals ? <td colSpan={TEACHER_ATTENDANCE_STATUSES.length + 1} /> : null}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function StatusCell({
  childName,
  day,
  status,
  editable,
  onSet,
}: {
  childName: string;
  day: string;
  status: string | null;
  editable: boolean;
  onSet: (status: string) => void;
}) {
  const letter = status ? (ATTENDANCE_STATUS_LETTER[status] ?? "?") : "";
  const chip = cn(
    "grid size-8 place-items-center rounded-pill text-caption font-bold",
    status ? cellSurface(status) : "border border-dashed border-border text-transparent",
  );

  if (!editable) {
    return (
      <span className="flex justify-center">
        <span className={chip}>
          {letter}
          <span className="sr-only">
            {status ? ATTENDANCE_STATUS_LABEL[status] : "тэмдэглээгүй"}
          </span>
        </span>
      </span>
    );
  }

  return (
    <span className="relative flex justify-center">
      <span aria-hidden="true" className={chip}>
        {letter}
      </span>
      <select
        aria-label={`${childName} — ${day} ирц`}
        value={status ?? ""}
        onChange={(event) => onSet(event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="" disabled>
          Тэмдэглээгүй
        </option>
        {TEACHER_ATTENDANCE_STATUSES.map((value) => (
          <option key={value} value={value}>
            {ATTENDANCE_STATUS_LABEL[value]}
          </option>
        ))}
      </select>
    </span>
  );
}
