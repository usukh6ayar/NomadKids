import type { ReactNode } from "react";
import Image from "next/image";

/**
 * Real art for the two computed birth facts, since 2026-09-08 — the client's
 * own set, delivered in Google Drive. Was Unicode emoji, a deliberate
 * placeholder: "the client is supplying real illustrated icons later, and an
 * emoji costs no asset and marks the *slot* precisely". This is that swap.
 *
 * `monkey` has no drawing in the delivered set (11 of the 12 year animals
 * arrived) — `YEAR_ANIMAL_ICON.monkey` stays the emoji rather than leaving the
 * code unhandled, the same "wrong guess is worse than none" reasoning
 * `domain.ts`'s own note on `Child.sex` states; a missing tile would read as a
 * bug, not a gap.
 *
 * Shared between the year-animal/zodiac picker (`child-about-me.tsx`'s
 * `CyclePicker`) and the birth-facts card (`child-birthday.tsx`'s
 * `ChildBirthdayFacts`) so the two never show a different icon for the same
 * code. Both call `yearAnimalIcon`/`zodiacIcon` rather than reading the maps
 * directly, since a caller needs a size — `<Image>` has no `text-*` class to
 * inherit the way the old emoji span did.
 */
const YEAR_ANIMAL_SRC: Record<string, string> = {
  rat: "/icons/year-animal/rat.png",
  ox: "/icons/year-animal/ox.png",
  tiger: "/icons/year-animal/tiger.png",
  rabbit: "/icons/year-animal/rabbit.png",
  dragon: "/icons/year-animal/dragon.png",
  snake: "/icons/year-animal/snake.png",
  horse: "/icons/year-animal/horse.png",
  sheep: "/icons/year-animal/sheep.png",
  rooster: "/icons/year-animal/rooster.png",
  dog: "/icons/year-animal/dog.png",
  pig: "/icons/year-animal/pig.png",
};

const ZODIAC_SRC: Record<string, string> = {
  capricorn: "/icons/zodiac/capricorn.png",
  aquarius: "/icons/zodiac/aquarius.png",
  pisces: "/icons/zodiac/pisces.png",
  aries: "/icons/zodiac/aries.png",
  taurus: "/icons/zodiac/taurus.png",
  gemini: "/icons/zodiac/gemini.png",
  cancer: "/icons/zodiac/cancer.png",
  leo: "/icons/zodiac/leo.png",
  virgo: "/icons/zodiac/virgo.png",
  libra: "/icons/zodiac/libra.png",
  scorpio: "/icons/zodiac/scorpio.png",
  sagittarius: "/icons/zodiac/sagittarius.png",
};

/** `size` in CSS pixels — both callers render this at more than one size. */
export function yearAnimalIcon(code: string, size: number): ReactNode {
  const src = YEAR_ANIMAL_SRC[code];
  if (!src) return <span aria-hidden="true">🐵</span>;
  return <Image src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />;
}

export function zodiacIcon(code: string, size: number): ReactNode {
  const src = ZODIAC_SRC[code];
  if (!src) return <span aria-hidden="true">✨</span>;
  return <Image src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />;
}
