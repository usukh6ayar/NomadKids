import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A surface.
 *
 * Border plus the reference's `--shadow`, which is two very soft layers rather
 * than elevation. The canvas is a warm off-white four steps from the card's
 * white, and at that contrast a border alone reads as flat — the shadow is what
 * makes a card look placed on the page instead of cut out of it.
 *
 * 18px, matching `--radius` in the reference. It was 16px here, which made
 * every card in the product 2px tighter than the design.
 */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-border bg-surface shadow-[0_1px_2px_rgba(37,35,42,.04),0_6px_16px_rgba(37,35,42,.045)]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * One row of a list, as its own card.
 *
 * ★ The reference's `.kidrow`: a list is a column of separate cards with an 8px
 * gap, not one card with dividers. The difference is visible on every list
 * screen — children, the review queue, notifications, the portfolio feed.
 *
 * `--radius-row` (14px) rather than the card's 18px, because a row is smaller
 * and the larger radius eats its corners. Hovering moves the border to the
 * brand colour, which is the reference's affordance for "this row is a link".
 */
export function RowCard({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-[14px] border border-border bg-surface px-4 py-3 transition-colors",
        className,
      )}
      {...props}
    />
  );
}

/** The column those rows sit in. 8px gap, per `.kidlist`. */
export function RowList({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2", className)} {...props} />;
}

/**
 * A section heading with an optional supporting line and action.
 *
 * ★ A page is a stack of labelled modules, not a run of cards.
 *
 * The heading is the anchor, the `lede` says what the module is for, and the
 * action is the one thing you would do with it. Giving a section all three
 * makes a screen scannable without reading it — which is the whole point of a
 * hierarchy, and what a wall of equally-weighted cards cannot do.
 *
 * `as` defaults to `h2`: the heading level is a document-structure decision the
 * calling screen makes, and getting it wrong makes a screen reader's outline
 * nonsense. It is a prop rather than a fixed tag for exactly that reason.
 */
export function SectionHeader({
  title,
  lede,
  action,
  as: Tag = "h2",
  className,
}: {
  title: string;
  lede?: string;
  action?: ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <div
      className={cn("mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2", className)}
    >
      <div className="min-w-0">
        <Tag className="text-[1.05rem] font-semibold leading-[1.35] text-ink">{title}</Tag>
        {lede ? <p className="mt-0.5 text-sm text-muted">{lede}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
