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
export function isWeekend(iso: string): boolean {
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

  /*
   * ★ The class's own totals, at the end of the tally rows — 2026-09-12, at the
   * client's request ("доор ангийн нийт ирсэн, нийт гэсэн тоон үзүүлэлтүүдийг
   * хойно нь бодож гарга").
   *
   * The foot already counted each day down a column and each child across a
   * row; the corner where the two meet was an empty `colSpan`. These are the
   * figures that belong in it — one number per status for the whole span, and
   * every mark in the grid under "нийт" — and they are summed from the same
   * `tally` the columns are drawn from, so a column and its total cannot
   * disagree.
   */
  const rangeTotals: Record<string, number> = {};
  let rangeRecorded = 0;
  for (const day of tally) {
    rangeRecorded += day.recorded;
    for (const [status, count] of Object.entries(day.counts)) {
      rangeTotals[status] = (rangeTotals[status] ?? 0) + count;
    }
  }

  /*
   * ★ A month is drawn tighter than a week — 2026-09-12, at the client's
   * instruction that the journal stop scrolling sideways ("хойшоо скролдож
   * явдаг биш дэлгэцэд бүхлээрээ харагддаг бай").
   *
   * The register was scaled up the same day, and the two asks are only in
   * conflict if one size has to serve both: six columns at 44px is the sheet a
   * teacher fills in, and thirty-one at that size is 1.4 metres of table. The
   * grid picks by how many columns it was given — the journal passes a month
   * and gets the compact chip, the register passes a week and keeps the large
   * one.
   */
  const dense = data.days.length > 10;

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
      {/*
        ★ No `min-w`, and every column as narrow as its content — 2026-09-10.

        It forced 560px, so a week never fitted a 390px phone and the teacher
        scrolled the sheet sideways to reach Friday. The journal's month still
        overflows and still scrolls, which is the case the wrapper is for.

        ★★ The whole register was scaled up on 2026-09-12, at the client's
        instruction ("зураг дээрх шиг том болгоод өг"): a 36px chip on a phone
        and 44px from `sm` up, with the name, the date heads and the tally
        strip raised a step each to match. A week is still six 40px columns
        beside a truncating name — 240px of days — so it goes on fitting a
        390px screen without sideways scrolling, which is the constraint this
        note existed to protect.
      */}
      <table className="w-full border-collapse text-body">
        <caption className="sr-only">Бүлгийн ирцийн бүртгэл — хүүхэд мөрөөр, өдөр баганаар</caption>
        <thead>
          <tr className="border-b border-border">
            {/*
              The row number is desktop-only: on a phone it costs a column and
              says nothing the name beside it does not.
            */}
            <th
              scope="col"
              className="hidden w-8 px-1 py-2.5 text-left text-caption font-medium text-muted sm:table-cell"
            >
              <span className="sr-only">Дугаар</span>
            </th>
            {/*
              ★ `w-full` on the name — 2026-09-10, at the client's request that
              the name and the week sit closer together.

              A table shares slack among its columns, so five 36px day columns
              in a 390px row left ~180px of nothing between the name and Monday.
              Giving the *name* the full-width claim makes it absorb all of it:
              the day columns close up to their own width and the register
              reads as one block instead of two halves either side of a gap.
            */}
            <th
              scope="col"
              className="w-full py-2.5 pe-1 ps-0.5 text-left text-caption font-medium text-muted sm:py-3 sm:pe-2 sm:ps-1 sm:text-body"
            >
              Хүүхэд
            </th>
            {data.days.map((day) => {
              const { weekday, day: number } = columnLabel(day);
              return (
                <th
                  key={day}
                  scope="col"
                  className={cn(
                    "px-0 text-center font-medium",
                    dense
                      ? "w-6 py-1.5 text-compact sm:w-7"
                      : "w-10 py-2.5 text-caption sm:w-12 sm:py-3 sm:text-body",
                    isWeekend(day)
                      ? "bg-canvas text-faint"
                      : cn(
                          "text-muted",
                          day === editableDay && "rounded-t-control bg-sky/40 text-sky-ink",
                        ),
                  )}
                >
                  <span className="block leading-tight">{weekday}</span>
                  <span
                    className={cn(
                      "block font-bold",
                      dense ? "text-compact" : "text-body sm:text-lead",
                      isWeekend(day) ? "text-faint" : "text-ink",
                    )}
                  >
                    {number}
                  </span>
                </th>
              );
            })}
            {showChildTotals
              ? [...TEACHER_ATTENDANCE_STATUSES, "TOTAL" as const].map((key, index) => (
                  <th
                    key={key}
                    scope="col"
                    className={cn(
                      "px-0 text-center font-semibold text-ink",
                      dense
                        ? "w-7 py-1.5 text-compact sm:w-8"
                        : "w-10 py-2.5 text-caption sm:w-12 sm:py-3 sm:text-body",
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
              <td className="hidden px-1 py-2 text-caption tabular-nums text-faint sm:table-cell">
                {index + 1}
              </td>
              {/*
                `truncate` with a width the column can give up: a register is a
                name against five date columns, and the dates are the part that
                must not shrink.
              */}
              <td
                className={cn(
                  "truncate pe-1 ps-0.5 font-semibold text-ink sm:pe-2 sm:ps-1",
                  dense ? "py-0.5 text-caption" : "py-1.5 text-body sm:py-2 sm:text-lead",
                )}
              >
                {shortName(row.child)}
              </td>
              {data.days.map((day) => (
                <td
                  key={day}
                  className={cn(
                    "px-0",
                    dense ? "py-0.5" : "py-1.5 sm:px-0.5 sm:py-2",
                    isWeekend(day) ? "bg-canvas" : day === editableDay && "bg-sky/25",
                  )}
                >
                  {/*
                    ★ A weekend is greyed and never offered a control —
                    2026-09-10, at the client's request. The kindergarten is
                    shut, so there is no attendance to give an account of, and
                    a markable Saturday is a cell somebody eventually fills in
                    by mistake. Grey rather than hidden: the column still has
                    to be there for the dates around it to line up.

                    ★★ A record that already exists on a weekend is still
                    drawn. Refusing to *create* one is the rule; hiding one
                    that is in the database would make this grid disagree with
                    the totals beside it and with the funding claim built on
                    the same rows.
                  */}
                  <StatusCell
                    childName={shortName(row.child)}
                    dense={dense}
                    day={day}
                    status={statusFor(row, day)}
                    editable={!isWeekend(day) && day === editableDay && !disabled}
                    muted={isWeekend(day)}
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
                          "px-0 text-center tabular-nums sm:px-0.5",
                          dense ? "py-0.5 text-compact" : "py-2.5 text-caption sm:text-body",
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

        <tfoot className="text-caption sm:text-body">
          {TEACHER_ATTENDANCE_STATUSES.map((status) => (
            <tr key={status}>
              <td className="hidden sm:table-cell" />
              <th
                scope="row"
                className="px-1 py-1 text-right text-caption font-normal text-muted sm:px-2 sm:py-1.5 sm:text-body"
              >
                {ATTENDANCE_STATUS_LABEL[status]}
              </th>
              {tally.map(({ day, counts }) => (
                <td
                  key={day}
                  className={cn(
                    "px-0 py-1 text-center tabular-nums sm:px-0.5 sm:py-1.5",
                    isWeekend(day)
                      ? "bg-canvas text-faint"
                      : cn("text-ink", day === editableDay && "bg-sky/25"),
                  )}
                >
                  {counts[status] ?? 0}
                </td>
              ))}
              {showChildTotals ? (
                <td
                  colSpan={TEACHER_ATTENDANCE_STATUSES.length + 1}
                  className="border-l border-border px-1 py-1 text-center font-semibold tabular-nums text-ink sm:px-2 sm:py-1.5"
                >
                  {rangeTotals[status] ?? 0}
                </td>
              ) : null}
            </tr>
          ))}
          <tr>
            <td className="hidden sm:table-cell" />
            <th
              scope="row"
              className="px-1 pb-1.5 pt-1 text-right text-caption font-bold text-ink sm:px-2 sm:text-body"
            >
              нийт
            </th>
            {tally.map(({ day, recorded }) => (
              <td
                key={day}
                className={cn(
                  "px-0 pb-1.5 pt-1 text-center text-body font-bold tabular-nums sm:px-0.5 sm:text-lead",
                  isWeekend(day)
                    ? "bg-canvas text-faint"
                    : cn("text-ink", day === editableDay && "rounded-b-control bg-sky/25"),
                )}
              >
                {recorded}
              </td>
            ))}
            {showChildTotals ? (
              <td
                colSpan={TEACHER_ATTENDANCE_STATUSES.length + 1}
                className="border-l border-border px-1 pb-1.5 pt-1 text-center text-body font-bold tabular-nums text-ink sm:px-2 sm:text-lead"
              >
                {rangeRecorded}
              </td>
            ) : null}
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
  muted = false,
  dense = false,
  onSet,
}: {
  childName: string;
  day: string;
  status: string | null;
  editable: boolean;
  /** A day the kindergarten is shut: no dashed outline inviting a mark. */
  muted?: boolean;
  /** A month's worth of columns: the chip that fits thirty-one of them. */
  dense?: boolean;
  onSet: (status: string) => void;
}) {
  const letter = status ? (ATTENDANCE_STATUS_LETTER[status] ?? "?") : "";
  const chip = cn(
    "grid place-items-center rounded-pill font-bold",
    dense ? "size-5 text-compact" : "size-9 text-body sm:size-11 sm:text-lead",
    status
      ? cellSurface(status)
      : muted
        ? "text-transparent"
        : "border border-dashed border-border text-transparent",
  );

  if (!editable) {
    return (
      <span className="flex justify-center">
        <span className={chip}>
          {letter}
          <span className="sr-only">
            {status ? ATTENDANCE_STATUS_LABEL[status] : muted ? "амралтын өдөр" : "тэмдэглээгүй"}
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
