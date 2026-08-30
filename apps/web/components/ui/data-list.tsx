"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * An administrative list: a header strip of column names over a column of row
 * cards.
 *
 * ★ It exists because the admin screens were laying out rows with one flexible
 * column and nothing else.
 *
 * Every list under `/admin` was written as `[avatar] [name flex-1] [actions]`.
 * That is correct on a phone and wrong on a desktop: at the shell's 1200px the
 * name column is ~900px of empty space with a person's name pinned to its left
 * edge and two buttons pinned to its right, and the eye has to travel the whole
 * width to connect them. Nothing on the row is *wrong*; there is simply no
 * structure between the two edges, and a reader scanning thirteen of them has
 * no column to scan down.
 *
 * The fix is not a narrower list — a 700px list adrift in a 1200px shell only
 * moves the emptiness. It is to spend the width on information that was already
 * in the response and never rendered: the role a person holds, when they last
 * signed in, how many children a group has. A row with four columns earns its
 * width; a row with one does not.
 *
 * ★★ The widths live here, once, and both the header and every row read them
 * from context.
 *
 * A header whose columns are declared separately from the cells beneath it
 * drifts the first time somebody widens one of them, and the failure is
 * invisible in the source — you only see it on screen, slightly off, and only
 * if you look. Passing `columns` to `DataList` and keying cells by
 * `column.key` makes the two impossible to disagree.
 *
 * ★★★ The header is `md:` and up only.
 *
 * A phone has no room for a column strip, so each cell carries its own label
 * inline below `md` — the standard responsive-table trade, and the reason
 * `label` is required on every column rather than optional. A cell that cannot
 * name itself is unreadable on the screen this product is built for first.
 */

export interface DataColumn {
  /** Keys the cell in `DataRow`'s `cells` map. */
  key: string;
  /** The header, and the inline caption on a phone. Never optional. */
  label: string;
  /**
   * Width and alignment, as classes — `md:w-[200px]`, `md:text-right`.
   *
   * Applied to the header cell and to every row cell, so the column cannot be
   * one width in one place and another in the other.
   */
  className?: string;
}

/**
 * ★ The actions width travels with the columns, and it has to.
 *
 * The header reserves a fixed gutter for the actions; a row whose buttons come
 * out a different width then distributes the leftover space differently, and
 * every column above shifts a few pixels away from its own heading. The first
 * version of this had the row pushing its actions right with `ml-auto` while
 * the header used a fixed spacer — two different rules for the same gutter,
 * which is exactly the drift the shared `columns` list exists to prevent, one
 * column further right.
 */
const ColumnContext = createContext<{ columns: DataColumn[]; actionsWidth: string | null }>({
  columns: [],
  actionsWidth: null,
});

export function DataList({
  columns,
  /**
   * The width of the leading slot — an avatar or an `IconChip` — so the header
   * can reserve the same gutter the rows spend on it.
   *
   * `null` when the rows have no lead, which is most configuration lists.
   */
  leadWidth = "w-10",
  /** Reserves the actions gutter in the header. Match the buttons' real width. */
  actionsWidth = "w-[96px]",
  children,
  className,
}: {
  columns: DataColumn[];
  leadWidth?: string | null;
  actionsWidth?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ColumnContext.Provider value={{ columns, actionsWidth }}>
      <div className={cn("flex flex-col gap-2", className)}>
        {/*
          `aria-hidden`, and that is deliberate rather than an oversight.

          This strip is a visual guide for a sighted reader scanning a column.
          A screen reader gets the same information from each cell's own inline
          label, which is rendered in the row and only hidden from view at `md`
          — announcing both would read every column name twice per row.
        */}
        <div
          aria-hidden="true"
          className="hidden items-center gap-x-4 px-4 text-caption font-medium text-muted md:flex"
        >
          {leadWidth ? <span className={cn("shrink-0", leadWidth)} /> : null}
          <span className="min-w-0 flex-1">Нэр</span>
          {columns.map((column) => (
            <span key={column.key} className={cn("shrink-0", column.className)}>
              {column.label}
            </span>
          ))}
          {actionsWidth ? <span className={cn("shrink-0", actionsWidth)} /> : null}
        </div>

        {children}
      </div>
    </ColumnContext.Provider>
  );
}

