import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Real art for the two computed birth facts, replacing the emoji placeholder
 * this file held from 2026-08-28 to 2026-09-09 — the client's own illustrated
 * set, one drawing per `code` from `birth-facts.ts`. `virgo` has no supplied
 * drawing; `ZodiacIcon` falls back to "✨" for it and for any future code
 * that outruns the set, the same way the emoji version always did.
 *
 * Shared between the year-animal/zodiac picker (`child-about-me.tsx`'s
 * `CyclePicker`) and the birth-facts card (`child-birthday.tsx`'s
 * `ChildBirthdayFacts`) so the two never show a different icon for the same
 * code.
 */
const YEAR_ANIMAL_SRC: Record<string, string> = {
  rat: "/icons/icon-year-rat-3d.png",
  ox: "/icons/icon-year-ox-3d.png",
  tiger: "/icons/icon-year-tiger-3d.png",
  rabbit: "/icons/icon-year-rabbit-3d.png",
  dragon: "/icons/icon-year-dragon-3d.png",
  snake: "/icons/icon-year-snake-3d.png",
  horse: "/icons/icon-year-horse-3d.png",
  sheep: "/icons/icon-year-sheep-3d.png",
  monkey: "/icons/icon-year-monkey-3d.png",
  rooster: "/icons/icon-year-rooster-3d.png",
  dog: "/icons/icon-year-dog-3d.png",
  pig: "/icons/icon-year-pig-3d.png",
};

const ZODIAC_SRC: Record<string, string> = {
  capricorn: "/icons/icon-zodiac-capricorn-3d.png",
  aquarius: "/icons/icon-zodiac-aquarius-3d.png",
  pisces: "/icons/icon-zodiac-pisces-3d.png",
  aries: "/icons/icon-zodiac-aries-3d.png",
  taurus: "/icons/icon-zodiac-taurus-3d.png",
  gemini: "/icons/icon-zodiac-gemini-3d.png",
  cancer: "/icons/icon-zodiac-cancer-3d.png",
  leo: "/icons/icon-zodiac-leo-3d.png",
  // virgo: no drawing supplied — falls back to the "✨" glyph below.
  libra: "/icons/icon-zodiac-libra-3d.png",
  scorpio: "/icons/icon-zodiac-scorpio-3d.png",
  sagittarius: "/icons/icon-zodiac-sagittarius-3d.png",
};

function CodeIcon({
  src,
  fallback,
  size,
  className,
}: {
  src: string | undefined;
  fallback: string;
  size: number;
  className?: string;
}) {
  if (!src) {
    return (
      <span aria-hidden="true" className={cn("leading-none", className)} style={{ fontSize: size }}>
        {fallback}
      </span>
    );
  }
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

export function YearAnimalIcon({
  code,
  size = 20,
  className,
}: {
  code: string;
  size?: number;
  className?: string;
}) {
  return <CodeIcon src={YEAR_ANIMAL_SRC[code]} fallback="⭐" size={size} className={className} />;
}

export function ZodiacIcon({
  code,
  size = 20,
  className,
}: {
  code: string;
  size?: number;
  className?: string;
}) {
  return <CodeIcon src={ZODIAC_SRC[code]} fallback="✨" size={size} className={className} />;
}
