"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Baby, Users } from "lucide-react";
import { rosterSummarySchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/states";
import { BoardCard, BoardCardEmpty } from "./board-card";
import { cn } from "@/lib/utils";

/**
 * Бүлгийн хүүхдүүд — the roster's size, and how it splits.
 *
 * ★ Two counts and a rule — and this file has now shipped three drawings of
 * the same two numbers, so the history is worth keeping visible.
 *
 * It began as a single split bar, chosen over "two figures with counts" because
 * the eye compares lengths faster than numerals and a pair of illustrated
 * columns dies at 375px. It became a `Donut` when the tile moved into a wider
 * column, on the grounds that a donut compares the same two lengths and can
 * carry the roster's size in its middle.
 *
 * Both arguments were about comparing a *ratio*, and that is not the question
 * the client's dashboard asks. It asks how many girls and how many boys are in
 * the group — two numbers, drawn as two numbers. The 375px objection is
 * answered by the layout rather than the chart: this card sits beside one other
 * in a two-across grid, so each count gets about half of 168px, which fits an
 * icon, a label and a two-digit figure.
 *
 * The percentages went with the donut. A demo group is five children, and
 * "40% / 60%" over two single-digit counts is precision the numbers cannot
 * carry.
 *
 * ★★★★ It reads `/children/summary`, which the counts tile already fetches.
 * Same query key, so React Query serves both from one request.
 *
 * ★★★★★ It no longer returns `null`, and that is a layout contract rather than
 * a change of heart about empty states.
 *
 * This tile is one of three in the dashboard's top row, and §5 of the 2026-08-28
 * brief requires all three to be present and the same height. `null` broke that
 * twice: once for the whole of the roster request (`!data` is true while it is
 * in flight, so the row rendered with a hole and then reflowed), and again for
 * a kindergarten that has recorded nobody's sex.
 *
 * Both now render a tile of the tile's own size. `AttendanceToday` beside it
 * settled the same question the same way and wrote down why — "an error block
 * here would shout louder than every section that loaded correctly" — so the
 * unavailable case is a quiet line inside the card, never an alert.
 */
export function GenderRatio() {
  const { data, isLoading } = useQuery({
    queryKey: qk.rosterSummary({}),
    queryFn: () => get("/children/summary", rosterSummarySchema),
    // Context, not the point of the screen: a failure quietens the card.
    retry: false,
  });

  if (isLoading) return <GenderRatioSkeleton />;

  const counted = data ? data.boys + data.girls : 0;

  // Not `data.total`: a child with no recorded sex is in the roster and in
  // neither segment, so dividing by the roster would draw a gap that means
  // nothing. No data at all and nobody counted read the same to a teacher —
  // there is no split to show — so they share one quiet state.
  if (!data || counted === 0) {
    return (
      <BoardCard title="Бүлгийн хүүхдүүд">
        <BoardCardEmpty
          icon={<Users size={22} />}
          title={data ? "Хүйс бүртгэгдээгүй" : "Мэдээлэл алга"}
          hint={
            data
              ? "Хүүхдийн хувийн мэдээлэлд хүйс оруулсны дараа харагдана."
              : "Дахин ачаалж үзнэ үү."
          }
        />
      </BoardCard>
    );
  }

  return (
    /*
      ★ Two counts side by side, where this drew a donut until 2026-08-28.

      The donut was the right chart for the question the tile used to ask — "how
      does the roster split" — and it is the wrong one for the question the
      client's dashboard asks, which is "how many girls and how many boys are in
      my group". Those are two numbers, and the sketch shows them as two
      numbers: a line icon, a label, a large blue figure, a rule between them.
      A chart that has to be read back into its own legend to answer that is
      more work, not less.

      The percentages went with it for the same reason. `data.total` is five
      children in a demo group; "40% / 60%" over two single-digit counts is
      precision the number cannot carry.
    */
    <BoardCard title="Бүлгийн хүүхдүүд">
      {/*
        `role="img"` with the whole sentence, so the pair is announced once as
        a fact rather than as four disconnected strings.

        ★ The phrase is unchanged from the donut's — "N хүү, N охин".
        `dashboard-widgets.test.tsx` pins it, and this file argued the point
        before the drawing changed: an accessible name should not move because
        a visible label was reworded, and it certainly should not move because
        a chart was replaced.
      */}
      {/*
        ★ Stacked below `sm`, side by side above it — measured, not guessed.

        The sketch pairs the two counts across the card, and at its own width
        (~270px per card) they fit. At a real 375px this card is **166px**, and
        two blocks of "44px circle + label + two-digit figure" inside it
        overlapped: the labels clipped to "О." and "Х." and the numerals ran
        under their own icons. Stacked, each count gets the full 134px of
        content box and every word survives; from `sm` the card is 352px and the
        sketch's row fits with room to spare.

        The divider turns with them — a vertical rule between two stacked rows
        would be a rule beside nothing.
      */}
      <div
        role="img"
        aria-label={`${data.boys} хүү, ${data.girls} охин`}
        className="flex flex-col items-stretch gap-3 sm:flex-row sm:gap-0"
      >
        <Count
          tone="peach"
          icon={<Baby size={22} aria-hidden="true" />}
          label="Охид"
          value={data.girls}
        />
        {/* A hairline between them, as in the sketch — the one divider on the
            screen, and the thing that makes this read as two facts rather than
            as one wrapped row. */}
        <span
          aria-hidden="true"
          className="h-px shrink-0 self-stretch bg-border sm:h-auto sm:w-px"
        />
        <Count
          tone="sky"
          icon={<Baby size={22} aria-hidden="true" />}
          label="Хөвгүүд"
          value={data.boys}
        />
      </div>
    </BoardCard>
  );
}

/**
 * One side of the split: an icon, what it counts, and how many.
 *
 * ★ The icon is tinted per side and the numeral is the brand blue in both.
 *
 * The sketch draws a pink figure over "Охид" and a blue one over "Хөвгүүд",
 * and both counts in blue. That is the right division of labour: the tint
 * distinguishes the two categories, and the numerals are the same colour
 * because they are the same kind of fact — colouring them differently would
 * imply one of them is better.
 *
 * ★★ `flex-1` and `min-w-0` on both, so the pair splits its card evenly and a
 * three-digit roster shrinks the label rather than pushing its neighbour out.
 */
function Count({
  tone,
  icon,
  label,
  value,
}: {
  tone: "peach" | "sky";
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:justify-center">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-pill",
          tone === "peach" ? "bg-peach text-peach-ink" : "bg-sky text-sky-ink",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-caption text-muted">{label}</p>
        <p className="text-display font-semibold tabular-nums leading-tight text-primary">
          {value}
        </p>
      </div>
    </div>
  );
}

/**
 * The tile's footprint with nothing in it yet — chip, label, donut, legend.
 *
 * It exists for the same reason `AttendanceSkeleton` does: this card sits in a
 * three-across row whose members are required to be the same height, and a
 * generic run of grey bars would resolve to a different one and shove the band
 * below it down the page as the roster request lands.
 */
function GenderRatioSkeleton() {
  return (
    <Card pad="roomy" className="flex h-full flex-col gap-3">
      <Skeleton className="h-4 w-32" />
      <div className="flex flex-1 items-center">
        <div className="flex flex-1 items-center justify-center gap-2.5">
          <Skeleton className="size-11 shrink-0 rounded-pill" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-6 w-8" />
          </div>
        </div>
        <span className="w-px self-stretch bg-border" />
        <div className="flex flex-1 items-center justify-center gap-2.5">
          <Skeleton className="size-11 shrink-0 rounded-pill" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-6 w-8" />
          </div>
        </div>
      </div>
    </Card>
  );
}
