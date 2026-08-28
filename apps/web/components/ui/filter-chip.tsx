import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One pill of a "narrow this list" row.
 *
 * ★ Extracted 2026-08-28 because it had been written twice in one session.
 *
 * `/notifications` and `/surveys` each grew their own copy — same markup, same
 * 44px floor, same filled/outlined pair — as the client's redesign gave both
 * screens a chip row under their primary action. Two copies of a nine-line
 * component is how a third screen ends up with a slightly different one, which
 * is the failure `ui/tone.ts` and `ui/quick-tile.tsx` each document having
 * already had.
 *
 * ★★ `aria-pressed`, not `role="tab"`.
 *
 * These narrow one list in place. A tab switches between panels, and announcing
 * a filter as a tab tells a screen-reader user to expect the content to be
 * replaced rather than shortened. `/surveys` has both on screen at once — this
 * row of chips *and* an Идэвхтэй/Дууссан tablist — and the two must not sound
 * alike.
 *
 * ★★★ 44px, the tap floor `--size-tap` names and `responsive.test.tsx` asserts
 * for every pressable thing in the product.
 */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-[44px] shrink-0 whitespace-nowrap rounded-pill border px-4 text-body font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-ink"
          : "border-border bg-surface text-muted hover:border-primary hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The row those pills sit in.
 *
 * ★ Bleeds to the screen edge on a phone and wraps from `sm`.
 *
 * Six chips need about 900px. Below `sm` they scroll horizontally, and the
 * negative margin lets the scroller reach the edge of the viewport so a
 * half-visible chip reads as "there is more" rather than stopping short inside
 * the page padding, where it reads as the end of the row. Both call sites had
 * copied this pair of behaviours too.
 */
export function FilterChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
    >
      {children}
    </div>
  );
}
