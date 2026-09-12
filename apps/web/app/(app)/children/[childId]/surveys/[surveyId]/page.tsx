"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { z } from "zod";
import { surveySchema, type SurveyAnswerValue } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PollAnswer } from "@/components/survey/poll-answer";
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
  /**
   * The question order this family sees — see `ordered` below.
   *
   * A `useMemo` keyed on the survey rather than `useState`, because the survey
   * arrives after the first render: state initialised from it would be empty
   * and never refill.
   */
  const shuffled = useMemo(() => {
    const questions = active.data?.find((s) => s.id === surveyId)?.questions ?? [];
    if (!questions.length) return questions;

    const found = active.data?.find((s) => s.id === surveyId);
    if (!found?.shuffleQuestions) return questions;

    const copy = [...questions];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }, [active.data, surveyId]);

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
      /*
        ★ The survey's own closing note, when it wrote one.

        A kindergarten that wants to say what happens next — "Хариултыг 9-р
        сарын 20-нд хэлэлцэнэ" — writes it on the survey rather than in the
        description, where a family would read it *before* answering instead of
        after. Null falls back to the product's own thank-you, which is what
        every survey written before the field says.
      */
      toast.success(survey?.closingNote?.trim() || "Саналыг хүлээж авлаа. Баярлалаа.");
      void queryClient.invalidateQueries({ queryKey: qk.childSurveys(childId) });
      /*
        ★ Back to the family's own surveys, not the child's record — 2026-09-12,
        at the client's request: "хүүхдийн дэлгэрэнгүй рүү үсэрч байна, ингэж
        болохгүй, миний судалгаанууд руу ор."

        A parent answering one survey is working through a list of them. Landing
        on the child's profile ends that errand and makes finding the next one a
        navigation problem; the list they came from has the next one on it, now
        marked answered.
      */
      router.replace(`/children/${childId}/surveys`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /*
    ★ A way out, on every branch — 2026-09-12, at the client's request: "эцэг эх
    асуулгад хариулсны дараа гарч болохгүй байна."

    A poll is one tap; the screen it leaves behind showed the class's answer and
    no exit at all, so a parent's only way back was the browser's own button —
    which this product does not rely on anywhere else. The two other branches
    were no better: a survey that could not be found was a dead end too.

    `BackButton` goes one step back through history, with the family's own
    survey list as the fallback for a page opened from a notification link.
  */
  const back = <BackButton href={`/children/${childId}/surveys`} />;

  if (active.isLoading) {
    return (
      <div className="flex flex-col gap-4 py-2">
        {back}
        <LoadingState rows={3} />
      </div>
    );
  }

  if (active.isError) {
    return (
      <div className="flex flex-col gap-4 py-2">
        {back}
        <ErrorState description={errorMessage(active.error)} />
      </div>
    );
  }

  const survey = active.data!.find((s) => s.id === surveyId);

  if (!survey) {
    return (
      <div className="flex flex-col gap-4 py-2">
        {back}
        <ErrorState title="Олдсонгүй" description="Энэ судалгаа олдсонгүй эсвэл хаагдсан байна." />
      </div>
    );
  }

  /*
    ★ A poll is a different screen, not a form with fewer fields — 2026-09-10,
    at the client's request.

    `PollAnswer` explains why in full: a form is filled in and submitted, a
    poll is one tap that submits and answers back with where the class stands.
    Routed here rather than inside the form so the form below keeps exactly one
    interaction model.
  */
  if (survey.kind === "POLL") {
    return (
      <div className="flex flex-col gap-6 py-2">
        {back}
        <PageHeader title={survey.title} />
        <PollAnswer survey={survey} childId={childId} />
      </div>
    );
  }

  const unanswered = survey.questions.some((q) => answers[q.id] === undefined);

  /*
    ★ Shuffled once per mount, not on every render.

    Order effects are real — the first question of a satisfaction survey is
    answered more generously than the fifth — and `shuffleQuestions` is the
    author saying theirs is the kind that can bear reordering. Reshuffling as
    the form re-renders (which it does on every keystroke) would move questions
    under the reader's hand, so the order is fixed the first time and kept.

    Seeded by nothing in particular: the point is that the order differs
    between families, not that it is reproducible.
  */
  const ordered = shuffled;

  return (
    <div className="flex flex-col gap-6 py-2">
      {back}
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

        {ordered.map((question) => (
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

            {/*
              ★ SINGLE_CHOICE, which this form did not render at all.

              The type has existed since 2026-08-31 and every other surface
              knows it — the composer offers it, `survey-scoring.ts` scores it,
              the API validates it — but the answering form stopped at
              CHECKBOX. A "Нэг сонголт" question therefore drew its prompt and
              no controls, and because `unanswered` counts questions with no
              answer, the submit button stayed disabled for ever: the family
              could neither answer it nor send the rest of the form.

              A radio group rather than checkboxes with a rule, so the "exactly
              one" the type promises is what the control physically permits.
            */}
            {question.type === "SINGLE_CHOICE" ? (
              <div role="radiogroup" aria-label={question.prompt} className="flex flex-col gap-2">
                {stringOptions(question.options).map((option) => {
                  const selected = answers[question.id] === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setAnswers((a) => ({ ...a, [question.id]: option }))}
                      className={cn(
                        "min-h-11 rounded-control border px-3.5 text-left text-body transition-colors",
                        selected
                          ? "border-primary bg-primary-soft font-medium text-primary"
                          : "border-border bg-surface text-ink hover:bg-canvas",
                      )}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
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
