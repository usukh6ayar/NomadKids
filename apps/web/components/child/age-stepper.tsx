import Link from "next/link";
import { Baby, BarChart3, GraduationCap, Palette, Puzzle, type LucideIcon } from "lucide-react";
import { AGE_TONE } from "@/lib/age-content";
import { GRADIENT_TONE_STYLE } from "@/lib/gradient-tones";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { cn } from "@/lib/utils";

/** Comparison shortcut plus the four colourful age-folder cards. */
export function AgeStepper({ childId }: { childId: string }) {
  const ageIcons: Record<(typeof PORTFOLIO_AGES)[number], LucideIcon> = {
    2: Baby,
    3: Puzzle,
    4: Palette,
    5: GraduationCap,
  };

  return (
    <nav aria-label="Насны хуудсууд" className="flex flex-col gap-2">
      <Link
        href={`/children/${childId}/portfolio/growth/compare`}
        className="inline-flex min-h-8 self-start items-center gap-1.5 rounded-pill border border-border bg-surface px-3 text-caption font-semibold text-primary shadow-sm transition-colors hover:bg-primary-soft"
      >
        <BarChart3 size={14} aria-hidden="true" />
        2-5 насны мэдээлэл
      </Link>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PORTFOLIO_AGES.map((age) => {
          const tone = GRADIENT_TONE_STYLE[AGE_TONE[age]];
          const Icon = ageIcons[age];

          return (
            <li key={age}>
              <Link
                href={`/children/${childId}/portfolio/growth/age/${age}`}
                className={cn(
                  "group flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-card border border-white/30 px-2 py-3 text-body font-bold text-white shadow-md transition-transform hover:-translate-y-0.5 md:min-h-28",
                  tone.gradient,
                )}
              >
                <span className="grid size-10 place-items-center rounded-pill bg-white/20 transition-transform group-hover:scale-105">
                  <Icon size={21} aria-hidden="true" />
                </span>
                {age} нас
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
