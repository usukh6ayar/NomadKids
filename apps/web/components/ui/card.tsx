import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_CARD, type Tone } from "@/components/ui/tone";

/**
 * A surface. White, a slate-200 hairline, and `shadow-sm`.
 *
 * ★ The shadow is Tailwind's own `shadow-sm`, not a hand-rolled pair of layers.
 *
 * It used to be a custom two-layer shadow inlined here — and inlined again in
 * `auth-shell.tsx`, which is how two surfaces in one product end up a few
 * percent apart. `shadow-sm` is a name both can spell, it is what the design
 * system specifies, and it is barely visible by design: the separation comes
 * from the border and the off-white canvas, with the shadow only lifting the
 * card off it.
 *
 * 18px, matching `--radius` in the reference. It was 16px here, which made
 * every card in the product 2px tighter than the design.
 *
 * ★★ `pad` exists because every call site was inventing its own.
 *
 * Across the product cards were padded `px-4 py-3`, `px-4 py-3.5`,
 * `px-4 py-4`, `px-4 py-4 sm:px-5`, `px-5 py-5` and `px-6 py-10`. Each value is
 * defensible alone; together they meant no two screens shared a rhythm and a
 * new screen had no default to inherit — so it copied whichever card was
 * nearest and the set grew again.
 *
 * Two named steps cover nineteen and four of those call sites respectively.
 *
 * `none` stays the default, and that is deliberate rather than lazy: ten cards
 * are list containers (`<Card className="divide-y divide-border">`) whose rows
 * carry their own padding. Defaulting to a value would have put a margin
 * inside every list in the product.
 *
 * The genuine one-offs — the empty state's `px-6 py-10`, the dialog's — keep
 * passing a `className`. A variant per exception is how a scale becomes a list.
 *
 * ★★★ Both steps are mobile-first: the smaller value is unprefixed and `md:`
 * raises it. On a 375px screen 20px of horizontal padding inside a card that
 * already sits 16px from the edge spends a fifth of the width on nothing, and
 * the content — a Mongolian compound that wraps at almost every width — is what
 * has to give. Desktop keeps the roomier value, where the space exists.
 */
const PADDING = {
  none: "",
  compact: "p-3 md:px-4 md:py-3.5",
  roomy: "p-4 md:px-5 md:py-5",
} as const;

export function Card({
  className,
  pad = "none",
  tone,
  ...props
}: ComponentProps<"div"> & {
  pad?: keyof typeof PADDING;
  /**
   * A semantic accent wash — `mint` for complete, `sun` for waiting, and so on.
   *
   * ★ Optional, and the default is deliberately no tone at all.
   *
   * An untinted card is the workhorse and stays exactly as it was: white,
   * hairline, `shadow-sm`. Tone is for the handful of surfaces whose *state* is
   * the thing a reader needs at a glance — a card that is tinted because the
   * page looked plain is the failure this prop invites and `TONE_MEANING`
   * exists to argue against.
   *
   * ★★ The tint replaces the background and the border; it does **not** claim
   * the text colour. See `TONE_CARD` for why the two differ.
   */
  tone?: Tone;
}) {
  return (
    <div
      className={cn(
        "rounded-card border shadow-sm",
        // Untinted stays byte-for-byte what it was.
        tone ? TONE_CARD[tone] : "border-border bg-surface",
        PADDING[pad],
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
        "rounded-row border border-border bg-surface px-4 py-3 transition-colors",
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
 *
 * ★ `id` lands on the heading, so a wrapping `<section aria-labelledby>` names
 * itself with the heading it already renders.
 *
 * It exists because the alternative failed silently and at scale. Fourteen
 * sections across seven files carried `aria-labelledby="…-heading"` pointing at
 * ids that were never rendered — this component had no way to emit one — and a
 * dangling `aria-labelledby` does not fall back to the content, it *erases* the
 * accessible name. Seventeen landmarks announced as unnamed regions, every one
 * of them looking correct in the markup.
 *
 * The other repair is `aria-label` on the section, which two dashboard
 * components already use and document. That duplicates the string: the day a
 * heading is reworded, the accessible name keeps the old wording and nothing
 * fails. Passing an id keeps one string doing both jobs.
 */
export function SectionHeader({
  title,
  lede,
  action,
  as: Tag = "h2",
  id,
  icon,
  className,
}: {
  title: string;
  lede?: string;
  action?: ReactNode;
  as?: "h1" | "h2" | "h3";
  /** Set it when a wrapping `<section>` points `aria-labelledby` at this heading. */
  id?: string;
  /**
   * A visual identity for the section — an `IconChip`, usually.
   *
   * ★ The same slot, with the same reservations, that `PageHeader` already
   * carries. A chip on *every* section is the flatness this is meant to fix
   * with more colour in it; it belongs on the handful of sections that are
   * features in their own right — today's menu, the class board — and nowhere
   * a heading and a lede already say enough.
   *
   * ★★ It is a slot rather than an icon name, so a lucide glyph today and an
   * illustrated `.webp` tomorrow occupy it without this signature changing.
   * `aria-hidden` is the caller's job, via `IconChip`'s own default: the
   * heading beside it is the accessible name and announcing both repeats it.
   */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-2.5 flex flex-wrap items-start justify-between gap-x-3 gap-y-2 md:mb-3",
        className,
      )}
    >
      {/*
        `items-center`, so a chip sits on the optical centre of a title and its
        lede rather than hanging off the first line. `min-w-0` on the text
        column is what lets a long Mongolian compound wrap instead of pushing
        the action off the row.
      */}
      <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
        {icon ? <span className="shrink-0">{icon}</span> : null}

        <div className="min-w-0">
          <Tag
            id={id}
            className="text-lead font-semibold leading-[1.3] text-ink md:text-title md:leading-[1.35]"
          >
            {title}
          </Tag>
          {lede ? <p className="mt-0.5 text-caption text-muted md:text-body">{lede}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
