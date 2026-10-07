"use client";

import { Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Small — client, 2026-10-06: "үсэг жижиг болгоод зай бага эзлэх". 36px
 * against a form field's 48px, caption type, a tighter inset: it sits in a
 * page header beside a button, not in a form.
 */
const COMPACT = "h-9 gap-1 px-2.5 text-caption";

/**
 * A month as two small pickers — «2026» and «10-р сар» — instead of one
 * «2026 оны 10-р сар» list of a hundred and fifty rows. Client, 2026-10-06:
 * "сар он 2ыг салгаад илүү минимал болго".
 *
 * ★ The same `"YYYY-MM"` value `MonthSelect` takes and gives, so a screen
 * swaps one for the other without touching its state. Years run from ten
 * back to two ahead, as `MonthSelect`'s months do, and always include the
 * year of the value it is given.
 */
export function YearMonthSelect({
  value,
  onValueChange,
  max,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** The latest month that may be chosen, `"YYYY-MM"` — no later year or month is offered. */
  max?: string;
  className?: string;
}) {
  const now = new Date();
  const match = MONTH_KEY.exec(value);
  const year = match ? Number(match[1]) : now.getFullYear();
  const month = match ? Number(match[2]) : now.getMonth() + 1;

  const limit = max ? MONTH_KEY.exec(max) : null;
  const maxYear = limit ? Number(limit[1]) : null;
  const maxMonth = limit ? Number(limit[2]) : null;

  const first = Math.min(now.getFullYear() - 10, year);
  const last = Math.max(maxYear ?? now.getFullYear() + 2, year);
  /* In the latest allowed year, only the months up to the limit. */
  const lastMonth = maxYear !== null && year === maxYear ? Math.max(maxMonth!, month) : 12;
  const years = Array.from({ length: last - first + 1 }, (_, offset) => last - offset);

  const emit = (nextYear: number, nextMonth: number) => {
    // Moving into the latest year can make the chosen month too late.
    const clamped =
      maxYear !== null && nextYear === maxYear ? Math.min(nextMonth, maxMonth!) : nextMonth;
    onValueChange(`${nextYear}-${String(clamped).padStart(2, "0")}`);
  };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Select
        aria-label="Он"
        value={String(year)}
        onChange={(event) => emit(Number(event.target.value), month)}
        className={cn(COMPACT, "w-[76px]")}
      >
        {years.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Сар"
        value={String(month)}
        onChange={(event) => emit(year, Number(event.target.value))}
        className={cn(COMPACT, "w-[96px]")}
      >
        {Array.from({ length: lastMonth }, (_, index) => index + 1).map((option) => (
          <option key={option} value={option}>
            {option}-р сар
          </option>
        ))}
      </Select>
    </div>
  );
}
