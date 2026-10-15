"use client";

import { X } from "lucide-react";
import { Select } from "@/components/ui/field";

/*
 * The platform tables' shared parts — «Цэцэрлэгүүд», «Багш дангаар» and
 * «Байгууллагын хүсэлт» (2026-10-13/14, the user: minimal, Excel-like, with a
 * search and named filters).
 */

/*
 * ★ № and the name stay put while the rest scrolls sideways — 2026-10-13,
 * the user. `border-separate` (not `collapse`) so a sticky cell keeps its own
 * borders; the faint shadow marks the edge the columns slide under.
 */
export const FROZEN_NO = "sticky left-0 z-10 w-10 min-w-10";
export const FROZEN_NAME =
  "sticky left-10 z-10 min-w-[200px] shadow-[1px_0_0_0_var(--color-border)]";

export type FilterOption = { readonly value: string; readonly label: string };

export function labelOf(options: readonly FilterOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** A named filter — «Төрөл: [Бүгд ▾]» — ringed in blue once it narrows the list. */
export function FilterSelect({
  label,
  ariaLabel,
  value,
  onChange,
  options,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly FilterOption[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-caption text-muted">
      <span className="whitespace-nowrap">{label}:</span>
      <Select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-9 w-auto min-w-[120px] text-compact ${
          value ? "border-primary ring-2 ring-primary/20" : ""
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

export type Chip = { key: string; label: string; clear: () => void };

/** «Идэвхтэй шүүлтүүр: [Төрийн ×] … Бүгдийг цэвэрлэх» — nothing while none is set. */
export function FilterChips({ chips, onClearAll }: { chips: Chip[]; onClearAll: () => void }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-caption">
      <span className="text-muted">Идэвхтэй шүүлтүүр:</span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.clear}
          aria-label={`«${chip.label}» шүүлтүүрийг арилгах`}
          className="inline-flex min-h-7 items-center gap-1 rounded-pill border border-primary/30 bg-primary/5 px-2.5 font-semibold text-ink hover:bg-primary/10"
        >
          {chip.label}
          <X size={12} aria-hidden="true" />
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="min-h-7 px-1 font-semibold text-primary hover:underline"
      >
        Бүгдийг цэвэрлэх
      </button>
    </div>
  );
}

/** A column header that sorts: ▲ / ▼ when active, ↕ otherwise. */
export function SortHeader<K extends string>({
  label,
  column,
  sort,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  column: K;
  sort: { key: K; dir: 1 | -1 };
  onSort: (column: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === column;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      className={
        [align === "right" ? "text-right" : "", className ?? ""].join(" ").trim() || undefined
      }
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 font-semibold hover:text-ink ${active ? "text-ink" : ""}`}
      >
        {label}
        <span aria-hidden="true" className="text-faint">
          {active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
