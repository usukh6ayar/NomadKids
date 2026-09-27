"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { uuidSchema, type SurveyAnswerValue, type SurveyQuestion } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/ui/states";
import { shortName } from "@/lib/format";
import { cn } from "@/lib/utils";

export const teacherSheetRowSchema = z.object({
  child: z.object({ id: uuidSchema, firstName: z.string(), lastName: z.string().nullish() }),
  group: z.object({ id: uuidSchema, name: z.string() }).nullish(),
  response: z
    .object({
      id: uuidSchema,
      submittedAt: z.string(),
      respondent: z.object({ id: uuidSchema, lastName: z.string(), firstName: z.string() }),
      answers: z.array(z.object({ questionId: uuidSchema, value: z.unknown() })),
    })
    .nullable(),
});

export type TeacherSheetRow = z.infer<typeof teacherSheetRowSchema>;

type Answers = Record<string, Record<string, SurveyAnswerValue>>;

const SAVE_CHUNK = 10;

/** A column of the table — what one radio (or checkbox) in a row stands for. */
type Column = { key: string; label: string; value: SurveyAnswerValue };

function answersFromRows(rows: TeacherSheetRow[]): Answers {
  return Object.fromEntries(
    rows.map((row) => [
      row.child.id,
      Object.fromEntries(
        (row.response?.answers ?? []).map((answer) => [
          answer.questionId,
          answer.value as SurveyAnswerValue,
        ]),
      ),
    ]),
  );
}

/** `Б.Ану` — the register's own short form (`shortName`), client 2026-09-21. */
function childName(row: TeacherSheetRow) {
  return shortName(row.child);
}

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

/** The choices a question offers, as columns — null for the free-text type. */
function columnsFor(question: SurveyQuestion): Column[] | null {
  switch (question.type) {
    case "RATING":
      return [1, 2, 3, 4, 5].map((value) => ({ key: String(value), label: String(value), value }));
    case "YES_NO":
      return [
        { key: "true", label: "Тийм", value: true },
        { key: "false", label: "Үгүй", value: false },
      ];
    case "SINGLE_CHOICE":
    case "CHECKBOX":
      return stringOptions(question.options).map((option) => ({
        key: option,
        label: option,
        value: option,
      }));
    default:
      return null;
  }
}

/** Every question has an answer — a matrix only when every one of its rows does. */
function isComplete(questions: SurveyQuestion[], answers: Record<string, SurveyAnswerValue>) {
  return questions.every((question) => {
    const value = answers[question.id];
    if (value === undefined) return false;
    if (question.type === "MATRIX") {
      const shape = matrixShape(question.options);
      const cells = value as Record<string, number>;
      return (shape?.rows ?? []).every((row) => cells[row.key] !== undefined);
    }
    if (question.type === "CHECKBOX") return (value as string[]).length > 0;
    if (question.type === "TEXT") return String(value).trim().length > 0;
    return true;
  });
}

/**
 * "Багшийн судалгаа", filled in as a table — client, 2026-09-21: a row per
 * child, a column per choice, one tap per cell.
 *
 * ★ One table per question rather than one table for the whole survey. A
 * survey is several questions and each has its own set of choices; putting
 * them side by side would make a grid too wide for a phone, and the teacher
 * would lose which column belongs to which question. Stacked, each table
 * reads like the client's drawing: names down the left, the choices across.
 *
 * ★★ Saved whole, only the rows that changed, and a changed row must be
 * complete. A child half-filled in would otherwise be recorded as answered
 * and counted in every average with holes in it — the server keeps one
 * response per child, so the client sends a child only when their row is done.
 */
