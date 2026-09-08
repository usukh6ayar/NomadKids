import Link from "next/link";
import { Art, type ArtName } from "@/components/ui/art";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The phone-app launcher tile — an illustrated icon, a label, nothing else.
 *
 * ★ Lifted out of `(app)/home/page.tsx`, not re-drawn.
 *
 * The parent's home already had this exact tile, and the staff dashboard was
 * asked for "the same design as the parents'". Copying the markup would have
 * given the product two launcher grids that agree today because one was pasted
 * from the other and nothing keeps them agreeing — the same failure
 * `(app)/layout.tsx`'s `ROUTE_ICON` map exists to make unrepresentable for
 * navigation glyphs. One component, two call sites.
 *
 * ★★★ The staff dashboard has since drawn its own tile against `Art`
 * directly, so the parent's home is the only caller left. The component stays
 * shared rather than being inlined there: the argument above is about the
 * *next* screen asked for "the same design as the parents'", and inlining it
 * is what makes that screen a copy again.
 *
 * ★★ This is deliberately *not* `NavTile` (`tile.tsx`). That one is a wide
 * card — icon well, label, and a note line under it — which is a list entry
 * that happens to be laid out in a grid. This is a square you hit with a
 * thumb: centred, two lines at most, and no room for a subtitle. Both shapes
 * are legitimate; what is not legitimate is one of them pretending to be the
 * other with enough props to switch between them.
 */

/**
 * The grid the tiles sit in.
 *
 * Three columns on a phone, which is what the client's own mock-up draws and
 * what a 375px screen fits at a 44px tap target. A caller may widen it from a
 * breakpoint up — the staff dashboard does, since its six tiles are one row on
 * a laptop — but the phone column count is not a parameter.
 */
export function QuickTileGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("grid grid-cols-3 gap-2.5", className)}>{children}</div>;
}

/**
 * One tile of the grid — icon, label, nothing else.
 *
 * ★ `size-11` icon over `text-compact`, centred and two lines deep at most.
 * Three columns at 375px leaves each tile roughly 110px wide, which fits a
 * compound Mongolian label ("Хоол ба цэс" shortened to "Хоол" here) only if
 * it can wrap — `leading-tight` and no `truncate` let it, rather than
 * clipping the one thing the tile exists to say.
 *
 * `badge` mirrors `UnreadDot` (`app-shell.tsx`) at a smaller scale: a red
 * pill with the count, not a bare dot, for the same reason — a screen reader
 * gets "3", not "something changed".
 */
export function QuickTile({
  href,
  label,
  icon,
  badge,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      aria-label={badge ? `${label}, ${badge} шинэ` : label}
      className="flex flex-col items-center gap-2 rounded-card border border-border bg-surface px-2 py-4 text-center transition-colors hover:border-primary hover:shadow-sm"
    >
      <span className="relative" aria-hidden="true">
        {icon}
        {badge ? (
          <span className="absolute -right-1.5 -top-1.5 flex min-w-[18px] items-center justify-center rounded-pill bg-danger px-1 text-caption font-bold leading-[18px] text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </span>
      <span className="text-compact font-semibold leading-tight text-ink">{label}</span>
    </Link>
  );
}

/**
 * One of `public/icons/`'s illustrated PNGs, at the tile's own size.
 *
 * ★ The `icon` prop stays a slot — a caller may still pass a lucide glyph —
 * but every tile shipped so far passes one of that set, and each was spelling
 * the same `width`/`height`/`className` triple inline. Twelve copies of three
 * numbers is how one tile ends up 4px larger than its neighbours.
 *
 * `alt=""`: the label beside it says the same word, and `QuickTile` already
 * carries the accessible name on the link itself.
 *
 * ★★ It takes a name from `Art`, not a path.
 *
 * The note above and `art.tsx`'s are the same argument reached from two
 * directions — this one about the `width`/`height`/`className` triple, that one
 * about the `/icons/icon-*.png` string. Both are per-call-site decisions that
 * cannot be checked, and a path is the one that fails silently: a renamed file
 * renders a broken image and nothing tells CI. Delegating means the tile owns
 * its size and the registry owns what the drawings are called, rather than each
 * call site owning half of each.
 */
export function TileIcon({ name }: { name: ArtName }) {
  return <Art name={name} size={44} className="size-11" />;
}
