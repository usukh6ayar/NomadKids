"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { z } from "zod";
import { surveySchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { RowCard, RowList } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { SURVEY_CATEGORY_META, SURVEY_TONE_BG } from "@/lib/survey-meta";
import { cn } from "@/lib/utils";

const activeSurveysSchema = z.array(surveySchema);

/**
 * A guardian's own surveys for one child — the "Судалгаа" tile's permanent
 * landing page.
 *
 * ★ Reads the same `/children/:id/surveys` endpoint `SurveyPrompt` (`/home`)
 * and the response screen (`[surveyId]/page.tsx`) already use — this is the
 * one endpoint a parent may call for surveys, so a list page finds its rows
 * there rather than adding a second read path. The API scopes it to what
 * this guardian may see; this screen does no filtering of its own.
 *
 * An answered survey has nowhere to link to — there is no "view my answers"
 * endpoint — so it renders as a plain row with a badge, not a link. Only a
 * still-open, unanswered one is a link, into the response form.
 */
export default function ChildSurveysPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;

  const surveys = useQuery({
    queryKey: qk.childSurveys(childId),
    queryFn: () => get(`/children/${childId}/surveys`, activeSurveysSchema),
  });

  const header = <PageHeader title="Миний судалгаанууд" />;

  if (surveys.isLoading) {
    return (
      <div className="flex flex-col gap-6 py-2">
        {header}
        <LoadingState rows={3} />
      </div>
    );
  }

  if (surveys.isError) {
    return (
      <div className="flex flex-col gap-6 py-2">
        {header}
        <ErrorState description={errorMessage(surveys.error)} />
      </div>
    );
  }

  const data = surveys.data!;

  if (data.length === 0) {
    return (
      <div className="flex flex-col gap-6 py-2">
        {header}
        <EmptyState
          title="Идэвхтэй судалгаа алга"
          description="Цэцэрлэгээс судалгаа явуулахад энд харагдана."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-2">
      {header}

      <RowList>
        {data.map((survey) => {
          const answered = Boolean(survey.respondedByMe);
          const open = !answered && survey.status !== "CLOSED";
          const meta = SURVEY_CATEGORY_META[survey.category];
          const questionCount = survey.questions.length;

          const body = (
            <>
              <span
                className={cn(
                  "grid size-11 shrink-0 place-items-center rounded-control",
                  SURVEY_TONE_BG[meta.tone],
                )}
                aria-hidden="true"
              >
                <meta.Icon size={20} aria-hidden="true" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="mb-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  {answered ? (
                    <Badge tone="mint">Хариулсан</Badge>
                  ) : open ? (
                    <Badge tone="sun">Хариулаагүй</Badge>
                  ) : (
                    <Badge tone="neutral">Хаагдсан</Badge>
                  )}
                </span>
                <span className="block font-semibold text-ink">{survey.title}</span>
                <span className="mt-0.5 block text-caption text-muted">
                  {questionCount > 0 ? `Нийт ${questionCount} асуулттай` : survey.description}
                </span>
              </span>

              {open ? <ChevronRight size={18} className="shrink-0 text-faint" aria-hidden /> : null}
            </>
          );

          return open ? (
            <Link
              key={survey.id}
              href={`/children/${childId}/surveys/${survey.id}`}
              className="flex items-start gap-3 rounded-row border border-border bg-surface px-4 py-3.5 transition-colors hover:border-primary"
            >
              {body}
            </Link>
          ) : (
            <RowCard key={survey.id} className="flex items-start gap-3">
              {body}
            </RowCard>
          );
        })}
      </RowList>
    </div>
  );
}
