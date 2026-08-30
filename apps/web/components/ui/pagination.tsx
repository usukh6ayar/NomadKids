import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Paging controls for a list, and the count above it.
 *
 * ★ This markup existed twice before this file did, character for character.
 *
 * `/children` and `/admin/audit` each carried the same `<nav aria-label=
 * "Хуудаслалт">` with the same two buttons, the same `Math.max(1, p - 1)` and
 * the same disabled conditions. `/admin/users` was about to be the third, which
 * is the point at which a copy stops being a coincidence — the same argument
 * `tone.ts` and `icon-chip.tsx` make about their own duplications.
 *
 * The count line differed between the two ("Нийт 4 бичлэг" against a bare
 * "Нийт 4"), which is what a second copy always looks like a year later: not
 * wrong, just no longer the same.
 */

/**
 * "Нийт 12 хэрэглэгч", above the list.
 *
 * `aria-live="polite"` because it is the only thing that announces the size of
 * a filtered result — a screen reader user changing a filter gets no other
 * signal that the list under it changed.
 */
export function ResultCount({
  total,
  /** The thing being counted: "хэрэглэгч", "бичлэг", "хүүхэд". */
  noun,
  className,
}: {
  total: number;
  noun: string;
  className?: string;
}) {
  return (
    <p className={cn("text-body text-muted", className)} aria-live="polite">
      Нийт {total} {noun}
    </p>
  );
}

/**
 * Previous / position / next.
 *
 * ★ Renders nothing when there is only one page.
 *
 * A disabled pair of buttons under a list that fits on one page is two controls
 * that will never do anything, which is the same promise-nothing rule the
 * sidebar is held to in `app-shell.tsx`.
 */
export function Pagination({
  page,
  totalPages,
  onPage,
  className,
}: {
  page: number;
  totalPages: number;
  /** Receives the new page number, already clamped to 1…totalPages. */
  onPage: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="Хуудаслалт"
      className={cn("flex items-center justify-between gap-3", className)}
    >
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(Math.max(1, page - 1))}
      >
        Өмнөх
      </Button>

      <span className="text-body text-muted" aria-live="polite">
        {page} / {totalPages}
      </span>

      <Button
        variant="secondary"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPage(Math.min(totalPages, page + 1))}
      >
        Дараах
      </Button>
    </nav>
  );
}
