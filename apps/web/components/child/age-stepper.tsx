import Link from "next/link";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { AGE_TONE } from "@/lib/age-content";
import { TONE_VAR, type Tone } from "@/components/ui/tone";
import type { GradientTone } from "@/lib/gradient-tones";
import { cn } from "@/lib/utils";

/** `AGE_TONE` only ever holds these four — `Tone`'s closest match to each. */
const DOT_TONE: Record<GradientTone, Tone> = {
  green: "mint",
  blue: "sky",
  orange: "peach",
  purple: "cornflower",
  pink: "peach",
};

/**
 * The 5-stop age row — client reference screenshot, 2026-08-30 — atop both
 * new parent screens: each age's own page and "Хөгжлийн харьцуулалт".
 *
 * ★ A dot each, not a tab strip: this is a stepper between five *pages*, not
 * a `Tabs.Root` — `growth/page.tsx`'s own `TabsPrimitive` is a different
 * component reached only by staff (see that file's doc comment), and reusing
 * its markup here would suggest these five destinations swap in place the
 * way tab panels do, when each is a real, back-button-able route.
 *
 * `TONE_VAR`, not `GRADIENT_TONE_STYLE` — a dot is a single flat fill, not
 * the gradient tile `AboutMeSummaryCard`'s pills or `ChildGrowthAges`'s own
 * nav draw; the "-ink" step of the same tone keeps the colour vocabulary
 * matching without pulling in a `linear-gradient` for an 8px circle.
 *
 * ★★ `grid-cols-5`, not `flex justify-between` — the connecting line behind
 * the dots is one absolutely-positioned bar from the 10% to the 90% mark,
 * which is only exactly right when every stop owns an equal-width column.
 * `justify-between` sizes each item to its own label instead, so "Бүх нас"
 * (the widest) would have pulled the line off-centre from its own dot.
 */
export function AgeStepper({
  childId,
  current,
}: {
  childId: string;
  /** Which stop is active — an age, or the "Бүх нас" comparison page. */
  current: (typeof PORTFOLIO_AGES)[number] | "compare";
}) {
  const stops: { key: (typeof PORTFOLIO_AGES)[number] | "compare"; label: string; href: string }[] =
    [
      ...PORTFOLIO_AGES.map((age) => ({
        key: age,
        label: `${age} нас`,
        href: `/children/${childId}/portfolio/growth/age/${age}`,
      })),
      {
        key: "compare" as const,
        label: "Бүх нас",
        href: `/children/${childId}/portfolio/growth/compare`,
      },
    ];

  return (
    <nav aria-label="Насны хуудсууд" className="relative">
      {/* One bar behind every dot, not a segment per gap — five equal columns
          below put each dot's centre at 10/30/50/70/90%, so the line can be a
          single fixed span rather than five pieces that have to line up. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[10%] right-[10%] top-1.25 h-px bg-border"
      />

      <ol className="relative grid grid-cols-5">
        {stops.map((stop) => {
          const active = stop.key === current;
          const dotColor =
            stop.key === "compare" ? "var(--color-sun-ink)" : TONE_VAR[DOT_TONE[AGE_TONE[stop.key]]];

          return (
            <li key={stop.key} className="flex justify-center">
              <Link
                href={stop.href}
                aria-current={active ? "page" : undefined}
                className="flex flex-col items-center gap-1.5 rounded-control px-1 py-1 text-center"
              >
                {/* `ring-canvas` gives the line a gap to pass behind rather
                    than visibly touching the dot's edge. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2.5 rounded-pill ring-4 ring-canvas transition-transform",
                    active && "scale-150",
                  )}
                  style={{ backgroundColor: dotColor }}
                />
                <span
                  className={cn(
                    "text-caption font-medium whitespace-nowrap",
                    active ? "text-ink" : "text-muted",
                  )}
                >
                  {stop.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
