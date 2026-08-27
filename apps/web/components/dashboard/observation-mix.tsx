import Image from "next/image";
import type { TeacherDashboard } from "@kinder/contracts";
import { TileShell } from "./tile-shell";
import { BarRow } from "@/components/ui/chart/bar-row";

/**
 * What kinds of observation this term is made of.
 *
 * ★ Share of what was written — not a completion rate, and the difference is
 * the whole reason this component is shaped the way it is.
 *
 * The requested design put "биелэлт" bars here: Ажиглалт / Ярилцлага / Бүтээл,
 * each at some percentage. A fulfilment percentage needs a target, and there is
 * no target anywhere in the schema — no quota per teacher, per child or per
 * term. Rendering one would mean choosing a denominator on the client, and a
 * teacher reading "68% биелэлт" would reasonably believe somebody had set 100%.
 *
 * So the bar is each type's share of the term's total, the number beside it is
 * the count, and the heading says so. A share is a fact about what happened; a
 * completion score against an invented target is not.
 *
 * ★★ The categories come from `ObservationType`, which an administrator edits
 * (CLAUDE.md §2.3). The wireframe's three names are not the five this system
 * ships with — so hard-coding them would have meant a dashboard describing a
 * taxonomy the database does not have. Configure those three and this renders
 * them; configure seven and it renders seven.
 *
 * ★★★ A `feature` tile with `icon-analytics.webp`, to match the assessment
 * progress it now shares a band with. Two cards side by side, one led by a
 * 48px drawing and the other by an 18px glyph, read as a tile and a section
 * rather than as a pair — and §14's rule against mixing the two kinds of art
 * is about a *band* being consistent, not about a file being pure.
 */
export function ObservationMix({
  observationsByType,
  term,
}: {
  observationsByType: TeacherDashboard["observationsByType"];
  term: string | null;
}) {
  const total = observationsByType.reduce((sum, row) => sum + row.count, 0);

  // Nothing written yet is not a chart of zeroes. `RecentObservations` below
  // already carries the empty case and the way to write the first one.
  if (observationsByType.length === 0 || total === 0) return null;

  /*
   * ★ Four rows at most.
   *
   * `ObservationType` is admin-editable, so a kindergarten may configure seven
   * — and seven bars turn a tile in a four-across row into the one that is
   * three times taller than its neighbours. The total in the label still counts
   * every type, so nothing is hidden, only folded.
   */
  const shown = observationsByType.slice(0, 4);
  const rest = observationsByType.length - shown.length;

  return (
    /*
      ★ A named landmark, and `h-full` so it stretches with the band.

      The tile is `h-full` already, but a grid stretches the *child* — and the
      child is this section, not the card inside it. Without the class the card
      sizes to its own content and the two cards in this row end at different
      heights, which is the "row looks broken" `TileShell` exists to prevent.
    */
    <section aria-label="Ажиглалтын төрлүүд" className="h-full">
      <TileShell
        icon={<Image src="/icons/icon-analytics.webp" alt="" width={48} height={48} />}
        tone="mint"
        size="feature"
        label="Ажиглалтын төрлүүд"
        footer={
          /*
          ★ "нийт" stays in the sentence, and the sentence stays in one element.
          The word is what separates a share of the total from a completion
          rate — `radar.test.tsx` asserts on the whole phrase, and wrapping the
          number in a `<span>` to embolden it splits the text node and breaks
          the match. The bars already carry the emphasis; this is a caption.
        */
          <p className="text-caption tabular-nums text-muted">
            {term ? `${term} · ` : ""}нийт {total} ажиглалт
            {rest > 0 ? ` · +${rest} төрөл` : ""}
          </p>
        }
      >
        <div className="flex flex-col gap-3">
          {shown.map((row) => {
            const share = Math.round((row.count / total) * 100);

            return (
              <div key={row.type.id} className="flex flex-col gap-1">
                {/*
                  ★ `BarRow` rather than the markup this file used to inline.

                  The presentation is unchanged — the count still leads and the
                  share still follows it in parentheses, because the count is
                  the fact and the percentage is only a way of comparing rows.
                  What moved is the bar itself, so track height, radius and the
                  transition are one decision instead of one per screen.
                */}
                <BarRow
                  label={row.type.name}
                  percent={share}
                  tone="mint"
                  value={
                    <>
                      {row.count}
                      <span className="ml-1 text-faint">({share}%)</span>
                    </>
                  }
                  accessibleLabel={`${row.type.name}: ${row.count} ажиглалт, нийтийн ${share}%`}
                />
              </div>
            );
          })}
        </div>
      </TileShell>
    </section>
  );
}
