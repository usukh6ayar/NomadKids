"use client";

import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { rosterSummarySchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { TileShell } from "./tile-shell";
import { Donut } from "@/components/ui/chart/donut";

/**
 * Эр эм харьцаа — the roster's sex split.
 *
 * ★ A `Donut` now, where this was a single split bar — and the earlier
 * reasoning is worth keeping visible, because it was not wrong.
 *
 * The bar was chosen over "two stick figures with counts" on the grounds that
 * the eye compares lengths faster than it compares numerals, and that a pair of
 * illustrated columns dies at 375px. Both still hold. What changed is the
 * tile's job: it no longer sits in a four-across row where a 10px rule was the
 * only shape that fit, but in the narrower column of the "today" band beside
 * the roster counts, where there is room for a chart to actually be one.
 *
 * A donut compares two lengths as well as a bar does — they are the same
 * measurement bent round — and it does the one thing the bar could not, which
 * is carry the roster's size in the middle of it. The counts and the shares
 * stay exactly where they were, in the legend, so nothing a reader could act on
 * moved. `Donut` is the shared primitive (§16), so the stroke weight and the
 * hole are decided once for every chart in the product rather than here.
 *
 * ★★ The segments take the accents' **ink** values, which is what `TONE_VAR`
 * hands a chart, and that reverses a note this file used to carry.
 *
 * The bar was filled with the pale tints because the ink pair read as "dark
 * navy and rust" across a 10px rule. A donut's arc is drawn against
 * `--color-track` (slate-100) rather than against white, and `--color-sky` and
 * `--color-cornflower` are within a few percent of that grey — the pastel arc
 * would have been an invisible chart. The legend dots take the same ink, so
 * the mapping between the chart and the numbers is exact.
 *
 * ★★★ Nothing here implies progress. There is no target, no whole to reach and
 * no order between the two segments; the label says "N хүү, N охин" and the
 * centre says how many children the two add up to.
 *
 * ★★★★ It reads `/children/summary`, which the counts tile already fetches.
 * Same query key, so React Query serves both from one request.
 */
export function GenderRatio() {
  const { data } = useQuery({
    queryKey: qk.rosterSummary({}),
    queryFn: () => get("/children/summary", rosterSummarySchema),
    // Context, not the point of the screen: a failure drops the card.
    retry: false,
  });

  if (!data) return null;

  const counted = data.boys + data.girls;
  // Not `data.total`: a child with no recorded sex is in the roster and in
  // neither segment, so dividing by the roster would draw a gap that means
  // nothing.
  if (counted === 0) return null;

  const boyShare = Math.round((data.boys / counted) * 100);

  return (
    <TileShell
      icon={<Users size={18} aria-hidden="true" />}
      tone="cornflower"
      label="Эр эм харьцаа"
    >
      <div className="flex items-center gap-4">
        <Donut
          size={92}
          segments={[
            { label: "Хүү", value: data.boys, tone: "cornflower" },
            { label: "Охин", value: data.girls, tone: "peach" },
          ]}
          /*
            ★ The same sentence the split bar carried, kept verbatim.

            A chart's proportions are the one thing its shape conveys and the
            one thing a screen reader cannot see, so both counts are the name.
            It is unchanged from the bar deliberately: the accessible
            experience of this tile should not have moved because its drawing
            did, and `dashboard-widgets.test.tsx` pins the phrase.
          */
          label={`${data.boys} хүү, ${data.girls} охин`}
          centre={
            <span className="text-center leading-tight">
              <span className="block text-lead font-semibold tabular-nums text-ink">{counted}</span>
              <span className="block text-caption text-muted">хүүхэд</span>
            </span>
          }
        />

        {/*
          The legend is the tile's content, not a caption under a picture: the
          counts are what a teacher reads and the arcs are how they compare
          them. `min-w-0` so a narrow column shrinks the text rather than the
          chart, which stops being readable below about 80px.
        */}
        <ul className="flex min-w-0 flex-1 flex-col gap-2.5">
          <Legend tone="cornflower" label="Хүү" value={data.boys} share={boyShare} />
          <Legend tone="peach" label="Охин" value={data.girls} share={100 - boyShare} />
        </ul>
      </div>
    </TileShell>
  );
}

/**
 * One side of the split: the count, the share, and a dot tying both to an arc.
 *
 * ★ The dot is the tone's **ink**, matching the arc rather than the tint.
 *
 * A legend whose swatch is a lighter version of the segment it names is a
 * legend a reader has to guess at. These are `size-2.5 rounded-pill`, the same
 * shape the attendance breakdown uses, so the two cards in this band read as
 * one system.
 */
function Legend({
  tone,
  label,
  value,
  share,
}: {
  tone: "cornflower" | "peach";
  label: string;
  value: number;
  share: number;
}) {
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 text-body text-muted">
        <span
          aria-hidden="true"
          className={`size-2.5 shrink-0 rounded-pill ${
            tone === "cornflower" ? "bg-cornflower-ink" : "bg-peach-ink"
          }`}
        />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 tabular-nums">
        <span className="text-lead font-semibold text-ink">{value}</span>
        <span className="ml-1.5 text-caption text-muted">{share}%</span>
      </span>
    </li>
  );
}
