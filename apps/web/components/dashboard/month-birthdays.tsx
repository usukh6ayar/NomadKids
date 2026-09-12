import Link from "next/link";
import { Cake } from "lucide-react";
import type { TeacherDashboard } from "@kinder/contracts";
import { BoardCard, BoardCardEmpty } from "./board-card";
import { formatDayMonth } from "@/lib/format";

/**
 * Энэ сард төрсөн хүүхдүүд — the month's birthdays, day-ordered.
 *
 * ★ Separate from the birthday alert, and both earn their place.
 *
 * `NeedsAttentionAlerts` shows whose birthday is *today* — it is an alert, and
 * it is absent on the twenty-nine days when nobody has one. This is a plan: a
 * teacher ordering a cake or printing a card needs the week ahead, not the
 * morning. The API returns two lists for the same reason rather than one the
 * client filters, so neither can drift from the other.
 *
 * ★★ Ordered by day of month, so it reads as a calendar. The API does that
 * sorting — `EXTRACT(DAY …)` — because children in one group span three birth
 * years and a full-date sort would group them by age instead.
 *
 * ★★★ A plain white card since 2026-08-28, where it carried the `sun` wash.
 *
 * The wash was one of exactly two on the old screen and it was arguing
 * something real: every other card there reported work — a register to fill, an
 * assessment to finish — and this one reports that something nice is coming.
 * The client's dashboard makes that argument unnecessary by removing the cards
 * it was arguing against: six white cards, and the only colour in the data. The
 * peach circle behind each cake is what is left of it, and it is enough.
 *
 * ★★★★ There is no birthday illustration in `public/`, and none was invented.
 * The eight mascots are children and a teacher, none of them holding a cake, so
 * dropping one here would be a picture of *a* child on a card naming *these*
 * children. Lucide's `Cake` is the honest version. The children's own avatars
 * were shown here until 2026-08-28 and went with the layout change — see the
 * note on the row below.
 */
export function MonthBirthdays({
  birthdays,
}: {
  birthdays: TeacherDashboard["birthdaysThisMonth"];
}) {
  /*
   * ★ An empty month renders, where it used to return `null` — and that
   * reverses a decision this file argued for on 2026-08-28.
   *
   * The old note read "an empty frame saying so is a card a teacher learns to
   * skip", and that was right while this tile floated in a stacked column where
   * its absence only made the column shorter. It is now the third card of the
   * dashboard's top row, which the client's brief (§5) requires to be three
   * cards of equal height — so `null` leaves a third of the most prominent
   * band on the screen empty. `ClassBoardNotice` reversed the identical
   * decision for the identical reason and its docblock records it.
   *
   * The state is two lines on the tile's own footprint, not the product's
   * centred 96px mascot: a full-page empty state here would make the card with
   * nothing in it the tallest of the three.
   */
  if (birthdays.length === 0) {
    return (
      <BoardCard title="Төрсөн өдөрийн булан">
        <BoardCardEmpty
          icon={<Cake size={22} />}
          title="Энэ сард төрсөн өдөр алга"
          hint="Ирэх сарын төрсөн өдрүүд эндээс харагдана."
        />
      </BoardCard>
    );
  }

  /*
   * ★ Three names, then a count.
   *
   * A month with eleven birthdays would make this the tallest thing in a row
   * of four tiles, for a list nobody reads past the top of. The link at the
   * foot goes to the roster, where the whole month is legible.
   */
  const shown = birthdays.slice(0, 3);
  const rest = birthdays.length - shown.length;

  return (
    <BoardCard
      title="Төрсөн өдөрийн булан"
      footer={
        /*
          Only when the list is folded. The sketch shows two names and nothing
          under them; a "2 хүүхэд" line under a list of exactly two names is
          the count restating what the reader just counted.
        */
        rest > 0 ? (
          <p className="border-t border-border-soft pt-2.5 text-caption text-muted">
            <span className="font-semibold tabular-nums text-ink">{birthdays.length}</span> хүүхэд ·
            +{rest} нэр
          </p>
        ) : undefined
      }
    >
      {/*
        ★ `divide-y`, not a column of bordered rows.

        The sketch separates the names with one hairline between them and no
        frame around either — which is what `divide-y` draws, and what the row
        cards this used to render could not: each of those carried its own
        border, so two names read as two objects rather than as one list. The
        tile was tinted amber then and the rows needed their own surface to have
        any shape at all; the card is white now, so they do not.
      */}
      <ul className="-my-1 divide-y divide-border-soft">
        {shown.map((child) => (
          <li key={child.id}>
            {/*
              ★ `/general`, not `/children/:id`.

              The merge with `origin/main` deleted the child hub page and split
              it into `general`, `observations`, `attendance` and the rest, so
              the bare id is no longer a route — it 404s. The destination the
              hub used to land on is the general tab, and that is what the name
              on this row should open.
            */}
            <Link
              href={`/children/${child.id}/general`}
              className="-mx-2 flex min-h-[44px] items-center gap-3 rounded-row px-2 py-2 transition-colors hover:bg-canvas"
            >
              {/*
                A tinted cake in a circle, as the sketch draws it — not the
                child's avatar, which this used to show. Two photographs at
                32px in a 168px card is most of the row spent on faces a
                teacher already knows, and the sketch is explicit: the mark
                says "birthday", the text says who.
              */}
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-pill bg-peach text-peach-ink"
              >
                <Cake size={16} />
              </span>
              <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                {child.firstName}
              </span>
              {/*
                The date, not "in 3 days": a relative phrase is re-read every
                morning, and this list is scanned once when planning the month.
                Plain and tabular rather than a tinted pill — the cake beside
                the name is already the card's colour.
              */}
              <span className="shrink-0 text-body tabular-nums text-muted">
                {formatDayMonth(child.dateOfBirth)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </BoardCard>
  );
}
