"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { assessmentRadarSchema, assessmentSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState, Skeleton } from "@/components/ui/states";
import { DevelopmentRadar } from "@/components/assessment/development-radar";

const assessmentsSchema = z.array(assessmentSchema);

/**
 * The "Үнэлгээ" tab — this child's development levels, grouped by term.
 *
 * ★ Grouped, because the endpoint returns every term at once.
 *
 * `GET /children/:id/assessments` is a flat list across the whole year. Rendered
 * flat it reads as one long column in which the same five domains repeat, and
 * nothing on screen says why — the term is the thing that makes two rows for
 * "Хэл яриа" different rather than contradictory.
 *
 * ★★ The radar leads each term, and the rows stay underneath it.
 *
 * The note here used to argue against a chart on two grounds: that it was
 * outside the MVP, and that a radar needs a charting dependency "to say what a
 * labelled row says more precisely and reads out loud correctly". The client
 * pulled it into scope on 2026-08-24. The second objection was answered rather
 * than overruled — `DevelopmentRadar` is hand-drawn SVG with no dependency, and
 * it carries the same numbers in a real `<table>`, so nothing that was readable
 * before became a picture.
 *
 * The rows are not redundant beside it. A radar shows standing across five
 * domains at a glance and cannot show a teacher's comment; the list is where
 * the words are.
 */
export function ChildAssessments({ childId, isStaff }: { childId: string; isStaff: boolean }) {
  // Mounted only when its tab is open — Radix unmounts inactive panels. See the
  // note in `child-observations.tsx`.
  const assessments = useQuery({
    queryKey: qk.childAssessments(childId),
    queryFn: () => get(`/children/${childId}/assessments`, assessmentsSchema),
  });

  if (assessments.isPending) return <LoadingState rows={2} />;
  if (assessments.isError) return <ErrorState description={errorMessage(assessments.error)} />;

  if (assessments.data.length === 0) {
    return (
      <EmptyState
        title="Үнэлгээ хараахан алга"
        description={
          isStaff
            ? "Бүлгийн үнэлгээний дэлгэцээс энэ улирлын үнэлгээг оруулна уу."
            : "Багш үнэлгээг нийтлэхэд энд харагдана."
        }
      />
    );
  }

  // Insertion order is the API's order, so the terms come out as it sorted
  // them rather than alphabetically by name.
  const byTerm = new Map<string, { name: string; rows: typeof assessments.data }>();
  for (const assessment of assessments.data) {
    const key = assessment.term?.id ?? "no-term";
    const existing = byTerm.get(key);
    if (existing) existing.rows.push(assessment);
    else
      byTerm.set(key, { name: assessment.term?.name ?? "Улирал тодорхойгүй", rows: [assessment] });
  }

  return (
    <div className="flex flex-col gap-6">
      {[...byTerm.entries()].map(([key, term]) => (
        <section key={key} aria-label={term.name}>
          <SectionHeader as="h3" title={term.name} />

          {/*
            Only for a real term. `no-term` is the bucket for assessments whose
            term the API could not resolve, and a radar of those would be a
            chart of an unnamed period.
          */}
          {key === "no-term" ? null : <TermRadar childId={childId} termId={key} />}

          <Card className="divide-y divide-border">
            {term.rows.map((assessment) => (
              <div
                key={assessment.id}
                className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{assessment.domain?.name ?? "—"}</p>
                  {assessment.comment ? (
                    <p className="mt-0.5 text-body text-muted">{assessment.comment}</p>
                  ) : null}
                </div>
                {/*
                  The level's label always shows. Its colour is a hint on top of
                  the words, never the only way to read the value.
                */}
                <Badge tone="sky">{assessment.level?.label ?? "—"}</Badge>
              </div>
            ))}
          </Card>
        </section>
      ))}
    </div>
  );
}

/**
 * The radar for one term.
 *
 * ★ Its own query, and its own failure.
 *
 * Folding it into the assessment request would mean one endpoint serving two
 * shapes, and — worse — a radar that fails taking the list down with it. The
 * list is the thing a teacher came for; the chart is context. So this renders
 * nothing at all when the request fails or the term has no assessments, rather
 * than putting an error block above readable data.
 */
function TermRadar({ childId, termId }: { childId: string; termId: string }) {
  const radar = useQuery({
    queryKey: qk.assessmentRadar(childId, termId),
    queryFn: () =>
      get(`/children/${childId}/assessment-radar?termId=${termId}`, assessmentRadarSchema),
    retry: false,
  });

  if (radar.isPending) return <Skeleton className="mb-4 h-[220px] w-full" />;
  if (radar.isError || !radar.data) return null;

  // Every axis empty means nothing has been assessed for this term — the
  // outline would be a dot at the centre, which says less than the rows below.
  if (radar.data.axes.every((axis) => axis.score === null)) return null;

  return (
    <Card pad="roomy" className="mb-4">
      <DevelopmentRadar radar={radar.data} />
    </Card>
  );
}
