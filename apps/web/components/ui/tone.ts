/**
 * The accent vocabulary, in one place.
 *
 * ★ This existed twice before this file did.
 *
 * `stat-card.tsx` held `ART_TONE` and `tile.tsx` held `TONE_CLASS`, character
 * for character identical, and `Card` could not be tinted at all. Two copies of
 * a six-entry map is how a seventh accent gets added to one of them.
 *
 * ★★ A tone is a **meaning**, not a colour. `globals.css` says the accents are
 * "used only to carry meaning", and the mapping below is that sentence made
 * checkable. A screen picking `mint` because it looks nice on that page is the
 * failure mode; picking it because the thing is *finished* is the intent.
 */
export const TONE_MEANING = {
  /** Information, general, neutral-positive. The default. */
  sky: "information",
  /** Positive, completed, healthy. */
  mint: "complete",
  /** Waiting, pending, upcoming. */
  sun: "waiting",
  /** Attention, caution. Not danger — `--color-danger` is its own thing. */
  peach: "attention",
  /** People, categories, secondary grouping. */
  cornflower: "category",
  /** Progress, analytics, secondary positive. */
  teal: "progress",
} as const;

export type Tone = keyof typeof TONE_MEANING;

export const TONES = Object.keys(TONE_MEANING) as Tone[];

/**
 * A filled accent surface: tinted background, paired ink.
 *
 * ★ The ink is always the tone's own `-ink` token, never `--color-muted`.
 *
 * Measured, not assumed: `--color-muted` is between **3.46:1 and 4.08:1** on
 * these six tints — under the 4.5:1 floor on every one of them. The paired inks
 * clear it everywhere (4.52 to 6.54). `tone.test.tsx` pins this, because the
 * mistake is invisible: grey text on a pale tint looks deliberate right up
 * until someone tries to read it in sunlight.
 */
export const TONE_SURFACE: Record<Tone, string> = {
  sky: "bg-sky text-sky-ink",
  mint: "bg-mint text-mint-ink",
  sun: "bg-sun text-sun-ink",
  peach: "bg-peach text-peach-ink",
  cornflower: "bg-cornflower text-cornflower-ink",
  teal: "bg-teal text-teal-ink",
};

/**
 * A tinted *card* surface — the wash, without claiming the text colour.
 *
 * ★ Deliberately different from `TONE_SURFACE`, and this is the distinction
 * that keeps a tinted card from becoming "a coloured rectangle".
 *
 * An icon chip is 40px of solid accent carrying one glyph, so it owns its ink.
 * A card is a whole region of content — headings, body, badges, controls — and
 * forcing every one of those to the tone's ink would repaint the interface
 * rather than label it. So a toned card takes the tint and the matching border
 * and leaves text at `--color-ink`, which measures **10.65:1 or better** on all
 * six. The accent identifies the card; the text stays the product's text.
 */
export const TONE_CARD: Record<Tone, string> = {
  sky: "bg-sky/40 border-sky",
  mint: "bg-mint/40 border-mint",
  sun: "bg-sun/40 border-sun",
  peach: "bg-peach/40 border-peach",
  cornflower: "bg-cornflower/50 border-cornflower",
  teal: "bg-teal/40 border-teal",
};

/**
 * The accent as a *chart* fill.
 *
 * Charts need the colour as a value rather than a class — an SVG `fill` or a
 * `conic-gradient` stop cannot be a Tailwind utility.
 *
 * ★ These point at `--color-*-chart`, not at `--color-*-ink` — 2026-09-09.
 *
 * The ink tokens are text on a tint and `responsive.test.tsx` holds them to
 * 4.5:1, which is why `mint-ink` is a bottle green and `sun-ink` is brown. An
 * arc, a bar and a line are graphics, so the floor is WCAG's 3:1 for a
 * non-text element and the colour can be far more luminous — which is what the
 * client asked for ("гэгээлэг өнгөтэй болго").
 *
 * Nothing else reads this map, so the two palettes stay independent: text keeps
 * its contrast, charts keep their light.
 */
export const TONE_VAR: Record<Tone, string> = {
  sky: "var(--color-sky-chart)",
  mint: "var(--color-mint-chart)",
  sun: "var(--color-sun-chart)",
  peach: "var(--color-peach-chart)",
  cornflower: "var(--color-cornflower-chart)",
  teal: "var(--color-teal-chart)",
};
