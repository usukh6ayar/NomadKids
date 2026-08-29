"use client";

import { useQuery } from "@tanstack/react-query";
import { rosterSummarySchema, type TeacherDashboard } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { formatAgeFromMonths } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

/**
 * How big this teacher's world is — and nothing else.
 *
 * ★ This row was four tiles, and two of them were already on the screen.
 *
 * "Улирлын явц" showed `47%` and `12 / 26 үнэлэгдсэн` about three hundred pixels
 * above a `TermProgress` section showing `12 / 26 хүүхэд үнэлэгдсэн` and `47%`.
 * The argument for keeping both was that the tile summarises and the section
 * details — but the tile carried *both* numbers, so it was not a summary of the
 * section, it was the section minus the bar.
 *
 * `term-progress.tsx` settled it in its own note: "only one of the two is a
 * `progressbar` an assistive technology can report." That is a reason to keep
 * the bar, not the tile.
 *
 * "Хянах" was the same shape of duplication with a sharper edge: a number you
 * could not act on, directly above the same number on an alert card that
 * carries the button. A count with no verb teaches people to look past the row.
 *
 * ★★ What is left is two counts, which is the point.
 *
 * The docblock this component has always carried opens "Context, not the point
 * of the screen" and warns that "a dashboard whose largest elements are four
 * numbers teaches a teacher to read numbers rather than to act". Four tiles were
 * arguing with that sentence. Two agree with it.
 */
/**
 * ★★★ Half a row, holding two cards — not a full-width grid of its own.
 *
 * This rendered `<section className="grid grid-cols-2">` at the page's full
 * width, which stretched two short numbers across the whole viewport: "Хүүхэд
 * 5" filling 600px of a 1200px screen with nothing beside it. That was a
 * leftover rather than a decision — the row held four tiles until two were
 * removed as duplicates of the sections below them, and nothing revisited the
 * columns the survivors sat in.
 *
 * It is one cell of the page's twelve-column grid now, spanning six, with three
 * counts sharing it — so each is an eighth of the width and the group's
 * assessment card takes the other half of the row.
 *
 * ★★★ Three across on a phone too, rather than collapsing to one.
 *
 * The rule for this screen is that grids fall to a single column on mobile, and
 * these are the exception: three short numbers, where stacking spends three
 * full-width cards and roughly 240px of height to say "5 · 1 · 3 нас 5 сар". A
 * single column would *cost* screen real estate where it is scarcest, which is
 * the opposite of the intent. At 375px each tile is about 110px — enough once
 * its type steps down with the breakpoint.
 *
 * ★★★★ The `<section>` stays a real element rather than becoming a fragment or
 * a `display: contents` wrapper. Both would let the cards sit directly in the
 * page grid, and both would cost the landmark: a fragment has nowhere to hang
 * `aria-label`, and `display: contents` has a history of dropping elements out
 * of the accessibility tree. Two bare numbers announced with no name is a worse
 * outcome than a column span this component has to know about.
 */
export function DashboardStats({ counts }: { counts: TeacherDashboard["counts"] }) {
  /*
   * ★ The mean age comes from `/children/summary`, not from this endpoint.
   *
   * `GET /dashboard/teacher` does not carry it, and widening that response to
   * serve one card would couple the dashboard endpoint to this component's
   * layout — the same coupling `GroupsSection` declines for the same reason.
   * The summary endpoint already exists for the roster, computes the mean over
   * the whole visible set rather than a page, and shares its `where` with the
   * children list. A second reader costs one request and no new server code.
   *
   * Unfiltered here: the roster screen passes its search term so its header
   * matches its rows, but a dashboard describes everyone this teacher has.
   * `qk.rosterSummary({})` is therefore a different cache key from the roster's,
   * which is correct — they are answers to different questions.
   */
  const roster = useQuery({
    queryKey: qk.rosterSummary({}),
    queryFn: () => get("/children/summary", rosterSummarySchema),
    // Context, not the point of the screen: a failure drops the card rather
    // than the dashboard.
    retry: false,
  });

  const averageAge = roster.data?.averageAgeMonths;

  return (
    /*
     * ★ One card holding three facts, not three cards holding one each.
     *
     * Measured on a real 1440px window: three separate cards were ~370px wide
     * apiece to carry "Хүүхэд" and a two-digit number, so each was mostly
     * empty and the band read as three placeholders above the tiles that
     * actually say something. These are context — the roster's size and shape
     * — not headline statistics, and context belongs on one line.
     *
     * `divide-x` rather than gaps: the three are one thought, and separating
     * them into cards was what made them compete with the row below.
     */
    <section aria-label="Өнөөдрийн тойм">
      <Card pad="compact" className="grid grid-cols-3 divide-x divide-border-soft">
        <Stat label="Хүүхэд" value={counts.children} />
        <Stat label="Бүлэг" value={counts.groups} />
        {/*
          ★★ Absent rather than zero while it loads or if it fails.
          A cell reading "0 нас" for a beat is a claim about the roster; an
          empty slot is only a slower cell. The other two do not move when it
          arrives — the grid reserves three columns whatever this renders.
        */}
        <Stat
          label="Дундаж нас"
          kind="phrase"
          value={
            averageAge === null || averageAge === undefined ? "—" : formatAgeFromMonths(averageAge)
          }
        />
      </Card>
    </section>
  );
}

/**
 * One tile.
 *
 * ★ No `tone` and no `detail` any more. Both existed for the two tiles that are
 * gone — the tint marked a share rather than a count, and the detail line
 * disambiguated a bare number. A count of children needs neither, and a prop
 * nothing passes is the next person's puzzle.
 */
/**
 * One tile.
 *
 * `value` takes a string as well as a number because the age is worded — "3 нас
 * 5 сар", not 41. `tabular-nums` still applies: it aligns the digits inside
 * that phrase and costs nothing where there are none.
 *
 * ★ `kind` exists because a two-digit numeral and a four-word phrase cannot
 * share a type size in a 100px cell, and this was measured rather than
 * guessed.
 *
 * The card moved into the five-column half of the "today" band, where each of
 * its three cells is about 106px of usable width at 1440. "4 нас 11 сар" at
 * `--text-display` (24px) is roughly 130px, so it wrapped to two lines and then
 * to three at 1024 — which made a context strip the tallest thing in its
 * column, above a chart. `Хүүхэд 5` at the same size is 12px wide and has no
 * such problem, so stepping *both* down would have shrunk the two figures for
 * a fault neither of them has. The phrase takes one step down; the numerals
 * keep the size that makes them readable across a desk.
 */
function Stat({
  label,
  value,
  kind = "figure",
}: {
  label: string;
  value: number | string;
  /** `phrase` is a worded value — an age, not a count. */
  kind?: "figure" | "phrase";
}) {
  return (
    <div className="px-2 first:pl-0 last:pr-0 md:px-3">
      {/*
        The label wraps rather than truncating: "Дундаж нас" does not fit 110px
        on one line, and a clipped label is a worse failure than a two-line one.
      */}
      <p className="text-caption leading-tight text-muted md:text-body">{label}</p>
      {/*
        `[overflow-wrap:anywhere]` guards a longer value than any that exists
        today: nothing in this row may push the grid wide.
      */}
      <p
        className={cn(
          "mt-0.5 font-semibold leading-tight tabular-nums text-ink [overflow-wrap:anywhere]",
          kind === "phrase" ? "text-lead md:text-title" : "text-title md:text-display",
        )}
      >
        {value}
      </p>
    </div>
  );
}
