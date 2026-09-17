"use client";

import type { ComponentProps } from "react";
import { Select } from "@/components/ui/field";
import { formatMonthLabel } from "@/lib/format";

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthIndex(value: string): number | null {
  if (!MONTH_KEY.test(value)) return null;
  const [year, month] = value.split("-").map(Number) as [number, number];
  return year * 12 + month - 1;
}

function monthKey(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * A locale-independent month control.
 *
 * Native `input[type="month"]` paints its own text in the browser/OS locale,
 * so an English device displays “September” inside an otherwise Mongolian UI.
 * This uses the product's styled Select and labels every option itself.
 */
export function MonthSelect({
  value,
  onValueChange,
  min,
  max,
  ...props
}: Omit<ComponentProps<typeof Select>, "children" | "defaultValue" | "onChange" | "value"> & {
  value: string;
  onValueChange: (value: string) => void;
  min?: string;
  max?: string;
}) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const selectedIndex = monthIndex(value);
  const requestedMin = monthIndex(min ?? "");
  const requestedMax = monthIndex(max ?? "");
  const start = Math.min(requestedMin ?? (currentYear - 10) * 12, selectedIndex ?? Infinity);
  const end = Math.max(requestedMax ?? (currentYear + 2) * 12 + 11, selectedIndex ?? -Infinity);
  const options = Array.from({ length: end - start + 1 }, (_, offset) => monthKey(end - offset));

  return (
    <Select {...props} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => (
        <option key={option} value={option}>
          {formatMonthLabel(option)}
        </option>
      ))}
    </Select>
  );
}
