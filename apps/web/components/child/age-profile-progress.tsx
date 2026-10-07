"use client";

import type { AgeProfile } from "@kinder/contracts";
import { Card } from "@/components/ui/card";
import { Art } from "@/components/ui/art";
import type { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { ageSectionCompletion } from "@/lib/age-development";

type Age = (typeof PORTFOLIO_AGES)[number];

export function ageProfileCompletion(profile: AgeProfile | undefined) {
  const { completed, total, percent } = ageSectionCompletion(profile);
  return { completed, total, percent };
}

export function AgeProfileProgress({
  age,
  childSex,
  profile,
}: {
  age: Age;
  childSex?: "MALE" | "FEMALE" | null;
  profile: AgeProfile | undefined;
}) {
  const completion = ageProfileCompletion(profile);
  const label = `${age} насны дурсамж ${completion.percent}% бөглөгдсөн`;
  const pointingArt = childSex === "FEMALE" ? "agePointingGirl" : "agePointingBoy";

  return (
    <Card className="overflow-hidden border-white bg-[linear-gradient(135deg,#ffffff_0%,#f3f9ff_100%)] p-0 shadow-sm">
      <section aria-labelledby="age-memory-progress-title">
        <h2 id="age-memory-progress-title" className="sr-only">
          {age} насны дурсамж
        </h2>
        <div className="relative grid min-h-[144px] grid-cols-[88px_minmax(0,1fr)_88px] items-center gap-3 overflow-hidden px-4 py-3 sm:min-h-[168px] sm:grid-cols-[112px_minmax(0,1fr)_132px] sm:gap-5 sm:px-6">
          <div
            role="progressbar"
            aria-valuenow={completion.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={label}
            className="grid size-[88px] shrink-0 place-items-center rounded-pill p-2 sm:size-28 sm:p-2.5"
            style={{
              background: `conic-gradient(#60a5fa ${completion.percent}%, #dbeafe ${completion.percent}% 100%)`,
            }}
          >
            <span className="grid size-full place-items-center rounded-pill bg-white text-heading font-bold tabular-nums text-ink shadow-inner sm:text-display">
              {completion.percent}%
            </span>
          </div>

          <div className="relative z-10 min-w-0">
            <strong className="block text-heading font-bold tabular-nums text-ink sm:text-display">
              {completion.completed} / {completion.total}
            </strong>
            <span className="mt-0.5 block text-caption font-semibold leading-snug text-ink sm:text-body">
              хэсэг бүртгэсэн
            </span>
          </div>

          <div
            aria-hidden="true"
            className="relative h-full min-h-[132px] w-full self-end sm:min-h-[156px]"
            data-testid="age-progress-character"
          >
            <Art
              name={pointingArt}
              size={220}
              className="absolute bottom-[-12px] right-[-16px] h-36 w-36 max-w-none object-contain object-bottom sm:bottom-[-16px] sm:right-[-18px] sm:h-48 sm:w-48"
            />
          </div>
        </div>
      </section>
    </Card>
  );
}
