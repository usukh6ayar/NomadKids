import { existsSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { YEAR_ANIMALS, ZODIAC_SIGNS } from "@kinder/contracts";
import {
  EYE_COLOR_OPTIONS,
  EyeColorArt,
  YearAnimalArt,
  ZodiacArt,
} from "@/components/child/identity-art";

/**
 * The drawn identity icons — the twelve year animals, the twelve орд and the
 * eye colours.
 *
 * ★ The property worth pinning is that a code never reaches a missing file.
 *
 * `components/ui/art.tsx` states the failure mode this guards: a key that
 * resolves to a 404 is worse than no key, because the call site looks correct
 * while the UI is broken, and nothing fails in CI. A registry keyed by codes
 * from `@kinder/contracts` has a second way in — a code with no entry — so both
 * are checked here against the real `public/` tree rather than against a second
 * hand-written list that could drift from the first.
 */
const PUBLIC_ROOT = join(__dirname, "..", "public");

/**
 * Either the drawing exists on disk, or the code fell back to its stand-in.
 *
 * `next/image` does not render the path it is given: it rewrites it into the
 * optimiser query it will fetch at runtime, so the file being asserted has to be
 * read back out of that `url` parameter before the filesystem can be asked
 * whether it is there.
 */
function assertResolves(container: HTMLElement) {
  const img = container.querySelector("img");
  if (img) {
    const rendered = img.getAttribute("src") ?? "";
    const query = new URLSearchParams(rendered.split("?")[1] ?? "");
    const src = query.get("url") ?? rendered;

    expect(src.startsWith("/icons/")).toBe(true);
    expect(existsSync(join(PUBLIC_ROOT, src))).toBe(true);
    expect(img).toHaveAttribute("alt", "");
    return "art" as const;
  }

  // The stand-in is an element either way — a glyph carries text, the eye-colour
  // swatch is an empty coloured span — so the assertion is that one was drawn.
  expect(container.firstElementChild).not.toBeNull();
  return "glyph" as const;
}

describe("the twelve year animals", () => {
  it.each(YEAR_ANIMALS.map((animal) => [animal.code, animal.name]))(
    "resolves %s (%s) to a drawing that exists, or to a glyph",
    (code) => {
      assertResolves(render(<YearAnimalArt code={code} />).container);
    },
  );

  /*
   * The delivery of 2026-09-09 supplied eleven drawings: `гахай.png` in it is a
   * second copy of the dog, not a pig. This asserts the shortfall so that the
   * day a pig arrives, this line is what tells whoever added it that they are
   * done.
   */
  it("has every animal drawn but Гахай", () => {
    const drawn = YEAR_ANIMALS.filter((animal) =>
      render(<YearAnimalArt code={animal.code} />).container.querySelector("img"),
    ).map((animal) => animal.code);

    expect(drawn).toHaveLength(11);
    expect(drawn).not.toContain("pig");
  });
});

describe("the twelve зурхайн орд", () => {
  it.each(ZODIAC_SIGNS.map((sign) => [sign.code, sign.name]))(
    "resolves %s (%s) to a drawing that exists, or to a glyph",
    (code) => {
      assertResolves(render(<ZodiacArt code={code} />).container);
    },
  );

  /** Охин (virgo) arrived last, on 2026-09-09 — the set is complete. */
  it("has every sign drawn", () => {
    const drawn = ZODIAC_SIGNS.filter((sign) =>
      render(<ZodiacArt code={sign.code} />).container.querySelector("img"),
    ).map((sign) => sign.code);

    expect(drawn).toHaveLength(12);
  });
});

describe("eye colours", () => {
  it.each(EYE_COLOR_OPTIONS.map((option) => [option.label, option.art]))(
    "resolves %s to a drawing that exists, or to its swatch",
    (label, art) => {
      const { container } = render(<EyeColorArt label={label} />);
      const kind = assertResolves(container);
      expect(kind === "art").toBe(Boolean(art));
    },
  );

  /**
   * `ChildProfile.eyeColor` is free text that predates this fixed list, so a
   * value from before it must still render something rather than nothing.
   */
  it("draws a neutral swatch for a colour that is not in the list", () => {
    const { container } = render(<EyeColorArt label="Алаг" />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.firstElementChild).not.toBeNull();
  });
});
