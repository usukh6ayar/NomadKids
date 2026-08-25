"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { surveyResultsSchema, surveySchema, type SurveyQuestionType } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";

type DraftQuestion = {
  order: number;
  type: SurveyQuestionType;
  prompt: string;
  optionsText: string;
};

const TYPE_LABEL: Record<SurveyQuestionType, string> = {
  RATING: "Үнэлгээ (1–5)",
  YES_NO: "Тийм/Үгүй",
  TEXT: "Чөлөөт бичвэр",
  CHECKBOX: "Олон сонголт",
};

export default function SurveyDetailPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <SurveyDetail />
    </RequireRole>
  );
}

function SurveyDetail() {
  const params = useParams<{ surveyId: string }>();
  const surveyId = params.surveyId;
  const queryClient = useQueryClient();

  const survey = useQuery({
    queryKey: qk.survey(surveyId),
    queryFn: () => get(`/surveys/${surveyId}`, surveySchema),
  });

  if (survey.isLoading) return <LoadingState rows={4} />;
  if (survey.isError) return <ErrorState description={errorMessage(survey.error)} />;

  const data = survey.data!;

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title={data.title}
        lede={data.description ?? undefined}
        actions={
          data.status === "DRAFT" ? (
            <PublishButton surveyId={surveyId} />
          ) : data.status === "PUBLISHED" ? (
            <CloseButton surveyId={surveyId} />
          ) : null
        }
      />

      {data.status === "DRAFT" ? (
        <QuestionEditor
          surveyId={surveyId}
          initialQuestions={data.questions}
          onSaved={() =>
            void queryClient.invalidateQueries({ queryKey: qk.survey(surveyId) })
          }
        />
      ) : (
        <Results surveyId={surveyId} />
      )}
    </div>
  );
}

function PublishButton({ surveyId }: { surveyId: string }) {
  const router = useRouter();
  const publish = useMutation({
    mutationFn: () => mutate(`/surveys/${surveyId}/publish`, surveySchema, { method: "POST" }),
    onSuccess: () => router.refresh(),
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate()}>
        {publish.isPending ? "Нийтэлж байна…" : "Нийтлэх"}
      </Button>
      {publish.isError ? (
        <p className="text-caption text-danger">{errorMessage(publish.error)}</p>
      ) : null}
    </div>
  );
}

function CloseButton({ surveyId }: { surveyId: string }) {
  const router = useRouter();
  const close = useMutation({
    mutationFn: () => mutate(`/surveys/${surveyId}/close`, surveySchema, { method: "POST" }),
    onSuccess: () => router.refresh(),
  });

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={close.isPending}
      onClick={() => close.mutate()}
    >
      {close.isPending ? "Хааж байна…" : "Хаах"}
    </Button>
  );
}

function QuestionEditor({
  surveyId,
  initialQuestions,
  onSaved,
}: {
  surveyId: string;
  initialQuestions: { order: number; type: SurveyQuestionType; prompt: string; options?: string[] | null }[];
  onSaved: () => void;
}) {
  const [questions, setQuestions] = useState<DraftQuestion[]>(() =>
    initialQuestions.length > 0
      ? initialQuestions
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((q) => ({
            order: q.order,
            type: q.type,
            prompt: q.prompt,
            optionsText: (q.options ?? []).join(", "),
          }))
      : [{ order: 0, type: "RATING", prompt: "", optionsText: "" }],
  );

  const save = useMutation({
    mutationFn: () =>
      mutate(`/surveys/${surveyId}/questions`, surveySchema, {
        method: "PUT",
        body: {
          questions: questions.map((q, index) => ({
            order: index,
            type: q.type,
            prompt: q.prompt,
            options:
              q.type === "CHECKBOX"
                ? q.optionsText
                    .split(",")
                    .map((o) => o.trim())
                    .filter(Boolean)
                : undefined,
          })),
        },
      }),
    onSuccess: onSaved,
  });

  function update(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((current) => current.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  return (
    <section aria-labelledby="questions-heading">
      <SectionHeader id="questions-heading" title="Асуултууд" />

      <div className="flex flex-col gap-3">
        {questions.map((question, index) => (
          <Card key={index} className="flex flex-col gap-3 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
              <Field label={`Асуулт ${index + 1}`}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={question.prompt}
                    onChange={(e) => update(index, { prompt: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Төрөл">
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={question.type}
                    onChange={(e) => update(index, { type: e.target.value as SurveyQuestionType })}
                  >
                    {Object.entries(TYPE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            {question.type === "CHECKBOX" ? (
              <Field label="Сонголтууд" hint="Таслалаар тусгаарлана.">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={question.optionsText}
                    onChange={(e) => update(index, { optionsText: e.target.value })}
                    placeholder="Улаан, Ногоон, Хөх"
                  />
                )}
              </Field>
            ) : null}

            {questions.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setQuestions((current) => current.filter((_, i) => i !== index))}
              >
                Устгах
              </Button>
            ) : null}
          </Card>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setQuestions((current) => [
              ...current,
              { order: current.length, type: "RATING", prompt: "", optionsText: "" },
            ])
          }
        >
          Асуулт нэмэх
        </Button>
      </div>

      <FormError message={save.isError ? errorMessage(save.error) : null} />

      <div className="mt-4">
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
        </Button>
      </div>
    </section>
  );
}

function Results({ surveyId }: { surveyId: string }) {
  const results = useQuery({
    queryKey: qk.surveyResults(surveyId),
    queryFn: () => get(`/surveys/${surveyId}/results`, surveyResultsSchema),
  });

  if (results.isLoading) return <LoadingState rows={3} />;
  if (results.isError) return <ErrorState description={errorMessage(results.error)} />;

  const data = results.data!;

  return (
    <section aria-labelledby="results-heading">
      <SectionHeader
        id="results-heading"
        title="Хариултууд"
        action={<span className="text-body text-muted">{data.totalResponses} хариулт</span>}
      />

      <div className="flex flex-col gap-3">
        {data.questions.map((q) => (
          <Card key={q.question.id} className="flex flex-col gap-2 px-4 py-4">
            <p className="font-medium text-ink">{q.question.prompt}</p>
            <p className="text-caption text-muted">{q.responseCount} хариулсан</p>

            {q.counts ? (
              <div className="flex flex-wrap gap-2">
                {Object.entries(q.counts).map(([key, count]) => (
                  <Badge key={key} tone="sky">
                    {key}: {count}
                  </Badge>
                ))}
              </div>
            ) : null}

            {q.responses ? (
              <ul className="flex flex-col gap-1.5">
                {q.responses.map((text, i) => (
                  <li key={i} className="rounded-control bg-canvas px-3 py-2 text-body text-ink">
                    {text}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ))}
      </div>
    </section>
  );
}