export function TeacherSheet({
  surveyId,
  questions,
  rows,
  editable,
}: {
  surveyId: string;
  questions: SurveyQuestion[];
  rows: TeacherSheetRow[];
  editable: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [savedAnswers] = useState<Answers>(() => answersFromRows(rows));
  const [answers, setAnswers] = useState<Answers>(() => answersFromRows(rows));
  const [changed, setChanged] = useState<Set<string>>(new Set());

  const updateCell = (
    childId: string,
    questionId: string,
    value: SurveyAnswerValue | undefined,
  ) => {
    const childAnswers = { ...(answers[childId] ?? {}) };
    if (value === undefined) delete childAnswers[questionId];
    else childAnswers[questionId] = value;

    setAnswers((current) => ({ ...current, [childId]: childAnswers }));
    const isBackToSaved = questions.every(
      (question) =>
        JSON.stringify(childAnswers[question.id]) ===
        JSON.stringify(savedAnswers[childId]?.[question.id]),
    );
    setChanged((current) => {
      const next = new Set(current);
      if (isBackToSaved) next.delete(childId);
      else next.add(childId);
      return next;
    });
  };

  const setCell = (childId: string, questionId: string, value: SurveyAnswerValue) =>
    updateCell(childId, questionId, value);
  const clearCell = (childId: string, questionId: string) =>
    updateCell(childId, questionId, undefined);

  const changedRows = rows.filter((row) => changed.has(row.child.id));
  const incomplete = changedRows.filter(
    (row) => !isComplete(questions, answers[row.child.id] ?? {}),
  );

  /*
    ★ Ten children per request — 2026-09-21, for the А/79 form.

    Its fourth level is 49 questions; a whole group of forty in one body is
    past the API's 100 KB JSON limit. Each chunk is its own transaction, so a
    failure part-way leaves the chunks before it saved — and marked saved here
    — and the rest still marked changed for the next press.
  */
  const save = useMutation({
    mutationFn: async () => {
      let saved = 0;
      for (let start = 0; start < changedRows.length; start += SAVE_CHUNK) {
        const chunk = changedRows.slice(start, start + SAVE_CHUNK);
        const result = await mutate(
          `/surveys/${surveyId}/teacher-sheet`,
          z.object({ saved: z.number() }),
          {
            method: "PUT",
            body: {
              responses: chunk.map((row) => ({
                childId: row.child.id,
                answers: questions.map((question) => ({
                  questionId: question.id,
                  value: answers[row.child.id]![question.id],
                })),
              })),
            },
          },
        );
        saved += result.saved;
        setChanged((current) => {
          const next = new Set(current);
          for (const row of chunk) next.delete(row.child.id);
          return next;
        });
      }
      return saved;
    },
    onSuccess: (saved) => {
      toast.success(`${saved} хүүхдийн судалгаа хадгалагдлаа.`);
      // Reloads the sheet too (`["survey", id, "teacher-sheet"]`). Not on an
      // error: that would remount the table and drop the rows not yet saved.
      void queryClient.invalidateQueries({ queryKey: ["survey", surveyId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["surveys", surveyId] });
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending && changedRows.length > 0 && incomplete.length === 0) save.mutate();
      }}
      noValidate
    >
      <FormError message={save.isError ? errorMessage(save.error) : null} />

      {questions.map((question, index) => {
        const title = `${index + 1}. ${question.prompt}`;
        if (question.type === "MATRIX") {
          const shape = matrixShape(question.options);
          return (
            <Card key={question.id} pad="compact" className="flex flex-col gap-3">
              <p className="font-semibold text-ink">{title}</p>
              {(shape?.rows ?? []).map((matrixRow) => (
                <SheetTable
                  key={matrixRow.key}
                  caption={matrixRow.label}
                  rows={rows}
                  columns={(shape?.columns ?? []).map((c) => ({
                    key: String(c.value),
                    label: c.label,
                    value: c.value,
                  }))}
                  isSelected={(childId, column) =>
                    (answers[childId]?.[question.id] as Record<string, number> | undefined)?.[
                      matrixRow.key
                    ] === column.value
                  }
                  onSelect={(childId, column) =>
                    setCell(childId, question.id, {
                      ...((answers[childId]?.[question.id] as Record<string, number>) ?? {}),
                      [matrixRow.key]: column.value as number,
                    })
                  }
                  onClear={(childId) => {
                    const remaining = {
                      ...((answers[childId]?.[question.id] as Record<string, number>) ?? {}),
                    };
                    delete remaining[matrixRow.key];
                    if (Object.keys(remaining).length === 0) clearCell(childId, question.id);
                    else setCell(childId, question.id, remaining);
                  }}
                  name={`${question.id}-${matrixRow.key}`}
                  editable={editable}
                />
              ))}
            </Card>
          );
        }

        const columns = columnsFor(question);
        return (
          <Card key={question.id} pad="compact" className="flex flex-col gap-3">
            <p className="font-semibold text-ink">{title}</p>
            {columns === null ? (
              <TextTable
                rows={rows}
                value={(childId) => (answers[childId]?.[question.id] as string) ?? ""}
                onChange={(childId, value) => setCell(childId, question.id, value)}
                editable={editable}
              />
            ) : (
              <SheetTable
                rows={rows}
                columns={columns}
                multiple={question.type === "CHECKBOX"}
                isSelected={(childId, column) => {
                  const value = answers[childId]?.[question.id];
                  return question.type === "CHECKBOX"
                    ? ((value as string[] | undefined) ?? []).includes(column.value as string)
                    : value === column.value;
                }}
                onSelect={(childId, column) => {
                  if (question.type !== "CHECKBOX") {
                    setCell(childId, question.id, column.value);
                    return;
                  }
                  const current = (answers[childId]?.[question.id] as string[] | undefined) ?? [];
                  const option = column.value as string;
                  setCell(
                    childId,
                    question.id,
                    current.includes(option)
                      ? current.filter((o) => o !== option)
                      : [...current, option],
                  );
                }}
                onClear={(childId) => clearCell(childId, question.id)}
                name={question.id}
                editable={editable}
              />
            )}
          </Card>
        );
      })}

      <Totals questions={questions} rows={rows} answers={answers} />

      {editable ? (
        <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-card border border-border bg-surface p-3 shadow-lg sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-caption text-muted">
            {incomplete.length > 0
              ? `Дутуу: ${incomplete.map(childName).join(", ")} — бүх асуултад хариулна уу.`
              : changedRows.length > 0
                ? `${changedRows.length} хүүхдийн өөрчлөлт хадгалагдаагүй байна.`
                : "Хүүхэд бүрийн мөрөнд сонголтоо тэмдэглэнэ үү."}
          </p>
          <Button
            type="submit"
            disabled={save.isPending || changedRows.length === 0 || incomplete.length > 0}
          >
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/**
 * Names down the left, one column per choice — the client's drawing.
 *
 * ★ Native radios, one group per child per question (`name`), so the arrow
 * keys, a screen reader and "exactly one" all come from the browser. The name
 * column sticks while a wide set of choices scrolls sideways on a phone.
 */
function SheetTable({
  caption,
  rows,
  columns,
  isSelected,
  onSelect,
  onClear,
  name,
  editable,
  multiple = false,
}: {
  caption?: string;
  rows: TeacherSheetRow[];
  columns: Column[];
  isSelected: (childId: string, column: Column) => boolean;
  onSelect: (childId: string, column: Column) => void;
  onClear: (childId: string) => void;
  name: string;
  editable: boolean;
  multiple?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-control border border-border">
      <table className="w-full border-collapse text-body">
        {caption ? (
          <caption className="bg-canvas px-3 py-2 text-left text-caption font-semibold text-ink">
            {caption}
          </caption>
        ) : null}
        <thead>
          <tr className="bg-canvas">
            <th
              scope="col"
              className="sticky left-0 z-[1] min-w-[140px] bg-canvas px-3 py-2.5 text-left text-caption font-semibold text-muted"
            >
              Хүүхдийн нэр
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="min-w-[64px] px-2 py-2.5 text-center text-caption font-semibold text-ink"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const who = childName(row);
            return (
              <tr key={row.child.id} className="border-t border-border-soft">
                <th
                  scope="row"
                  className="sticky left-0 z-[1] bg-surface px-3 py-2.5 text-left font-normal text-ink"
                >
                  {who}
                </th>
                {columns.map((column) => (
                  <td key={column.key} className="px-2 py-2.5 text-center">
                    <input
                      type={multiple ? "checkbox" : "radio"}
                      name={`${name}-${row.child.id}`}
                      aria-label={`${who}: ${column.label}`}
                      checked={isSelected(row.child.id, column)}
                      onClick={(event) => {
                        if (!multiple && isSelected(row.child.id, column)) {
                          event.preventDefault();
                          onClear(row.child.id);
                        }
                      }}
                      onChange={() => onSelect(row.child.id, column)}
                      disabled={!editable}
                      className={cn(
                        "size-5 cursor-pointer accent-primary align-middle disabled:cursor-default",
                        multiple ? "rounded" : "",
                      )}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A SINGLE_CHOICE question whose every option is a number — its scale. */
function numericScale(question: SurveyQuestion): number[] | null {
  if (question.type !== "SINGLE_CHOICE") return null;
  const options = stringOptions(question.options);
  const numbers = options.map((option) => (/^-?\d+$/.test(option.trim()) ? Number(option) : NaN));
  return options.length > 0 && numbers.every(Number.isFinite) ? numbers : null;
}

/**
 * "Нийт" — each child's score, the А/79 form's own last row. Client,
 * 2026-09-21.
 *
 * ★ Counted over the questions with a numeric scale only (0 / 1, 1–3), and
 * live, from what is on screen — the teacher sees the total move as they
 * mark. A child with nothing marked yet shows "—" rather than 0, which would
 * read as a result.
 */
function Totals({
  questions,
  rows,
  answers,
}: {
  questions: SurveyQuestion[];
  rows: TeacherSheetRow[];
  answers: Answers;
}) {
  const scored = questions
    .map((question) => ({ question, scale: numericScale(question) }))
    .filter((entry): entry is { question: SurveyQuestion; scale: number[] } =>
      Boolean(entry.scale),
    );
  if (scored.length === 0) return null;
  const max = scored.reduce((sum, entry) => sum + Math.max(...entry.scale), 0);

  return (
    <Card pad="compact" className="flex flex-col gap-3">
      <p className="font-semibold text-ink">Нийт</p>
      <div className="overflow-x-auto rounded-control border border-border">
        <table className="w-full border-collapse text-body">
          <thead>
            <tr className="bg-canvas">
              <th
                scope="col"
                className="px-3 py-2.5 text-left text-caption font-semibold text-muted"
              >
                Хүүхдийн нэр
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-right text-caption font-semibold text-ink"
              >
                Оноо
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const marked = scored.filter(
                ({ question }) => answers[row.child.id]?.[question.id] !== undefined,
              );
              const total = marked.reduce(
                (sum, { question }) => sum + Number(answers[row.child.id]![question.id]),
                0,
              );
              return (
                <tr key={row.child.id} className="border-t border-border-soft">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                    {childName(row)}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {marked.length === 0 ? "—" : `${total} / ${max}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** A free-text question — one input per child, in the same table shape. */
function TextTable({
  rows,
  value,
  onChange,
  editable,
}: {
  rows: TeacherSheetRow[];
  value: (childId: string) => string;
  onChange: (childId: string, value: string) => void;
  editable: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-control border border-border">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="bg-canvas">
            <th
              scope="col"
              className="min-w-[140px] px-3 py-2.5 text-left text-caption font-semibold text-muted"
            >
              Хүүхдийн нэр
            </th>
            <th scope="col" className="px-3 py-2.5 text-left text-caption font-semibold text-ink">
              Хариулт
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const who = childName(row);
            return (
              <tr key={row.child.id} className="border-t border-border-soft">
                <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                  {who}
                </th>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    aria-label={`${who}: хариулт`}
                    value={value(row.child.id)}
                    onChange={(e) => onChange(row.child.id, e.target.value)}
                    disabled={!editable}
                    className="h-10 w-full min-w-[180px] rounded-control border border-border bg-surface px-3 text-body text-ink disabled:bg-canvas"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
