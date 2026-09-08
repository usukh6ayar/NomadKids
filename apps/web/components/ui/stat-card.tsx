import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TONE_SURFACE, type Tone } from "@/components/ui/tone";

/**
 * A statistic that is itself the content — RFP §12.1 and §12.2.
 *
 * ★ The figure is the largest thing on the card, and the label sits under it.
 *
 * "245" answers the question; "нийт хүүхэд" says which question. Putting the
 * caption first, at the same weight, makes a reader parse a sentence to find a
 * number they could have read at a glance from across a desk.
 *
 * ★★ `art` is a slot the layout reserves whether or not it is filled.
 *
 * An illustration is passed in — a lucide glyph now, a drawing when the artwork
 * arrives — and it is `aria-hidden` in every case: it repeats the label, and a
 * screen reader announcing "picture of two children, total children, 245" is
 * worse than the number alone. Cards with and without art still align in a row,
 * because the figure column is what sets the height.
 *
 * ★★★ `href` makes the whole card the link — 2026-09-04.
 *
 * A figure on a dashboard is a question half-answered: "245 children" is read
 * and then acted on, and the act is always "show me them". Linking the card
 * rather than adding a "Харах" button under it keeps the target the size of the
 * thing being pointed at, which is what a thumb needs.
 *
 * The accessible name is the card's own text — "Нийт хүүхэд 245 хүүхэд" — which
 * is a better link name than any label that could be invented for it, and the
 * art stays `aria-hidden` so it does not join in.
 *
 * ★★★★ The chevron is not decoration, and it is why hover is not enough.
 *
 * A border that lights on hover says "this is a link" only once the pointer is
 * already on it, which on a touch screen is never. That argument would apply to
 * any linked surface; what makes it decisive *here* is that these cards appear
 * in mixed rows — `admin-overview.tsx` has four that navigate and two that do
 * not, because no screen exists for stored files or report jobs. Without a mark
 * on the card itself, a reader learns which cards do something by tapping them.
 */
