import type { TeacherDashboard } from "@kinder/contracts";
import { Card, SectionHeader } from "@/components/ui/card";

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

  return (
    <section aria-labelledby="observation-mix-heading">
      <SectionHeader
        id="observation-mix-heading"
        title="Ажиглалтын төрлүүд"
        lede={term ? `${term} — нийт ${total} ажиглалт` : `Нийт ${total} ажиглалт`}
      />

      <Card pad="roomy" className="flex flex-col gap-2.5 md:gap-3">
        {observationsByType.map((row) => {
          const share = Math.round((row.count / total) * 100);

          return (
            <div key={row.type.id} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-body text-ink">{row.type.name}</span>
                {/*
                  The count leads and the share follows it in parentheses. The
                  count is the fact; the percentage is a way of comparing rows,
                  and putting it first is what would make it read as a score.
                */}
                <span className="shrink-0 text-body tabular-nums text-muted">
                  {row.count}
                  <span className="ml-1.5 text-caption">({share}%)</span>
                </span>
              </div>

              <div
                className="h-1.5 w-full overflow-hidden rounded-pill bg-track"
                role="progressbar"
                aria-valuenow={share}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${row.type.name}: ${row.count} ажиглалт, нийтийн ${share}%`}
              >
                <div
                  className="h-full rounded-pill bg-primary transition-[width]"
                  style={{ width: `${share}%` }}
                />
              </div>
            </div>
          );
        })}
      </Card>
    </section>
  );
}
