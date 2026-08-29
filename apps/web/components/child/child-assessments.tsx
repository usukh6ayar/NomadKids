"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { assessmentRadarSchema, assessmentSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState, Skeleton } from "@/components/ui/states";
import { DevelopmentRadar } from "@/components/assessment/development-radar";

const assessmentsSchema = z.array(assessmentSchema);

/**
 * What `POST /children/:id/assessments/publish` answers with.
 *
 * Declared here rather than in `@kinder/contracts` because one component reads
 * it and nothing else in the product does — the same call the other local
 * response shapes on this screen make.
 */
const publishResultSchema = z.object({ updated: z.number(), visible: z.boolean() });

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
          <SectionHeader
            as="h3"
            title={term.name}
            /*
              ★ Staff only, and only for a real term.
              A guardian's list is already filtered to what was published, so
              `visibleToParents` is `true` on every row they can see — a badge
              reading "нийтэлсэн" beside data they are looking at says nothing,
              and the control behind it is not theirs.
            */
            action={
              isStaff && key !== "no-term" ? (
                <TermPublish childId={childId} termId={key} rows={term.rows} />
              ) : undefined
            }
          />

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
 * Publishing one term's assessments to the family — RFP §2.3.
 *
 * ★ Why this exists at all.
 *
 * `Assessment.visibleToParents` is `@default(false)`, and the guardian branch
 * of `listForChild` filters on it. `POST /children/:id/assessments/publish` has
 * existed since the assessment module shipped and **nothing in the product ever
 * called it** — so every assessment a teacher recorded was invisible to every
 * parent, permanently. The empty state above already promised "Багш үнэлгээг
 * нийтлэхэд энд харагдана"; this is the action that makes the promise true.
 *
 * ★★ Per child and per term, because that is the endpoint's own granularity.
 *
 * `setTermVisibility` updates every assessment for one child in one term, so
 * this control sits on the term it governs rather than on the group grid. A
 * "publish the whole group" button would be N requests fanned out from the
 * client for an operation the API does not offer — worth adding as a real bulk
 * endpoint later, not worth faking here.
 *
 * ★★★ No confirmation dialog, deliberately.
 *
 * This product confirms what cannot be undone: `term-report` finalising asks,
 * because the form disappears afterwards. Publishing is a **toggle** — the DTO
 * is `{ termId, visible: boolean }` — so it matches the survey and the
 * announcement, neither of which confirms. Adding a prompt to a reversible
 * action here would make the one on the term report mean less.
 */
function TermPublish({
  childId,
  termId,
  rows,
}: {
  childId: string;
  termId: string;
  rows: { visibleToParents?: boolean | null }[];
}) {
  const queryClient = useQueryClient();

  const publishedCount = rows.filter((row) => row.visibleToParents === true).length;
  const allPublished = publishedCount === rows.length;
  const nonePublished = publishedCount === 0;
  /** The button flips whichever way the term is not. */
  const nextVisible = !allPublished;

  const publish = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/assessments/publish`, publishResultSchema, {
        method: "POST",
        body: { termId, visible: nextVisible },
      }),
    // The badge beside the button is the real feedback: it flips as soon as the
    // refetched list says so. Invalidate rather than patch the cache, so what
    // is on screen is what the API actually stored.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.childAssessments(childId) }),
  });

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {allPublished ? (
          <Badge tone="mint">
            <Eye size={13} aria-hidden="true" />
            Эцэг эхэд нээлттэй
          </Badge>
        ) : nonePublished ? (
          <Badge tone="neutral">
            <EyeOff size={13} aria-hidden="true" />
            Нийтлээгүй
          </Badge>
        ) : (
          /*
            Partial is a real state: a term can hold assessments saved before an
            earlier publish and others added after it. Saying "нийтэлсэн" here
            would tell a teacher the family can see rows they cannot.
          */
          <Badge tone="sun">
            {publishedCount}/{rows.length} нийтэлсэн
          </Badge>
        )}

        <Button
          size="sm"
          variant={allPublished ? "secondary" : "primary"}
          // Guards the double-click, and the pending label says why.
          disabled={publish.isPending}
          onClick={() => publish.mutate()}
        >
          {publish.isPending
            ? allPublished
              ? "Буцааж байна…"
              : "Нийтэлж байна…"
            : allPublished
              ? "Нийтлэлийг буцаах"
              : "Эцэг эхэд нийтлэх"}
        </Button>
      </div>

      {publish.isError ? (
        <p role="alert" className="text-caption text-danger">
          {errorMessage(publish.error)}
        </p>
      ) : publish.isSuccess ? (
        /*
          There is no toast component in this product, so success is stated
          where the action was taken — the pattern the rest of the app uses.
          `role="status"` announces it once without stealing focus.
        */
        <p role="status" className="text-caption text-mint-ink">
          {publish.data.visible
            ? "Нийтэллээ. Эцэг эх одоо харна."
            : "Нийтлэлийг буцаалаа. Эцэг эх харахгүй."}
        </p>
      ) : null}
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
