import type { ReactNode } from "react";
import { BarChart3, CalendarCheck, Cake, ClipboardList, Newspaper, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One card of Ангийн самбар: a title, an optional figure at the right, content.
 *
 * ★ Deliberately **not** `TileShell`, and the difference is the whole visual
 * change the client asked for on 2026-08-28.
 *
 * `TileShell` opens every card with a 40–48px `IconChip` — a tinted square
 * carrying either a lucide glyph or one of `public/icons/`' illustrations — and
 * two of its call sites also wash the whole card in an accent. That vocabulary
 * is right for the launcher grid and for `/home`, where a tile is a thing you
 * press and the drawing is how you find it. It is wrong here: the client's
 * dashboard is six white cards with plain dark titles, and the only colour on
 * the screen is in the data — a green ring, blue bars, blue numerals. Six
 * tinted chips would be six competing accents above six charts.
 *
 * So this is a header rule rather than a component with opinions: title left,
 * figure right, hairline nowhere. `TileShell` stays exactly as it is for the
 * screens that use it.
 *
 * ★★ The heading level is the caller's, defaulting to `h2`.
 *
 * These cards sit directly under the page's `<h1>`, so `h2` is right for all
 * six today — but a screen reader's outline is a document-structure decision
 * and hard-coding it here is how a card nested inside a section gets it wrong.
 * `SectionHeader` takes the same prop for the same reason.
 *
 * ★★★ `id` lands on the heading so a wrapping `<section aria-labelledby>` names
 * itself from the heading it already renders — the repair `card.tsx` documents
 * at length, where fourteen sections pointed at ids nobody emitted and a
 * dangling `aria-labelledby` *erases* an accessible name rather than falling
 * back to the content.
 */
export function BoardCard({
  title,
  figure,
  as: Tag = "h2",
  id,
  children,
  footer,
  className,
}: {
  title: string;
  /**
   * The card's headline number, at the right of the title row — "92%",
   * "23 хүн". Blue and tabular, because in the sketch every one of them is a
   * quantity rather than a label.
   */
  figure?: ReactNode;
  as?: "h2" | "h3";
  id?: string;
  children: ReactNode;
  /** Pinned to the bottom, so a row of cards lines its footers up. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    // `h-full` so a card in a two-across row fills the height its taller
    // neighbour sets — the "бүх card ижил өндөртэй" the brief asks for, which
    // grid's default `stretch` gives the cell and this passes on to the card.
    <Card pad="roomy" className={cn("flex h-full flex-col gap-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <BoardIcon title={title} />
          <Tag id={id} className="min-w-0 text-lead font-semibold leading-heading text-ink">
            {title}
          </Tag>
        </div>
        {figure ? (
          <span className="shrink-0 rounded-pill bg-primary-soft px-2.5 py-1 text-lead font-semibold tabular-nums leading-none text-primary">
            {figure}
          </span>
        ) : null}
      </div>

      {/* `justify-center`, so a short card centres its one figure rather than
          hanging it under the title with the slack at the foot. */}
      <div className="flex flex-1 flex-col justify-center">{children}</div>

      {footer ? <div className="mt-auto">{footer}</div> : null}
    </Card>
  );
}

function BoardIcon({ title }: { title: string }) {
  const match =
    title.includes("ирц") || title.includes("Ирц")
      ? { icon: CalendarCheck, className: "bg-sky text-sky-ink" }
      : title.includes("хүүхд")
        ? { icon: Users, className: "bg-primary-soft text-primary" }
        : title.includes("Төрсөн")
          ? { icon: Cake, className: "bg-sun text-sun-ink" }
          : title.includes("Судалгаа")
            ? { icon: BarChart3, className: "bg-sun text-sun-ink" }
            : title.includes("нийтлэл")
              ? { icon: Newspaper, className: "bg-mint text-mint-ink" }
              : { icon: ClipboardList, className: "bg-peach text-peach-ink" };
  const Icon = match.icon;

  return (
    <span
      aria-hidden="true"
      className={cn("grid size-10 shrink-0 place-items-center rounded-card", match.className)}
    >
      <Icon size={19} strokeWidth={2.3} />
    </span>
  );
}

/**
 * The quiet "this card has nothing to say" state, at the card's own size.
 *
 * ★ Every card on this screen renders one rather than returning `null`.
 *
 * The dashboard is a fixed grid — two cards across, a full-width chart, two
 * more across, a full-width notice — so a card that disappears leaves a hole in
 * whichever band it was in and reflows the page when its query lands. Four
 * components on this screen used to return `null` in some state
 * (`GenderRatio`, `MonthBirthdays`, `ClassBoardNotice`, `WeeklyAttendance`) and
 * each records the reversal in its own docblock; this is the shape they all
 * reverted to.
 *
 * Two lines, no illustration: the product's centred 96px mascot is right for a
 * whole empty page and would make the card with nothing in it the tallest of
 * the row.
 */
export function BoardCardEmpty({
  icon,
  title,
  hint,
}: {
  /** A lucide glyph at 22px. Decorative — the title carries the meaning. */
  icon: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    /*
      ★ Centred and stacked below `sm`, a row above it.

      Two of these render inside a half-width card, which at 375px is 166px — a
      48px circle plus a sentence beside it leaves the text about 110px, and
      "Энэ сард төрсөн өдөр алга" wrapped to four one-word lines against the
      circle. Stacked and centred it reads as a small empty state, which is what
      it is; from `sm` the card is 352px and the row fits.
    */
    <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:gap-3 sm:text-left">
      <span
        aria-hidden="true"
        className="grid size-12 shrink-0 place-items-center rounded-pill bg-track text-faint"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-body font-medium text-ink">{title}</p>
        {hint ? <p className="mt-0.5 text-caption text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}
