"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  surveyResultsSchema,
  surveySchema,
  SURVEY_PERIOD_LABEL,
  type MatrixOptions,
  type SurveyQuestionType,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { SurveyComparison } from "@/components/survey/survey-comparison";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";

type DraftQuestion = {
  order: number;
  type: SurveyQuestionType;
  prompt: string;
  /** CHECKBOX's choices, comma separated. */
  optionsText: string;
  /** MATRIX's rows, one per line as `key: Шошго`. */
  rowsText: string;
  /** MATRIX's columns, comma separated as `1=Сул`. */
  columnsText: string;
  indicatorKey: string;
};

const TYPE_LABEL: Record<SurveyQuestionType, string> = {
  RATING: "Үнэлгээ (1–5)",
  YES_NO: "Тийм/Үгүй",
  TEXT: "Чөлөөт бичвэр",
  CHECKBOX: "Олон сонголт",
  MATRIX: "Матриц (олон үзүүлэлт)",
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
          <div className="flex flex-wrap items-center gap-2">
            {data.status !== "DRAFT" ? (
              <>
                <ExportButton surveyId={surveyId} />
                <CloneButton surveyId={surveyId} schoolYear={data.schoolYear ?? null} />
              </>
            ) : null}
            {data.status === "DRAFT" ? (
              <PublishButton surveyId={surveyId} />
            ) : data.status === "PUBLISHED" ? (
              <CloseButton surveyId={surveyId} />
            ) : null}
          </div>
        }
      />

      {data.status === "DRAFT" ? (
        <QuestionEditor
          surveyId={surveyId}
          initialQuestions={data.questions}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: qk.survey(surveyId) })}
        />
      ) : (
        <>
          <Results surveyId={surveyId} />
          {/*
            Shown once a survey has answers, because that is when a comparison
            can mean anything. It reports its own "no baseline" state rather
            than being hidden — an administrator who set up two waves and sees
            nothing needs to be told why.
          */}
          <SurveyComparison surveyId={surveyId} />
        </>
      )}
    </div>
  );
}

/**
 * The five-sheet workbook — RFP Module 1.3.
 *
 * A link, not a fetch: the session cookie rides along on a navigation and the
 * browser handles the download itself. `download` is deliberately absent — the
 * server sends the Mongolian filename in `Content-Disposition`, and setting it
 * here would override that with the URL's last segment.
 */
function ExportButton({ surveyId }: { surveyId: string }) {
  return (
    <Button asChild size="sm" variant="secondary">
      <a href={downloadUrl(`/surveys/${surveyId}/export`)}>Excel татах</a>
    </Button>
  );
}

/**
 * Copies the survey into the next wave — RFP Module 1.2.
 *
 * ★ This is how the comparison becomes possible. Retyping the questions in May
 * makes a survey that only looks like September's — different rows, no shared
 * indicator keys, nothing to pair.
 */
