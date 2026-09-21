import Image from "next/image";
import Link from "next/link";
import { BarChart3, ChevronRight } from "lucide-react";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { cn } from "@/lib/utils";

type Age = (typeof PORTFOLIO_AGES)[number];

/**
 * Each age's own colour, and the drawn numeral that leads its card.
 *
 * ★★ REDESIGN 2026-09-12, to the client's own drawing: four tinted cards, the
 * numeral, "N нас" under it, and a round arrow at the foot.
 *
 * They were four identical white cards, every one labelled "Нас" — so the
 * drawing was the only thing telling them apart and the word under it said
 * nothing. The colour is the second way to tell them apart and the label is
 * now the age itself.
 *
 * ★ The tint follows the numeral, not the palette's own order. `icon-age-2`
 * is blue, 3 green, 4 yellow, 5 red — the artwork was drawn that way, and a
 * card whose wash disagreed with the number sitting on it would read as a
 * mistake. `sky · mint · sun · pink` are the four accents closest to them.
 *
 * ★★★ `tone.ts` would normally refuse this: a tone there is a meaning, and
 * `mint` means "complete". The same exception the survey hub records applies —
 * when four of one thing sit side by side, the accent is telling them apart
 * rather than reporting a state.
 */
const AGE_LOOK: Record<Age, { art: string; wash: string; wave: string; arrow: string }> = {
  2: {
    art: "/icons/icon-age-2-3d.png",
    wash: "from-sky/55 to-sky/10",
    wave: "bg-sky/70",
    arrow: "text-sky-ink",
  },
  3: {
    art: "/icons/icon-age-3-3d.png",
    wash: "from-mint/55 to-mint/10",
    wave: "bg-mint/70",
    arrow: "text-mint-ink",
  },
  4: {
    art: "/icons/icon-age-4-3d.png",
    wash: "from-sun/55 to-sun/10",
    wave: "bg-sun/70",
    arrow: "text-sun-ink",
  },
  5: {
    art: "/icons/icon-age-5-3d.png",
    wash: "from-pink/55 to-pink/10",
    wave: "bg-pink/70",
    arrow: "text-pink-ink",
  },
};

/** Comparison shortcut plus the four illustrated age-folder cards. */
export function AgeStepper({ childId }: { childId: string }) {
  return (
    <nav aria-label="Насны хуудсууд" className="flex flex-col gap-3">
      <Link
        href={`/children/${childId}/portfolio/growth/compare`}
        className="inline-flex min-h-8 self-start items-center gap-1.5 rounded-pill border border-border bg-surface px-3 text-caption font-semibold text-primary shadow-sm transition-colors hover:bg-primary-soft"
      >
        <BarChart3 size={14} aria-hidden="true" />
        2-5 насны мэдээлэл
      </Link>

      <ul className="grid grid-cols-2 gap-3 sm:gap-4">
        {PORTFOLIO_AGES.map((age) => {
          const look = AGE_LOOK[age];
          return (
            <li key={age}>
              <Link
                href={`/children/${childId}/portfolio/growth/age/${age}`}
                aria-label={`${age} нас`}
                className="group relative flex aspect-[9/10] flex-col items-center justify-center overflow-hidden rounded-card px-4 py-5 text-ink transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                {/*
                  The wash, top-lit — the drawing's cards are palest where the
                  numeral sits and hold their colour at the foot, which is what
                  keeps a 3D number legible on a tint of its own hue.
                */}
                <span
                  aria-hidden="true"
                  className={cn("absolute inset-0 bg-gradient-to-b", look.wash)}
                />

                {/*
                  ★ The wave, in the card's own colour at a heavier weight.

                  A tilted pill wider than the card, clipped by
                  `overflow-hidden` — so what shows is one soft diagonal edge,
                  which is the drawing's own wave. Not an `<svg>`: `tokens.test`
                  bans hand-written SVG outside the chart primitives, and not
                  four PNGs either — it has to recolour per age, and an image
                  would be four more files to keep in step with the palette.
                */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute -inset-x-10 -bottom-4 top-[54%] -rotate-6 rounded-pill",
                    look.wave,
                  )}
                />

                <Image
                  src={look.art}
                  alt=""
                  width={96}
                  height={96}
                  className="relative size-[4.5rem] object-contain transition-transform group-hover:scale-105 sm:size-24"
                />

                <span className="relative mt-1 text-lead font-bold text-ink sm:text-title">
                  {age} нас
                </span>

                {/*
                  A round white button rather than a bare chevron. The whole
                  card is the link — this is the drawing's own affordance, and
                  it is what makes the foot of the card read as pressable
                  against the wave behind it.
                */}
                <span
                  aria-hidden="true"
                  className="relative mt-3 grid size-9 place-items-center rounded-pill bg-surface shadow-sm transition-transform group-hover:translate-x-0.5"
                >
                  <ChevronRight className={cn("size-5", look.arrow)} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
