/**
 * Placeholder art for the two computed birth facts — 2026-08-28, on the
 * client's instruction. Emoji rather than an image file: the client is
 * supplying real illustrated icons later, and an emoji costs no asset and
 * marks the *slot* precisely (one entry per `code` from `birth-facts.ts`),
 * ready to become `<Image src=.../>` the day a real set exists.
 *
 * Shared between the year-animal/zodiac picker (`child-about-me.tsx`'s
 * `CyclePicker`) and the birth-facts card (`child-birthday.tsx`'s
 * `ChildBirthdayFacts`) so the two never show a different icon for the same
 * code.
 */
export const YEAR_ANIMAL_ICON: Record<string, string> = {
  rat: "🐭",
  ox: "🐂",
  tiger: "🐯",
  rabbit: "🐰",
  dragon: "🐉",
  snake: "🐍",
  horse: "🐴",
  sheep: "🐑",
  monkey: "🐵",
  rooster: "🐔",
  dog: "🐶",
  pig: "🐷",
};

export const ZODIAC_ICON: Record<string, string> = {
  capricorn: "♑",
  aquarius: "♒",
  pisces: "♓",
  aries: "♈",
  taurus: "♉",
  gemini: "♊",
  cancer: "♋",
  leo: "♌",
  virgo: "♍",
  libra: "♎",
  scorpio: "♏",
  sagittarius: "♐",
};