function CloneButton({ surveyId, schoolYear }: { surveyId: string; schoolYear: string | null }) {
  const router = useRouter();
  const [period, setPeriod] = useState<"MIDLINE" | "ENDLINE">("ENDLINE");

  const clone = useMutation({
    mutationFn: () =>
      mutate(`/surveys/${surveyId}/clone`, surveySchema, {
        method: "POST",
        body: { period, schoolYear },
      }),
    onSuccess: (created) => router.push(`/surveys/${created.id}`),
  });

  return (
    <div className="flex items-center gap-1.5">
      <label className="sr-only" htmlFor="clone-period">
        Хувилах үе
      </label>
      <Select
        id="clone-period"
        value={period}
        onChange={(e) => setPeriod(e.target.value as "MIDLINE" | "ENDLINE")}
        className="w-auto"
      >
        <option value="MIDLINE">{SURVEY_PERIOD_LABEL.MIDLINE}</option>
        <option value="ENDLINE">{SURVEY_PERIOD_LABEL.ENDLINE}</option>
      </Select>
      <Button
        size="sm"
        variant="secondary"
        disabled={clone.isPending}
        onClick={() => clone.mutate()}
      >
        {clone.isPending ? "Хувилж байна…" : "Хувилах"}
      </Button>
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
    <Button size="sm" variant="secondary" disabled={close.isPending} onClick={() => close.mutate()}>
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
  initialQuestions: {
    order: number;
    type: SurveyQuestionType;
    prompt: string;
    options?: string[] | MatrixOptions | null;
    indicatorKey?: string | null;
  }[];
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
            optionsText: Array.isArray(q.options) ? q.options.join(", ") : "",
            rowsText: isMatrix(q.options)
              ? q.options.rows.map((r) => `${r.key}: ${r.label}`).join("\n")
              : "",
            columnsText: isMatrix(q.options)
              ? q.options.columns.map((c) => `${c.value}=${c.label}`).join(", ")
              : "",
            indicatorKey: q.indicatorKey ?? "",
          }))
      : [BLANK_QUESTION],
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
                : q.type === "MATRIX"
                  ? { rows: parseRows(q.rowsText), columns: parseColumns(q.columnsText) }
                  : undefined,
            // Empty means "not comparable" — the honest answer for a one-off
            // poll question, and what the API stores as null.
            indicatorKey: q.indicatorKey.trim() || null,
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

            {/*
              A matrix — RFP Module 1.1.

              ★ Rows carry a stable `key` beside their label. The key is what an
              answer is stored against and what next year's comparison pairs on,
              so fixing a typo in the label must not orphan the answers already
              given. Typed as `key: Шошго`, one per line.
            */}
            {question.type === "MATRIX" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Мөрүүд"
                  hint="Мөр бүрд нэг: түлхүүр: шошго. Түлхүүр латинаар, жилээс жилд өөрчлөгдөхгүй."
                >
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      rows={4}
                      value={question.rowsText}
                      onChange={(e) => update(index, { rowsText: e.target.value })}
                      placeholder={"speech: Хэл яриа\nmotor: Бие бялдар"}
                    />
                  )}
                </Field>
                <Field label="Багана (үнэлгээ)" hint="Таслалаар: оноо=шошго.">
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      rows={4}
                      value={question.columnsText}
                      onChange={(e) => update(index, { columnsText: e.target.value })}
                      placeholder="1=Сул, 3=Дунд, 5=Сайн"
                    />
                  )}
                </Field>
              </div>
            ) : null}

            {/*
              ★ The field that makes Module 1.2 possible at all.

              Editing a draft's questions deletes and recreates every row, so
              the pairing between September and May cannot rest on a question
              id. This key travels through an edit and through a clone, and is
              what says "these two questions measure the same thing".
            */}
            {question.type !== "TEXT" ? (
              <Field
                label="Үзүүлэлтийн түлхүүр"
                hint="Жил бүрийн харьцуулалтад хэрэглэнэ. Хоосон бол харьцуулагдахгүй."
              >
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={question.indicatorKey}
                    onChange={(e) => update(index, { indicatorKey: e.target.value })}
                    placeholder="social_skills"
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
            setQuestions((current) => [...current, { ...BLANK_QUESTION, order: current.length }])
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

const BLANK_QUESTION: DraftQuestion = {
  order: 0,
  type: "RATING",
  prompt: "",
  optionsText: "",
  rowsText: "",
  columnsText: "",
  indicatorKey: "",
};

function isMatrix(options: unknown): options is MatrixOptions {
  return (
    typeof options === "object" &&
    options !== null &&
    !Array.isArray(options) &&
    Array.isArray((options as MatrixOptions).rows)
  );
}

/** `speech: Хэл яриа`, one per line. A line with no colon is skipped. */
function parseRows(text: string): { key: string; label: string }[] {
  return text
    .split("\n")
    .map((line) => {
      const at = line.indexOf(":");
      if (at === -1) return null;

      const key = line.slice(0, at).trim();
      const label = line.slice(at + 1).trim();

      return key && label ? { key, label } : null;
    })
    .filter((row): row is { key: string; label: string } => row !== null);
}

/** `1=Сул, 3=Дунд, 5=Сайн`. */
function parseColumns(text: string): { value: number; label: string }[] {
  return text
    .split(",")
    .map((part) => {
      const at = part.indexOf("=");
      if (at === -1) return null;

      const value = Number(part.slice(0, at).trim());
      const label = part.slice(at + 1).trim();

      return Number.isFinite(value) && label ? { value, label } : null;
    })
    .filter((column): column is { value: number; label: string } => column !== null);
}
