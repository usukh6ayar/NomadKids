import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_SURFACE, type Tone } from "@/components/ui/tone";

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
 */

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
  label,
  className,
}: {
  icon: ReactNode;
  tone?: Tone;
  size?: keyof typeof SIZE;
  /**
   * An accessible name. Supply it only when the chip is the sole carrier of
   * meaning — beside a visible label, leave it off so the label is announced
   * once rather than twice.
   */
  label?: string;
  className?: string;
}) {
  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" })}
      className={cn(
        "grid shrink-0 place-items-center rounded-card",
        // An illustrated .webp fills the chip; a lucide glyph is sized by the
        // `[&>svg]` rule above. One slot, either kind of art.
        "[&>img]:size-full [&>img]:rounded-card [&>img]:object-contain",
        SIZE[size],
        TONE_SURFACE[tone],
        className,
      )}
    >
      {icon}
    </span>
  );
}
