"use client";

import { SURVEY_PERIOD_LABEL, surveyPeriodSchema, type SurveyPeriod } from "@kinder/contracts";
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

export function PeriodButtons({
  selected,
  onSelect,
}: {
  selected: SurveyPeriod | null;
  onSelect: (period: SurveyPeriod | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Үнэлгээний төрлөөр ангилах"
      className="grid grid-cols-4 gap-1.5 sm:gap-2"
    >
      {PERIOD_CHOICES.map(({ value, label }) => {
        const active = selected === value;
        return (
          <button
            key={value ?? "ALL"}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(value)}
            className={cn(
              "min-h-11 rounded-control border px-1 py-1.5 text-center text-compact font-semibold leading-tight transition-colors sm:min-h-[48px] sm:px-1.5 sm:py-2 sm:text-body",
              active
                ? "border-transparent bg-primary/65 text-white shadow-sm"
                : "border-border-soft bg-surface text-ink shadow-sm hover:border-primary hover:text-primary",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
