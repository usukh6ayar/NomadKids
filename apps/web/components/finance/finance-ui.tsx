"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import type { ReactNode } from "react";
import { groupListItemSchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { MonthSelect } from "@/components/ui/month-select";
import { TONE_CARD, TONE_GLYPH, type Tone } from "@/components/ui/tone";

/*
  Pieces the «Санхүү» tabs share — 2026-10-02, when the tabs were brought in
  line with the client's reference (its content, not its look): a month and a
  group in every filter row, four tinted totals at the head of a tab, a print
  button beside Excel.
*/

/**
 * `"126900.50"` → `12690050` cents.
 *
 * ★ Summed as whole cents, never as floats: `decimal.js` is not a web
 * dependency, and adding `0.1` a few hundred times in JavaScript is how a
 * total ends a tugrik off the API's own figure.
 */
export function cents(value: string): number {
  const negative = value.trim().startsWith("-");
  const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  return negative ? -amount : amount;
}

/** Cents → `"126 900.50₮"`. */
export function money(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  const whole = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const fraction = absolute % 100;
  return `${sign}${whole}${fraction ? `.${String(fraction).padStart(2, "0")}` : ""}₮`;
}

/** A money string from the API, formatted without parsing it to a float. */
export function moneyText(value: string): string {
  return money(cents(value));
}

export function FigureCard({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-card border px-4 py-3", TONE_CARD[tone])}>
      <span className="text-caption font-medium uppercase tracking-wide text-muted">{label}</span>
      <span className={cn("text-title font-semibold tabular-nums", TONE_GLYPH[tone])}>{value}</span>
    </div>
  );
}

export function FigureRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/** The filter row every tab opens with. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-card bg-canvas p-3">{children}</div>
  );
}

export function MonthField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Сар" labelHidden>
      {({ id }) => (
        <MonthSelect id={id} value={value} onValueChange={onChange} className="w-[170px]" />
      )}
    </Field>
  );
}

const groupsSchema = paginated(groupListItemSchema);

/** The kindergarten's groups — the same read every finance tab shares. */
export function useGroups(enabled = true) {
  return useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled,
  });
}

export function GroupField({
  value,
  onChange,
  allLabel = "Бүх бүлэг",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Omitted ("") when a group must be chosen, as for Маягт 2. */
  allLabel?: string;
}) {
  const groups = useGroups();
  return (
    <Field label="Бүлэг" labelHidden>
      {({ id }) => (
        <Select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-[200px]"
        >
          <option value="">{allLabel}</option>
          {(groups.data?.items ?? []).map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function PrintButton() {
  return (
    <Button size="sm" variant="secondary" onClick={() => window.print()}>
      <Printer size={16} aria-hidden="true" />
      Хэвлэх
    </Button>
  );
}
