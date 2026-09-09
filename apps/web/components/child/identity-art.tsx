import Image from "next/image";

/**
 * The drawn identity icons — the twelve year animals, the twelve зурхайн орд
 * and the eye colours — delivered by the client on 2026-09-09 as 1254×1254
 * transparent PNGs, the same set and the same convention as the feature
 * drawings in `components/ui/art.tsx`.
 *
 * ★ This replaces emoji, which were always a placeholder.
 *
 * `lib/zodiac-icons.ts` held `rat: "🐭"` and said so in its own first line: the
 * emoji marked the *slot* until real art existed, one entry per `code` from
 * `@kinder/contracts`'s `birth-facts.ts`. The art exists now, so the slot is
 * filled — but the emoji stay as the fallback rather than being deleted,
 * because the delivery is not complete (below) and a missing drawing must
 * degrade to a glyph, never to a broken image.
 *
 * ★★ Keyed by `code`, not by the Mongolian name.
 *
 * Both maps are indexed by the codes in `YEAR_ANIMALS` and `ZODIAC_SIGNS`, so a
 * guardian's stored override (`ChildProfile.yearAnimalCode` / `zodiacCode`,
 * which are validated against those same lists) can never resolve to a name
 * with no picture. Cancer's source file is named "мэлхий орд" against the
 * contract's "Хавч", which is exactly why the name is not the key — and the
 * Mongolian names moved once already, on 2026-09-09, when the client renamed
 * Онгон to Охин, Нумч to Нум and Дэнс to Жинлүүр.
 *
 * ★★★ One drawing is still missing, because one file is not what it claims.
 *
 * **Гахай (pig)** — `гахай.png` in the delivery is a second copy of the dog
 * drawing, not a pig. Different bytes, same picture. It falls back to 🐷 below.
 *
 * Охин (virgo) was missing for the same reason on 2026-09-09 and arrived later
 * the same day, which is what the fallback is for: the twelve tiles kept their
 * layout while eleven of them were drawn. Adding the last one is a file and a
 * line, as in `art.tsx`: drop `pig.png` into `public/icons/year-animals/` and
 * add the entry.
 */
const YEAR_ANIMAL_SOURCE: Record<string, string> = {
  rat: "/icons/year-animals/rat.png",
  ox: "/icons/year-animals/ox.png",
  tiger: "/icons/year-animals/tiger.png",
  rabbit: "/icons/year-animals/rabbit.png",
  dragon: "/icons/year-animals/dragon.png",
  snake: "/icons/year-animals/snake.png",
  horse: "/icons/year-animals/horse.png",
  sheep: "/icons/year-animals/sheep.png",
  monkey: "/icons/year-animals/monkey.png",
  rooster: "/icons/year-animals/rooster.png",
  dog: "/icons/year-animals/dog.png",
  // `pig` — not supplied; falls back to 🐷.
};

const ZODIAC_SOURCE: Record<string, string> = {
  capricorn: "/icons/zodiac-signs/capricorn.png",
  aquarius: "/icons/zodiac-signs/aquarius.png",
  pisces: "/icons/zodiac-signs/pisces.png",
  aries: "/icons/zodiac-signs/aries.png",
  taurus: "/icons/zodiac-signs/taurus.png",
  gemini: "/icons/zodiac-signs/gemini.png",
  cancer: "/icons/zodiac-signs/cancer.png",
  leo: "/icons/zodiac-signs/leo.png",
  virgo: "/icons/zodiac-signs/virgo.png",
  libra: "/icons/zodiac-signs/libra.png",
  scorpio: "/icons/zodiac-signs/scorpio.png",
  sagittarius: "/icons/zodiac-signs/sagittarius.png",
};

const YEAR_ANIMAL_EMOJI: Record<string, string> = {
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

const ZODIAC_EMOJI: Record<string, string> = {
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

/**
 * The four eye colours, with the drawing and the hex that colours the label.
 *
 * ★ The hex outlives the swatch it used to draw.
 *
 * This list was a colour-only placeholder — a circle of `hex` standing in for
 * "real art the client is supplying later", which is what arrived. The drawing
 * replaces the circle, but `hex` stays and keeps its second job: the label
 * renders in it, so "Бор" is written in brown. That was the client's literal
 * instruction and it is also why this is a fixed list rather than the free-text
 * field it replaced — a typed word has no colour to guess.
 *
 * Moved here from `child-about-me.tsx` so the picker and the view chip read the
 * same source as the two cycle pickers beside them.
 *
 * ★★ Хүрэн and Саарал were dropped on 2026-09-09, at the client's request.
 *
 * They were the two of the six that arrived with no drawing, so keeping them
 * would have left a picker where four tiles are illustrated and two are plain
 * circles. `ChildProfile.eyeColor` is free text, so a child saved with either
 * before today still renders — through `EyeColorArt`'s unknown-colour branch,
 * as a neutral swatch beside the word itself.
 */
export const EYE_COLOR_OPTIONS = [
  { label: "Хар", hex: "#2b2118", art: "/icons/eye-colors/black.png" },
  { label: "Бор", hex: "#6b3f1d", art: "/icons/eye-colors/brown.png" },
  { label: "Ногоон", hex: "#4a7c59", art: "/icons/eye-colors/green.png" },
  { label: "Цэнхэр", hex: "#4a7ba6", art: "/icons/eye-colors/blue.png" },
] as const;

export function eyeColorHex(label: string | null | undefined): string | undefined {
  return EYE_COLOR_OPTIONS.find((option) => option.label === label)?.hex;
}

/**
 * `alt=""` throughout, for the reason `art.tsx` gives at length: every one of
 * these sits beside the visible label it depicts, and a screen reader announcing
 * "picture of a mouse, Хулгана жил" reads the same fact twice.
 */
function Art({ src, size, className }: { src: string; size: number; className?: string }) {
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The emoji stand-in, sized to the pixel box the drawing would have taken so a
 * grid of tiles does not reflow around the one that has no picture yet.
 */
function Glyph({ children, size }: { children: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center leading-none"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.82) }}
    >
      {children}
    </span>
  );
}

export function YearAnimalArt({ code, size = 24 }: { code: string; size?: number }) {
  const src = YEAR_ANIMAL_SOURCE[code];
  if (src) return <Art src={src} size={size} className="shrink-0" />;
  return <Glyph size={size}>{YEAR_ANIMAL_EMOJI[code] ?? "⭐"}</Glyph>;
}

export function ZodiacArt({ code, size = 24 }: { code: string; size?: number }) {
  const src = ZODIAC_SOURCE[code];
  if (src) return <Art src={src} size={size} className="shrink-0" />;
  return <Glyph size={size}>{ZODIAC_EMOJI[code] ?? "✨"}</Glyph>;
}

/**
 * Keyed by the Mongolian label because that is what `ChildProfile.eyeColor`
 * stores — a free-text column that predates this fixed list, so a value from
 * before it (or from an import, or saved as Хүрэн or Саарал before those two
 * were dropped) still has to render something. It gets the neutral swatch.
 *
 * Being in the list and having a drawing are now the same condition, which is
 * why one `if` answers both: the two colours that had no art are the two that
 * were removed.
 */
export function EyeColorArt({ label, size = 24 }: { label: string; size?: number }) {
  const option = EYE_COLOR_OPTIONS.find((candidate) => candidate.label === label);
  if (option) return <Art src={option.art} size={size} className="shrink-0" />;
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-pill border border-border/60"
      style={{ width: size, height: size, backgroundColor: "var(--color-border)" }}
    />
  );
}
