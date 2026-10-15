"use client";

import type { AccessPeriod } from "@kinder/contracts";
import { cn } from "@/lib/utils";

/**
 * «Улирлаар» / «Жилээр» — which period a family pays the access fee for
 * (#217). One control for the first payment (`AccessGate`) and the renewal
 * (`/children/:id/access`), 2026-10-15, the user: both ways, on both screens.
 *
 * ★ «Улирлаар» is offered only while the server sells a term (`termAmount`
 * set); without one the year is the only choice and the term is disabled.
 */
export function AccessPeriodPicker({
  value,
  onChange,
  termAvailable,
  className,
}: {
  value: AccessPeriod;
  onChange: (next: AccessPeriod) => void;
  termAvailable: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Төлбөрийн хугацаа"
      className={cn("grid w-full grid-cols-2 gap-1 rounded-pill bg-canvas p-1", className)}
    >
      {(
        [
          ["TERM", "Улирлаар"],
          ["YEAR", "Жилээр — хямд"],
        ] as const
      ).map(([option, label]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          disabled={option === "TERM" && !termAvailable}
          onClick={() => onChange(option)}
          className={cn(
            "min-h-11 rounded-pill px-3 text-body font-semibold transition-colors disabled:opacity-50",
            value === option ? "bg-primary text-white shadow-sm" : "text-muted",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
