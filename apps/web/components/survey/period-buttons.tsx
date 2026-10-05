"use client";

import { useState } from "react";
import { SURVEY_PERIOD_LABEL, surveyPeriodSchema, type SurveyPeriod } from "@kinder/contracts";
import { FilterButton } from "@/components/ui/filter-chip";
import { FormDialog } from "@/components/ui/form-dialog";
import { cn } from "@/lib/utils";

/**
 * Бүгд · Гарааны · Явцын · Үр дүнгийн үнэлгээ — client, 2026-09-18: "шинээр
 * судалгаа асуулга авах товчны доор ... 3 ангилах товч", then "эдгээрийн урд
 * бүх гэсэн хэсэг нэм".
 *
 * ★ One choice out of four, always one pressed. "Бүгд" is no wave chosen — the
 * hub as it is without a filter — so there is always a visible way back, and
 * pressing a pressed wave no longer toggles it off. Kept in the URL
 * (`?period=`) so the back arrow from a survey returns to the same list.
 */
const PERIOD_CHOICES: { value: SurveyPeriod | null; label: string }[] = [
  { value: null, label: "Бүгд" },
  ...surveyPeriodSchema.options.map((value) => ({ value, label: SURVEY_PERIOD_LABEL[value] })),
];

export function PeriodFilter({
  selected,
  onSelect,
}: {
  selected: SurveyPeriod | null;
  onSelect: (period: SurveyPeriod | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <FilterButton
        expanded={open}
        count={selected ? 1 : 0}
        controls="survey-period-filter"
        onClick={() => setOpen(true)}
        className="h-12 w-12 rounded-field"
      />

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Үнэлгээний төрөл"
        description="Харах судалгааны төрлөө сонгоно уу."
      >
        <div
          id="survey-period-filter"
          role="group"
          aria-label="Үнэлгээний төрлөөр ангилах"
          className="grid gap-2"
        >
          {PERIOD_CHOICES.map(({ value, label }) => {
            const active = selected === value;
            return (
              <button
                key={value ?? "ALL"}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onSelect(value);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-12 items-center rounded-control border px-4 text-start text-body font-semibold transition-colors",
                  active
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border-soft bg-surface text-ink hover:border-primary hover:bg-primary-soft/40",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </FormDialog>
    </>
  );
}
