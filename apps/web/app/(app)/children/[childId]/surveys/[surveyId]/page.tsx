"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { surveySchema, type SurveyAnswerValue } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

const activeSurveysSchema = z.array(surveySchema);

/** A guardian answers one CHILD-scope survey. */
export default function SurveyResponsePage() {
  const toast = useToast();
  const params = useParams<{ childId: string; surveyId: string }>();
  const { childId, surveyId } = params;
  const router = useRouter();
  const queryClient = useQueryClient();

  // The survey's own questions aren't separately readable by a guardian
  // outside the review flow — this list, already scoped to the child, is
  // the one endpoint a parent may call, so the response screen finds its
  // survey there rather than adding a second read path.
  const active = useQuery({
    queryKey: qk.childSurveys(childId),
    queryFn: () => get(`/children/${childId}/surveys`, activeSurveysSchema),
  });

  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue>>({});

  const submit = useMutation({
    mutationFn: () =>
      mutate(`/surveys/${surveyId}/responses`, z.unknown(), {
        method: "POST",
        body: {
          childId,
          answers: Object.entries(answers).map(([questionId, value]) => ({ questionId, value })),
        },
      }),
    onSuccess: () => {
      toast.success("Саналыг хүлээж авлаа. Баярлалаа.");
      void queryClient.invalidateQueries({ queryKey: qk.childSurveys(childId) });
      router.replace(`/children/${childId}/general`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (active.isLoading) return <LoadingState rows={3} />;
  if (active.isError) return <ErrorState description={errorMessage(active.error)} />;

  const survey = active.data!.find((s) => s.id === surveyId);

  if (!survey) {
    return (
      <div className="py-6">
        <ErrorState title="Олдсонгүй" description="Энэ судалгаа олдсонгүй эсвэл хаагдсан байна." />
      </div>
    );
  }

  const unanswered = survey.questions.some((q) => answers[q.id] === undefined);

  return (
    <div className="flex flex-col gap-6 py-2">
      <PageHeader title={survey.title} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!submit.isPending) submit.mutate();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <FormError message={submit.isError ? errorMessage(submit.error) : null} />

        {survey.questions.map((question) => (
          <Card key={question.id} className="flex flex-col gap-3 px-4 py-4">
            <p className="font-medium text-ink">{question.prompt}</p>

            {question.type === "RATING" ? (
              <div role="radiogroup" aria-label={question.prompt} className="flex gap-2">
                {[1, 2, 3, 4, 5].map((value) => {
                  const selected = answers[question.id] === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setAnswers((a) => ({ ...a, [question.id]: value }))}
                      className={cn(
                        "min-h-11 min-w-11 rounded-control border px-3 text-body font-medium transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-ink"
                          : "border-border bg-surface text-muted hover:bg-canvas hover:text-ink",
                      )}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {question.type === "YES_NO" ? (
              <div role="radiogroup" aria-label={question.prompt} className="flex gap-2">
                {[
                  { value: true, label: "Тийм" },
                  { value: false, label: "Үгүй" },
                ].map((opt) => {
                  const selected = answers[question.id] === opt.value;
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setAnswers((a) => ({ ...a, [question.id]: opt.value }))}
                      className={cn(
                        "min-h-11 rounded-control border px-4 text-body font-medium transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-ink"
                          : "border-border bg-surface text-muted hover:bg-canvas hover:text-ink",
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {question.type === "TEXT" ? (
              <Field label="Хариулт">
                {({ id, describedBy }) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    value={(answers[question.id] as string) ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [question.id]: e.target.value }))}
                  />
                )}
              </Field>
            ) : null}

            {question.type === "CHECKBOX" ? (
              <div className="flex flex-col gap-2">
                {stringOptions(question.options).map((option) => {
                  const current = (answers[question.id] as string[]) ?? [];
                  const checked = current.includes(option);
                  return (
                    <Checkbox
                      key={option}
                      label={option}
                      checked={checked}
                      onChange={(e) =>
                        setAnswers((a) => ({
                          ...a,
                          [question.id]: e.target.checked
                            ? [...current, option]
                            : current.filter((o) => o !== option),
                        }))
                      }
                    />
                  );
                })}
              </div>
            ) : null}

            {/*
              A matrix — RFP Module 1.1.

              ★ One radio group per row, not a `<table>`. On a phone a seven by
              five grid is either unreadable or scrolled sideways, and the thing
              a table buys — comparing columns down the page — is not what a
              parent does here. Stacked groups read the same at every width.
            */}
            {question.type === "MATRIX" ? (
              <div className="flex flex-col gap-3">
                {matrixShape(question.options)?.rows.map((row) => {
                  const current = (answers[question.id] as Record<string, number>) ?? {};

                  return (
                    <fieldset key={row.key} className="flex flex-col gap-1.5">
                      <legend className="text-body text-ink">{row.label}</legend>
                      <div className="flex flex-wrap gap-2">
                        {matrixShape(question.options)?.columns.map((column) => {
                          const selected = current[row.key] === column.value;

                          return (
                            <button
                              key={column.value}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() =>
                                setAnswers((a) => ({
                                  ...a,
                                  [question.id]: { ...current, [row.key]: column.value },
                                }))
                              }
                              className={cn(
                                "min-h-11 rounded-control border px-3.5 text-body transition-colors",
                                selected
                                  ? "border-primary bg-primary text-primary-ink"
                                  : "border-border bg-surface text-muted hover:bg-canvas hover:text-ink",
                              )}
                            >
                              {column.label}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            ) : null}
          </Card>
        ))}

        <Button type="submit" size="lg" disabled={submit.isPending || unanswered}>
          {submit.isPending ? "Илгээж байна…" : "Илгээх"}
        </Button>
      </form>
    </div>
  );
}

/**
 * `options` is a union — a CHECKBOX's strings or a MATRIX's shape.
 *
 * Narrowed through these two helpers rather than cast, so a question whose
 * type and options disagree renders nothing instead of throwing. The column is
 * `Json` in the database; a hand-edited row can hold anything.
 */
function stringOptions(options: unknown): string[] {
  return Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : [];
}

function matrixShape(
  options: unknown,
): { rows: { key: string; label: string }[]; columns: { value: number; label: string }[] } | null {
  if (typeof options !== "object" || options === null || Array.isArray(options)) return null;

  const { rows, columns } = options as { rows?: unknown; columns?: unknown };
  if (!Array.isArray(rows) || !Array.isArray(columns)) return null;

  return {
    rows: rows.filter(
      (r): r is { key: string; label: string } =>
        typeof r?.key === "string" && typeof r?.label === "string",
    ),
    columns: columns.filter(
      (c): c is { value: number; label: string } =>
        typeof c?.value === "number" && typeof c?.label === "string",
    ),
  };
}
