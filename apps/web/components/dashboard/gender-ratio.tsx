"use client";

import { useQuery } from "@tanstack/react-query";
import { rosterSummarySchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Card, SectionHeader } from "@/components/ui/card";

/**
 * Эр эм харьцаа — the roster's sex split.
 *
 * ★ One bar, not two figures and a pie.
 *
 * The wireframe draws two stick figures with counts and percentages beside
 * them. A single split bar says the same thing in less space and reads at a
 * glance, which a pair of icons does not — the eye compares lengths far faster
 * than it compares two numbers. It also survives a phone, where two illustrated
 * columns would each be about 80px.
 *
 * ★★ Counts lead, percentages follow — the rule `ObservationMix` established.
 *
 * "14" is what a teacher acts on; "43%" is how they compare it to the other
 * number. Neither is a target, and nothing here is a score.
 *
 * ★★★ It reads `/children/summary`, which the counts tile already fetches.
 *
 * Same query key, so React Query serves both from one request rather than
 * asking twice — `DashboardStats` and this widget are two views of one answer.
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
  // neither bar, so dividing by the roster would draw a gap that means nothing.
  if (counted === 0) return null;

  const boyShare = Math.round((data.boys / counted) * 100);

  return (
    <section aria-labelledby="gender-ratio-heading">
      <SectionHeader id="gender-ratio-heading" title="Эр эм харьцаа" />

      <Card pad="roomy" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-body text-ink">
            Хүү{" "}
            <strong className="text-title font-semibold tabular-nums md:text-lead">
              {data.boys}
            </strong>
          </span>
          <span className="text-body text-ink">
            <strong className="text-title font-semibold tabular-nums md:text-lead">
              {data.girls}
            </strong>{" "}
            Охин
          </span>
        </div>

        {/*
          One track, two segments. `aria-label` carries both counts because the
          bar's proportions are the only thing the shape conveys, and a screen
          reader cannot see proportions.
        */}
        <div
          className="flex h-2 w-full overflow-hidden rounded-pill bg-track"
          role="img"
          aria-label={`${data.boys} хүү, ${data.girls} охин`}
        >
          <div className="h-full bg-primary" style={{ width: `${boyShare}%` }} />
          <div className="h-full flex-1 bg-peach" />
        </div>

        <div className="flex items-baseline justify-between gap-3 text-caption text-muted">
          <span className="tabular-nums">{boyShare}%</span>
          <span className="tabular-nums">{100 - boyShare}%</span>
        </div>
      </Card>
    </section>
  );
}
