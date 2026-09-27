import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_GLYPH, TONE_SURFACE, type Tone } from "@/components/ui/tone";
import { isArtwork } from "@/components/ui/art";

/**
 * A glyph on a tinted square — the product's one way of giving a thing a face.
 *
 * ★ Three components were already drawing this by hand.
 *
 * `StatCard`'s art slot, `NavTile`'s icon and the dashboard tiles each had
 * their own `grid place-items-center rounded-card` plus a private copy of the
 * six-entry tone map. They agreed today because one was copied from the next;
 * nothing made them keep agreeing.
 *
 * ★★ It takes an icon rather than *being* one.
 *
 * The chip owns the surface — size, radius, tint, centring — and the caller
 * owns what sits on it. That is what lets a lucide glyph today and an
 * illustrated `.webp` later occupy the same slot without the call site
 * changing shape, which is exactly how `/home`'s tiles already work.
 *
 * ★★★ `aria-hidden` by default, and that is the honest setting.
 *
 * A chip beside a label repeats the label; a screen reader announcing
 * "image, attendance, Attendance" is noise. The few places where the icon is
 * the *only* content — a bare icon button — pass a `label`, which switches it
 * to `img` with a name rather than leaving it silent.
 *
 * ★★★★ Transparent supplied artwork can opt out of the surface.
 *
 * The four owner-provided feature PNGs already carry their full 3D shape and
 * colour. `surface={false}` preserves the chip's sizing and accessibility
 * contract while keeping any second rounded colour block out from behind them.
 */

/**
 * The brand tint, alongside the six semantic accents.
 *
 * ★ It is deliberately *not* a member of `Tone`.
 *
 * `tone.ts` is explicit that a tone is a meaning — mint is "complete", sun is
 * "waiting" — and that "a screen picking `mint` because it looks nice on that
 * page is the failure mode". A row of navigation tiles has no meanings to
 * carry: the administration hub's seven destinations are not one complete, one
 * waiting and one needing attention. Tinting them from that palette would say
 * something false in a vocabulary the rest of the product reads as true.
 *
 * So navigation takes the brand instead, which asserts nothing beyond "this is
 * ours". `menu.tsx` had already reached the same conclusion and drew it by
 * hand (`bg-primary-soft text-primary`) — the fourth hand-rolled chip this
 * component exists to absorb.
 */
const BRAND = "bg-primary-soft text-primary";

/**
 * The brand tint as a glyph colour — the stroke alone, no tile.
 *
 * ★ Client, 2026-09-24: "арын өнгөнүүдийг арилгаад зөвхөн зураасан icon
 * үлдээ". A lucide glyph now takes this (or `TONE_GLYPH`); the illustrated 3D
 * icons keep the filled chip they were drawn for, which the same instruction
 * asked to leave alone.
 */
const BRAND_GLYPH = "text-primary";

const SIZE = {
  /** Inline, beside a row title. */
  sm: "size-8 [&>svg]:size-4",
  /** The default — sidebar entries, list rows, page-header identity. */
  md: "size-10 [&>svg]:size-5",
  /** Feature cards and tiles. */
  lg: "size-12 [&>svg]:size-6",
  /** A statistic's art, or an empty state. */
  xl: "size-16 [&>svg]:size-8",
} as const;

export function IconChip({
  icon,
  tone = "sky",
  size = "md",
  surface = true,
  label,
  className,
}: {
  icon: ReactNode;
  /** One of the six meanings, or `primary` for the brand — see `BRAND` above. */
  tone?: Tone | "primary";
  size?: keyof typeof SIZE;
  /** Set false for transparent supplied artwork that must not gain a second tile behind it. */
  surface?: boolean;
  /**
   * An accessible name. Supply it only when the chip is the sole carrier of
   * meaning — beside a visible label, leave it off so the label is announced
   * once rather than twice.
   */
  label?: string;
  className?: string;
}) {
  // A drawing keeps its tinted well; a glyph is now just the glyph.
  const artwork = isArtwork(icon);

  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" })}
      data-icon-surface={surface && artwork ? "tinted" : "none"}
      className={cn(
        "grid shrink-0 place-items-center rounded-card",
        // An illustrated .webp fills the chip; a lucide glyph is sized by the
        // `[&>svg]` rule above. One slot, either kind of art.
        "[&>img]:size-full [&>img]:rounded-card [&>img]:object-contain",
        SIZE[size],
        surface
          ? artwork
            ? tone === "primary"
              ? BRAND
              : TONE_SURFACE[tone]
            : tone === "primary"
              ? BRAND_GLYPH
              : TONE_GLYPH[tone]
          : "bg-transparent",
        className,
      )}
    >
      {icon}
    </span>
  );
}