/**
 * One row of a `DataList`.
 *
 * ★ `title` is the only required content, and the rest degrades in order.
 *
 * A configuration list has a name and one action; a user list has an avatar, a
 * name, a contact line, two columns and three actions. Both are this component
 * with different slots filled, rather than two row components that look alike
 * today.
 */
export function DataRow({
  lead,
  title,
  subtitle,
  cells,
  actions,
  /**
   * Whether the whole row is a link.
   *
   * Only then does it take a hover border — an affordance on a row that does
   * not respond to a click is a promise the row cannot keep.
   */
  interactive = false,
  className,
}: {
  lead?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Keyed by `DataColumn.key`. A missing key renders an em dash. */
  cells?: Record<string, ReactNode>;
  actions?: ReactNode;
  interactive?: boolean;
  className?: string;
}) {
  const { columns, actionsWidth } = useContext(ColumnContext);

  return (
    <div
      className={cn(
        "flex min-h-[64px] flex-wrap items-center gap-x-4 gap-y-2.5",
        "rounded-row border border-border bg-surface px-4 py-3",
        interactive && "transition-colors hover:border-primary",
        className,
      )}
    >
      {lead ? <span className="shrink-0">{lead}</span> : null}

      {/*
        ★ A wide basis on a phone, `flex-1` from `md` up.

        From `md` this is `flex: 1 1 0%` — exactly the header's rule, so the two
        absorb the leftover width identically and the columns land under their
        own labels. Below `md` a 200px basis is what pushes the first cell onto
        the next line: sharing the row, the name got whatever the badges left
        and every person in the list rendered as "Алтанзул Эц…". A name is the
        one thing on this row that must not be truncated on the screen this
        product is built for first.
      */}
      <span className="min-w-0 flex-1 basis-[200px] md:basis-0">
        <span className="block truncate text-lead font-semibold text-ink">{title}</span>
        {subtitle ? (
          <span className="mt-px block truncate text-compact text-muted">{subtitle}</span>
        ) : null}
      </span>

      {/*
        ★ On a phone a cell is `label: value` on one line, and cells flow.

        The first version gave each cell `basis-full`, so every column became
        its own full-width block with the label stacked above it. On the user
        list that turned a 64px row into three stacked pairs — "Эрх" over a
        badge, "Сүүлд нэвтэрсэн" over a date — and a thirteen-person list into
        a 3,500px scroll, which is longer than the dot-joined caption it
        replaced. The columns are what a desktop reader scans down; a phone
        reader is scanning *rows*, and needs them short.
      */}
      {columns.map((column) => (
        <span
          key={column.key}
          className={cn("flex min-w-0 items-center gap-1.5 md:block md:shrink-0", column.className)}
        >
          <span className="shrink-0 text-caption text-muted md:hidden">{column.label}</span>
          {cells?.[column.key] ?? <span className="text-body text-faint">—</span>}
        </span>
      ))}

      {actions ? (
        <span
          className={cn(
            // Its own line on a phone, right-aligned so the controls sit under
            // the edge of the card rather than under the name.
            "flex basis-full items-center justify-end gap-1 md:basis-auto md:shrink-0",
            /*
              ★ `flex-wrap`, because the gutter is a fixed width and the buttons
              inside it are not.

              `actionsWidth` reserves the same gutter in the header and on every
              row so the columns line up — that is the whole point of it — but a
              fixed-width box with `shrink-0` children and no wrapping does not
              clip an over-full row, it **spills**: the controls run past the
              edge of the card and over the column to their left, which is what
              /admin/groups did once it grew to seven of them (three register
              links, Багш, Засах, Архивлах and Устгах ≈ 520px inside a 352px
              box). It read as letters printed on top of each other.

              Wrapping keeps every control, keeps the columns aligned, and costs
              one extra line on the handful of rows that are genuinely that
              full. `items-center` is what keeps the two lines optically
              attached to the row rather than drifting to its top edge.
            */
            "flex-wrap",
            actionsWidth,
          )}
        >
          {actions}
        </span>
      ) : null}
    </div>
  );
}
