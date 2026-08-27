import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_SURFACE, type Tone } from "@/components/ui/tone";

/**
 * The home screen's icon grid — the shape a phone user expects.
 *
 * ★ Two columns on a phone, not a list.
 *
 * A vertical list of links is what a website does; an app's home is a grid of
 * destinations you hit with a thumb. Two columns is what fits a 44px tap target
 * plus a Mongolian label that wraps to two lines without truncating — three
 * columns forces "Цэцэрлэгийн мэдээлэл" to ellipsis, and an ellipsis on a
 * navigation label is a destination you cannot read before you tap it.
 *
 * It widens to three and four columns from `sm` and `lg`, where the extra room
 * is real rather than borrowed from the label.
 */
export function TileGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4", className)}>
      {children}
    </div>
  );
}

/**
 * One destination in the grid.
 *
 * ★ `icon` is a slot, not an icon name.
 *
 * It takes whatever is passed — a lucide glyph today, an illustrated PNG or SVG
 * when the artwork arrives — so swapping the art is a change at the call site
 * and never in this file. The tile reserves a fixed square for it so a mixed
 * set of icons and illustrations still lines up across a row.
 */
export function NavTile({
  href,
  label,
  icon,
  note,
  tone = "sky",
  className,
}: {
  href: string;
  label: string;
  /** A lucide icon, an `<img>`, or anything else square. */
  icon: ReactNode;
  /** One short line under the label — a count, or what the screen is for. */
  note?: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        // `min-h` rather than a fixed height: a two-line Mongolian label must
        // grow the tile rather than overflow it.
        "flex min-h-[104px] flex-col gap-2.5 rounded-card border border-border bg-surface p-3.5",
        "transition-colors hover:border-primary/40 hover:bg-primary-soft/40",
        // A visible focus ring: this is the primary navigation on a phone and
        // it must be reachable by keyboard on a desktop.
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-12 shrink-0 place-items-center rounded-control [&>img]:size-full [&>img]:rounded-control [&>img]:object-cover",
          TONE_SURFACE[tone],
        )}
      >
        {icon}
      </span>

      <span className="flex flex-col gap-0.5">
        <span className="text-body font-semibold leading-heading text-ink">{label}</span>
        {note ? <span className="text-caption text-muted">{note}</span> : null}
      </span>
    </Link>
  );
}

/**
 * The tints a tile's icon well may take.
 *
 * A fixed set rather than a free colour: the grid reads as one system when the
 * wells come from the same palette, and an arbitrary hex at a call site is how
 * a screen ends up with nine unrelated colours.
 */
