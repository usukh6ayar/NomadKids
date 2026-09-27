"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  SURVEY_KIND_LABEL,
  SURVEY_QUESTION_TYPE_LABEL,
  type surveyQuestionSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { BackButton } from "@/components/ui/back-button";
import { Art } from "@/components/ui/art";
import { Card, SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { AdministrationTag } from "@/components/survey/administration-tag";
import { formatDate } from "@/lib/format";
import {
  ADMINISTRATION_AUTHOR,
  administrationSurveySchema,
  useReadsAdministrationSurveys,
} from "@/lib/administration-surveys";

type Question = z.infer<typeof surveyQuestionSchema>;

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Ноорог",
  PUBLISHED: "Идэвхтэй",
  CLOSED: "Дууссан",
};

/**
 * One of the administration's surveys, read by a teacher — client, 2026-09-17:
 * "ямар судалгаа асуулга авсан, асуултууд болон хэдэн хүүхэд авсан нь харагд".
 *
 * ★ Opening it is what marks it seen. The receipt is posted once the survey has
 * loaded, never before — a teacher whose request failed has not seen anything,
 * and the badge should still say so.
 */
export default function AdministrationSurveyPage() {
  return (
    <RequireRole roles={["TEACHER"]}>
      <AdministrationSurvey />
    </RequireRole>
  );
}

function AdministrationSurvey() {
  const { surveyId } = useParams<{ surveyId: string }>();
  const { enabled } = useReadsAdministrationSurveys();
  const queryClient = useQueryClient();

  const survey = useQuery({
    queryKey: qk.administrationSurvey(surveyId),
    queryFn: () => get(`/surveys/${surveyId}/administration`, administrationSurveySchema),
    enabled,
  });

  const markSeen = useMutation({
    mutationFn: () =>
      mutate(`/surveys/${surveyId}/administration/seen`, z.unknown(), { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["survey-administration"] }),
  });

  const unread = survey.data ? !survey.data.isRead : false;
  const { mutate: markSeenNow, isIdle } = markSeen;
  useEffect(() => {
    if (unread && isIdle) markSeenNow();
  }, [unread, isIdle, markSeenNow]);

  const header = (
    <div className="flex items-center gap-2">
      <BackButton href="/surveys/administration" />
      <h1 className="min-w-0 flex-1 truncate text-title font-semibold text-ink">
        Удирдлагын судалгаа
      </h1>
    </div>
  );

  if (survey.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <LoadingState rows={4} />
      </div>
    );
  }

  if (survey.isError || !survey.data) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <ErrorState description={errorMessage(survey.error)} />
      </div>
    );
  }

  const data = survey.data;
  const share =
    data.expectedCount > 0 ? Math.round((data.respondedCount / data.expectedCount) * 100) : 0;
  const respondents = data.scope === "KINDERGARTEN" ? "эцэг эх" : "хүүхэд";

  return (
    <div className="flex flex-col gap-5">
      {header}

      <Card pad="roomy" className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-card bg-sun"
          >
            <Art name="kindergarten" size={36} className="size-9 object-contain" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="flex flex-wrap items-center gap-2 text-caption font-semibold text-primary">
              <AdministrationTag />
              {ADMINISTRATION_AUTHOR}
            </p>
            <h2 className="text-title font-bold leading-tight text-ink">{data.title}</h2>
            <p className="text-body tabular-nums text-muted">
              {[
                SURVEY_KIND_LABEL[data.kind],
                [data.publishedAt, data.closesAt ?? data.closedAt]
                  .filter(Boolean)
                  .map((value) => formatDate(value as string))
                  .join(" - "),
                STATUS_LABEL[data.status],
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        {data.description?.trim() ? (
          <p className="whitespace-pre-line text-body text-ink">{data.description.trim()}</p>
        ) : null}

        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <Fact label="Хэнд" value={data.group?.name ?? "Бүх бүлэг"} />
          <Fact label="Асуулт" value={`${data.questions.length}`} />
          <Fact
            label="Хариулсан"
            value={`${data.respondedCount} / ${data.expectedCount} ${respondents}`}
            hint={`${share}%`}
            className="col-span-2 sm:col-span-1"
          />
        </dl>
      </Card>

      <section aria-labelledby="administration-questions" className="flex flex-col gap-3">
        <SectionHeader id="administration-questions" title="Асуултууд" />
        <ol className="flex flex-col gap-2.5">
          {data.questions.map((question, index) => (
            <QuestionRow key={question.id} question={question} index={index} />
          ))}
        </ol>
      </section>
    </div>
  );
}

function Fact({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={`rounded-control bg-canvas px-3 py-2 ${className ?? ""}`}>
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-2 text-body font-semibold tabular-nums text-ink">
        <span className="min-w-0 truncate">{value}</span>
        {hint ? <span className="text-caption font-medium text-primary">{hint}</span> : null}
      </dd>
    </div>
  );
}

function QuestionRow({ question, index }: { question: Question; index: number }) {
  const choices = Array.isArray(question.options) ? question.options : null;
  const matrix = question.options && !Array.isArray(question.options) ? question.options : null;

  return (
    <li>
      <Card pad="compact" className="flex gap-3">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-pill bg-primary-soft text-caption font-bold text-primary"
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-ink">
            <span className="sr-only">{index + 1}. </span>
            {question.prompt}
          </p>
          <p className="mt-0.5 text-caption text-muted">
            {SURVEY_QUESTION_TYPE_LABEL[question.type]}
          </p>
          {choices && choices.length > 0 ? (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {choices.map((choice) => (
                <li
                  key={choice}
                  className="rounded-pill bg-canvas px-2.5 py-0.5 text-caption text-ink"
                >
                  {choice}
                </li>
              ))}
            </ul>
          ) : null}
          {matrix ? (
            <p className="mt-1.5 text-caption text-muted">
              {matrix.rows.map((row) => row.label).join(", ")} —{" "}
              {matrix.columns.map((column) => column.label).join(" / ")}
            </p>
          ) : null}
        </div>
      </Card>
    </li>
  );
}
