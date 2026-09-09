import type { ComponentProps, ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A real `<table>`, for the screens whose content is a grid of facts.
 *
 * ★ Extracted from `/admin/funding` on 2026-09-04, when the roster needed one.
 *
 * These three pieces were written there for the funding register and its own
 * note makes the case better than a general one could: card rows exist because
 * an admin row is one name and two actions, and a table exists because eleven
 * columns are compared **downwards** — "who has the most absences" is answered
 * by scanning a column, which a stack of cards makes impossible. The roster's
 * table is the same shape of question, so it is the same three components
 * rather than a second set that drifts a padding step away.
 *
 * ★★ The horizontal scroll lives on the wrapper, never on the page.
 *
 * A wide table inside `overflow-x-auto` scrolls itself; a wide table in the
 * page flow makes the whole body scroll sideways on a phone, which moves the
 * navigation out from under the reader's thumb.
 */
export function TableShell({
  children,
  caption,
  minWidth = "min-w-[860px]",
  className,
  tableClassName,
  stacked = false,
}: {
  children: ReactNode;
  /** Screen-reader only — what this table is of. */
  caption: string;
  /** Below this the wrapper scrolls rather than the columns squeezing. */
  minWidth?: string;
  /** Goes on the wrapping `Card`. */
  className?: string;
  /**
   * Goes on the `<table>` itself.
   *
   * ★ Separate from `className`, because the two are not interchangeable and
   * the difference is invisible in a diff. `className` lands on the Card;
   * `table-fixed` there does nothing at all, and a caller who wanted fixed
   * layout gets auto layout plus whatever `truncate` they put on the cells —
   * which does not ellipse, it pushes the table past its container and hands
   * the scroll back to `overflow-x-auto`. `esis-rows.tsx` was written that way
   * for exactly as long as it took to look.
   */
  tableClassName?: string;
  /**
   * Below `md`, lay the rows out as cards instead of a scrolling grid.
   *
   * ★ The rule lives in `globals.css` under `[data-ui-table="stacked"]`, not
   * here — see its note for why it is one definition rather than a string of
   * utilities per table. Every `Td` in a stacked table needs a `data-label`,
   * which is what the phone layout shows in place of the hidden column head.
   *
   * ★★ Pair it with `minWidth="min-w-0"`. A stacked table has nothing to
   * scroll on a phone, and a pixel floor left behind would put the horizontal
   * scrollbar back on the tablet widths where the table is still a table.
   */
  stacked?: boolean;
}) {
  return (
    <Card
      data-ui-table={stacked ? "stacked" : "true"}
      className={cn("overflow-hidden p-0", className)}
    >
      <div className="overflow-x-auto">
        <table className={cn("w-full border-collapse text-body", minWidth, tableClassName)}>
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </div>
    </Card>
  );
}

/**
 * A column heading.
 *
 * ★ It reads as a heading now, and did not before — 2026-09-04.
 *
 * It was `text-muted` on the card's own white, separated from the first row by
 * the same hairline that separates every other row. So the top row of a table
 * looked like a quieter data row, which is what the client hit on the
 * attendance journal: "дээд гарчиг шиг хэсэг ялгагдахгүй". The fix is the one
 * that grid took — a `bg-sunken` band, ink rather than muted, and a doubled
 * rule underneath — applied here so `/children`, `/attendance/daily` and
 * `/admin/funding` all get it rather than one of them drifting ahead.
 *
 * ★★ Still `text-caption`. The weight and the ground do the separating; making
 * the header *bigger* than the data it labels is how a table starts shouting.
 */
export function Th({ numeric, className, ...props }: ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-b-2 border-border bg-sunken px-3 py-2.5 text-caption font-semibold text-ink",
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ numeric, className, ...props }: ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-border px-3 py-2.5 align-middle",
        // `tabular-nums` on numeric cells so a column of figures lines up on
        // the decimal rather than wobbling with the glyph widths.
        numeric ? "text-right tabular-nums" : "text-left",
        className,
      )}
      {...props}
    />
  );
}
