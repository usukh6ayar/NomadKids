"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { assessmentSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

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
 * ★★ No radar chart. Charts are outside the MVP (CLAUDE.md §7), and a radar of
 * one term's levels needs a charting dependency to say what a labelled row says
 * more precisely and reads out loud correctly.
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
