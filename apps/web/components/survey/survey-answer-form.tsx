"use client";

import type { Dispatch, SetStateAction } from "react";
import type { SurveyAnswerValue, SurveyQuestion } from "@kinder/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Textarea } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { cn } from "@/lib/utils";

/**
 * A questionnaire, filled in — one card per question and a submit button.
 *
 * ★ Lifted out of the family's answering page on 2026-09-21, when a teacher
 * began filling in surveys too ("Багшийн судалгаа"). The client asked for the
 * two to look alike, and one renderer is how that stays true: a question type
 * learned here is learned by both. The caller owns the answers and the
 * request; this owns only how a question is drawn and when "Илгээх" is live.
 */
export function SurveyAnswerForm({
  questions,
  answers,
  onAnswers,
  pending,
  error,
  onSubmit,
  submitLabel = "Илгээх",
}: {
  questions: SurveyQuestion[];
  answers: Record<string, SurveyAnswerValue>;
  onAnswers: Dispatch<SetStateAction<Record<string, SurveyAnswerValue>>>;
  pending: boolean;
  error: string | null;
  onSubmit: () => void;
  submitLabel?: string;
}) {
  const unanswered = questions.some((q) => answers[q.id] === undefined);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) onSubmit();
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <FormError message={error} />

      {questions.map((question) => (
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
                    onClick={() => onAnswers((a) => ({ ...a, [question.id]: value }))}
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
                    onClick={() => onAnswers((a) => ({ ...a, [question.id]: opt.value }))}
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
                  onChange={(e) => onAnswers((a) => ({ ...a, [question.id]: e.target.value }))}
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
                    onClick={() => onAnswers((a) => ({ ...a, [question.id]: option }))}
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
                      onAnswers((a) => ({
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
                              onAnswers((a) => ({
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

      <Button type="submit" size="lg" disabled={pending || unanswered}>
        {pending ? "Илгээж байна…" : submitLabel}
      </Button>
    </form>
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