export function StatCard({
  label,
  value,
  unit,
  art,
  artSurface = true,
  href,
  tone = "sky",
  size = "normal",
  trend,
  footer,
  className,
}: {
  label: string;
  /** Pre-formatted: this component never decides how a number is written. */
  value: ReactNode;
  /** "хүүхэд", "%" — the words under the figure. */
  unit?: string;
  art?: ReactNode;
  /** False for owner-supplied transparent artwork that already carries its own surface. */
  artSurface?: boolean;
  /**
   * Where this figure is explained in full — `/children` for a child count.
   *
   * Omitted when no such screen exists. An unlinked card is the honest state,
   * not a gap to be filled with the nearest plausible route: the admin hub was
   * deleted for listing destinations the sidebar already named, and inventing a
   * target here would be the same mistake one card at a time.
   */
  href?: string;
  tone?: Tone;
  /** `wide` spans two columns and gives the art real room. */
  size?: "normal" | "wide";
  /**
   * A comparison against an earlier period — the drawing's "↑ 0 Өмнөх сараас".
   *
   * A slot rather than a number, because only the caller knows what the figure
   * is being compared against and whether the comparison is honest for that
   * statistic. `StatTrend` below renders the usual shape.
   */
  trend?: ReactNode;
  /** A progress bar or a sparkline, below the figure. */
  footer?: ReactNode;
  className?: string;
}) {
  const card = (
    <Card
      /*
        ★ `compact`, not `roomy` — 2026-09-09, at the client's request:
        "хэтэрхий том, хэрэггүй том зайнууд гаргасан … шахаж сайжруул".

        `roomy` is 24px of padding on a desktop, which is right for a card of
        prose and wrong for one holding a label and a number: the figure is
        `text-display` and states itself in two lines, so the padding was the
        largest thing on the card. `compact` is 16px, and the row of them
        shortens by about a fifth without any of the three parts moving.
      */
      pad="compact"
      className={cn(
        "flex items-start gap-3 overflow-hidden",
        size === "wide" && "sm:col-span-2",
        // `h-full` only when linked: the `<Link>` wrapper becomes the grid
        // item, so without it the card no longer stretches to the row's height
        // and a linked card sits shorter than the unlinked one beside it.
        href &&
          "h-full transition-colors group-hover:border-primary/40 group-hover:bg-primary-soft/40",
        className,
      )}
    >
      {/*
        ★ The art leads the card, rather than closing it.

        It sat on the right until the client's 2026-08-29 drawing, opposite the
        figure — which reads as decoration parked in the leftover space, and on
        a two-column phone grid it squeezed the number it was meant to
        illustrate. Leading, it is the thing the eye lands on first and the row
        of cards becomes scannable by shape before any of it is read.

        `size-11` and a tinted square, not a circle: `IconChip`'s `md` step and
        `--radius-card`, so this and every other chip in the product are the
        same object.
      */}
      {art ? (
        <span
          aria-hidden="true"
          className={cn(
            "grid shrink-0 place-items-center rounded-card [&>img]:size-full [&>img]:object-contain",
            size === "wide" ? "size-12" : "size-10",
            artSurface ? TONE_SURFACE[tone] : "bg-transparent",
          )}
          data-icon-surface={artSurface ? "tone" : "none"}
        >
          {art}
        </span>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-body text-muted">{label}</p>

        {/*
          `tabular-nums` so a figure that ticks upward does not shift the
          layout under it — the same reason every other count in this product
          uses it.
        */}
        <p
          className={cn(
            "font-semibold tabular-nums leading-heading text-ink",
            size === "wide" ? "text-figure" : "text-display",
          )}
        >
          {value}
        </p>

        {/*
          ★ Only when it says something the label does not — 2026-09-09.

          "Нийт хүүхэд" over "24" over "хүүхэд" spends a third line repeating
          the noun in the first, and four cards of that is a row a third taller
          than it needs to be ("дотор н агуулгыг ашигтайхан янзлах"). The
          callers that kept a unit are the ones where it adds a fact — a file
          size, "2 нийт · 1 амжилтгүй", "идэвхтэй" — rather than a category the
          label already gave.
        */}
        {unit ? <p className="text-caption text-muted">{unit}</p> : null}

        {/*
          ★ The trend sits under a rule, so it reads as a second statement
          rather than a third line of the first.

          "0" beside "10" with nothing between them is two numbers a reader has
          to disambiguate; a hairline says the one below is *about* the one
          above. Absent entirely when the caller has nothing honest to put
          there — an empty trend row implies a comparison that was made and
          came out flat.
        */}
        {trend ? (
          <div className="mt-2.5 border-t border-border-soft pt-2 text-caption">{trend}</div>
        ) : null}

        {footer ? <div className="mt-1">{footer}</div> : null}
      </div>

      {/*
        Aligned to the label rather than centred: the card's height is set by
        whatever the caller passed below the figure — a trend, a bar, neither —
        so a vertically centred chevron would sit at a different place on every
        card in the row.
      */}
      {href ? (
        <ChevronRight
          size={18}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-faint transition-colors group-hover:text-primary"
        />
      ) : null}
    </Card>
  );

  if (!href) return card;

  return (
    <Link
      href={href}
      // `block` and `h-full` so the anchor fills its grid cell and the card
      // inside it can stretch; `rounded-card` so the global `:focus-visible`
      // outline follows the corner it is drawn around rather than boxing it.
      className={cn("group block h-full rounded-card", size === "wide" && "sm:col-span-2")}
    >
      {card}
    </Link>
  );
}

/**
 * "↑ 2 өмнөх сараас" — a figure's change against an earlier one.
 *
 * ★ The arrow is not the only signal, and the word beside it is not decoration.
 *
 * Colour and a glyph both say "up"; the phrase beside them says *up from
 * what*, which is the part a reader cannot infer. `globals.css` records "no
 * critical meaning through colour alone" as an RFP §13 requirement, and a
 * green triangle on its own is exactly that.
 *
 * ★★ No change renders an em dash rather than an arrow beside a zero.
 *
 * An arrow pointing up next to "0" is a small contradiction the eye has to
 * resolve every time it lands there. A dash says "unchanged" in one glyph and
 * takes the colour off the card, which is right — nothing happened.
 *
 * ★★★ `mint` and `peach`, not green and red.
 *
 * Fewer children this month is not an error, and painting it in the danger
 * colour would tell a director something the number does not. `peach` is
 * `tone.ts`'s "attention", which is what a fall in enrolment deserves.
 */
export function StatTrend({
  current,
  previous,
  /** What the comparison is against — "өмнөх сараас". */
  since,
}: {
  current: number;
  previous: number;
  since: string;
}) {
  const delta = current - previous;

  if (delta === 0) {
    return (
      <p className="text-muted">
        <span aria-hidden="true">—</span> Өөрчлөлтгүй, {since}
      </p>
    );
  }

  const up = delta > 0;

  return (
    <p className={up ? "text-mint-ink" : "text-peach-ink"}>
      <span aria-hidden="true">{up ? "↑" : "↓"}</span>{" "}
      <span className="font-medium tabular-nums">
        {up ? "+" : "−"}
        {Math.abs(delta)}
      </span>{" "}
      <span className="text-muted">{since}</span>
    </p>
  );
}

/**
 * A thin bar under a figure — RFP §12.1's progress, and the mockup's 87%.
 *
 * Its own component because a bar with no accessible name is a decoration a
 * screen reader skips, and the percentage is the point.
 */
export function StatBar({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-pill bg-track"
    >
      <span className="block h-full rounded-pill bg-primary" style={{ width: `${clamped}%` }} />
    </div>
  );
}
