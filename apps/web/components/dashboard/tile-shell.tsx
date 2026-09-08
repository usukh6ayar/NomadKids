import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
import type { Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";

/**
 * The shell every summary tile on the dashboard wears.
 *
 * ★ It exists because the screen had nine `SectionHeader` + `Card` pairs and
 * therefore no hierarchy at all.
 *
 * A heading above a card is the right shape for a *section* — a labelled module
 * you scroll to. It is the wrong shape for a statistic: it spends a 17px
 * semibold line and 12px of margin announcing "Эр эм харьцаа" above a card
 * whose whole content is two numbers. Four of those in a row read as four
 * sections of equal weight, which is exactly what a dashboard must not do.
 *
 * So the top row's tiles carry their label *inside*, in `text-body text-muted`,
 * next to a tinted icon — and the sections below keep their headings. That one
 * difference is what makes the panels read as more important than the tiles,
 * without any of them changing size.
 *
 * ★★ `h-full` and a `mt-auto` footer, so a row of these aligns.
 *
 * The tiles hold different amounts of content — a dial, two counts, three bars,
 * a short list. Left alone in a grid row they end at four different heights and
 * the row looks broken. The shell makes each one fill its cell and pins the
 * footer to the bottom, so the labels line up at the top and the actions line
 * up at the foot whatever sits between them.
 *
 * ★★★ It is not `components/ui/stat-card.tsx`.
 *
 * That one is shared with `admin/page.tsx` and shaped for a single figure with
 * an illustration beside it. These tiles carry a dial, a segmented bar and a
 * list, and widening the shared primitive to cover them would change a screen
 * this task is not touching. A dashboard-local shell costs one file.
 *
 * ★★★★ The chip is `IconChip` now, not a fourth hand-rolled copy of it.
 *
 * This file used to carry its own `grid size-9 place-items-center` plus a
 * private six-entry tone map, character for character the one in `tone.ts`.
 * `icon-chip.tsx`'s own docblock names these tiles as one of the three places
 * that had cloned it, and the clone is what kept the tiles from being able to
 * hold an illustrated `.webp`: the chip had no `[&>img]` sizing rule, so an
 * `<Image>` dropped into the slot rendered at whatever intrinsic size it
 * happened to have. The shared chip sizes either kind of art.
 */
export function TileShell({
  icon,
  iconSurface = true,
  tone = "sky",
  label,
  size = "compact",
  surface = false,
  children,
  footer,
  className,
}: {
  /** A lucide glyph, or an illustrated `.webp`. `IconChip` sizes both. */
  icon: ReactNode;
  /** False for transparent artwork that must not gain a tinted chip behind it. */
  iconSurface?: boolean;
  tone?: Tone;
  label: string;
  /**
   * `feature` is for a tile that owns a column rather than a quarter of a row —
   * a larger chip and a heavier label, so the card reads as the primary thing
   * on its band. Everything else stays `compact`.
   */
  size?: "compact" | "feature";
  /**
   * Tint the whole card, not only the chip.
   *
   * ★ Off by default, and deliberately used twice on the whole screen.
   *
   * `globals.css` says the accents "carry meaning", and `tone.ts` warns that a
   * card tinted because the page looked plain is the failure the prop invites.
   * What a wash *can* do is rank two cards that are otherwise the same shape:
   * today's register is the thing a teacher opens this screen for, and the
   * month's birthdays are the one section meant to feel like good news. A third
   * washed tile would flatten both back out.
   */
  surface?: boolean;
  children: ReactNode;
  /** Pinned to the bottom of the tile so a row of actions lines up. */
  footer?: ReactNode;
  className?: string;
}) {
  const feature = size === "feature";

  return (
    <Card
      pad="roomy"
      tone={surface ? tone : undefined}
      className={cn("flex h-full flex-col gap-3", className)}
    >
      <div className="flex items-center gap-2.5 md:gap-3">
        {/*
          A fixed square, so a row of tiles has its icons on one line whatever
          glyph each one chose. `IconChip` is `aria-hidden` unless given a name:
          the label beside it already says what the tile is.
        */}
        <IconChip icon={icon} tone={tone} size={feature ? "lg" : "md"} surface={iconSurface} />
        <p
          className={cn(
            "min-w-0 font-medium",
            feature ? "text-lead text-ink" : "text-body text-muted",
          )}
        >
          {label}
        </p>
      </div>

      <div className="flex flex-1 flex-col justify-center">{children}</div>

      {footer ? (
        <div
          className={cn(
            "mt-auto border-t pt-2.5",
            // A hairline the colour of the canvas disappears on a tinted card,
            // so a washed tile takes the stronger border. Both are tokens.
            surface ? "border-border" : "border-border-soft",
          )}
        >
          {footer}
        </div>
      ) : null}
    </Card>
  );
}
