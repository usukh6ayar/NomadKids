"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { uuidSchema, type SurveyAnswerValue, type SurveyQuestion } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/ui/states";
import { isQuestionAnswered } from "@/components/survey/survey-answer-form";
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
  /** A half-done row saved to be continued (2026-10-16) — never a response. */
  draft: z
    .object({
      updatedAt: z.string(),
      author: z.object({ id: uuidSchema, lastName: z.string(), firstName: z.string() }),
      answers: z.array(z.object({ questionId: uuidSchema, value: z.unknown() })),
    })
    .nullish(),
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
        (row.response?.answers ?? row.draft?.answers ?? []).map((answer) => [
          answer.questionId,
          answer.value as SurveyAnswerValue,
        ]),
      ),
    ]),
  );
}

/** Saved half-done, to be continued — and no finished response yet. */
function isDraft(row: TeacherSheetRow) {
  return !row.response && Boolean(row.draft);
}

/** The «дутуу» mark beside a half-done child's name. */
function DraftMark({ row }: { row: TeacherSheetRow }) {
  return isDraft(row) ? (
    <span className="ml-1.5 rounded-pill bg-sunken px-1.5 py-0.5 text-caption text-muted">
      дутуу
    </span>
  ) : null;
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
  return questions.every((question) => isQuestionAnswered(question, answers[question.id]));
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
 * ★★ Saved whole, only the rows that changed. A complete row is the child's
 * response; a half-done one is saved as a **draft** (2026-10-16, the user:
 * "хадгалаад дахиад үргэлжлүүлээд хийдэг болгох") — kept apart on the server
 * so it is never counted, and loaded back here to be continued. A child who
 * already has a response is corrected whole, as before.
 */
export function TeacherSheet({
  surveyId,
  questions,
  rows,
  editable,
  backHref,
}: {
  surveyId: string;
  questions: SurveyQuestion[];
  rows: TeacherSheetRow[];
  editable: boolean;
  /** Where «Буцах» goes — the survey's own page. */
  backHref: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
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
  const complete = (row: TeacherSheetRow) => isComplete(questions, answers[row.child.id] ?? {});
  const finishedRows = changedRows.filter(complete);
  const draftRows = changedRows.filter((row) => !complete(row) && !row.response);
  // A recorded response is corrected whole — never turned back into a draft.
  const blocked = changedRows.filter((row) => !complete(row) && row.response);
  const savedDrafts = rows.filter((row) => isDraft(row) && !changed.has(row.child.id));

  const answersOf = (row: TeacherSheetRow) =>
    questions
      .filter((question) => answers[row.child.id]?.[question.id] !== undefined)
      .map((question) => ({
        questionId: question.id,
        value: answers[row.child.id]![question.id],
      }));

  /*
    ★ Ten children per request — 2026-09-21, for the А/79 form.

    Its fourth level is 49 questions; a whole group of forty in one body is
    past the API's 100 KB JSON limit. Each chunk is its own transaction, so a
    failure part-way leaves the chunks before it saved — and marked saved here
    — and the rest still marked changed for the next press.
  */
  const save = useMutation({
    mutationFn: async () => {
      const markSaved = (chunk: TeacherSheetRow[]) =>
        setChanged((current) => {
          const next = new Set(current);
          for (const row of chunk) next.delete(row.child.id);
          return next;
        });

      let finished = 0;
      for (let start = 0; start < finishedRows.length; start += SAVE_CHUNK) {
        const chunk = finishedRows.slice(start, start + SAVE_CHUNK);
        const result = await mutate(
          `/surveys/${surveyId}/teacher-sheet`,
          z.object({ saved: z.number() }),
          {
            method: "PUT",
            body: {
              responses: chunk.map((row) => ({ childId: row.child.id, answers: answersOf(row) })),
            },
          },
        );
        finished += result.saved;
        markSaved(chunk);
      }

      let drafted = 0;
      for (let start = 0; start < draftRows.length; start += SAVE_CHUNK) {
        const chunk = draftRows.slice(start, start + SAVE_CHUNK);
        await mutate(`/surveys/${surveyId}/teacher-sheet/drafts`, z.object({ saved: z.number() }), {
          method: "PUT",
          body: {
            drafts: chunk.map((row) => ({ childId: row.child.id, answers: answersOf(row) })),
          },
        });
        drafted += chunk.length;
        markSaved(chunk);
      }
      return { finished, drafted };
    },
    onSuccess: ({ finished, drafted }) => {
      toast.success(
        [
          finished > 0 ? `${finished} хүүхдийн судалгаа хадгалагдлаа.` : null,
          drafted > 0
            ? `${drafted} хүүхдийн дутуу судалгаа хадгалагдлаа — дараа нь үргэлжлүүлж бөглөнө.`
            : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
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
      // Room under the last table for the floating Буцах · Хадгалах.
      className="flex flex-col gap-4 pb-16"
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending && changedRows.length > 0 && blocked.length === 0) save.mutate();
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
        <p className="text-caption text-muted" role="status">
          {blocked.length > 0
            ? `Хадгалагдсан судалгааг засахдаа бүх асуултад хариулна уу: ${blocked.map(childName).join(", ")}.`
            : changedRows.length > 0
              ? draftRows.length > 0
                ? `${changedRows.length} хүүхдийн өөрчлөлт хадгалагдаагүй байна. Дутуу мөр (${draftRows.map(childName).join(", ")}) хадгалагдаад дараа нь үргэлжлүүлж бөглөнө.`
                : `${changedRows.length} хүүхдийн өөрчлөлт хадгалагдаагүй байна.`
              : savedDrafts.length > 0
                ? `Дутуу хадгалсан: ${savedDrafts.map(childName).join(", ")} — үргэлжлүүлж бөглөнө үү.`
                : "Хүүхэд бүрийн мөрөнд сонголтоо тэмдэглэнэ үү."}
        </p>
      ) : null}

      {/*
        ★ Буцах and Хадгалах float, small, bottom right — 2026-10-17, the
        client: "буцах хадгалах товч жижигээр доор баруун талд байнга
        харагдана, утсан дээр хөвдөг цэсний дээр". The sticky bar they replace
        sat under the phone's bottom navigation, so a teacher half-way down
        forty children could not save without scrolling to the end. Stacked
        above the chat button, which holds the corner itself; the explanation
        stays in the page above, so a disabled Хадгалах still says why.
      */}
      <div
        data-print-hide
        className="fixed right-4 z-30 flex items-center gap-1.5 rounded-pill border border-border bg-surface p-1.5 shadow-lg bottom-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom)+4.5rem)] lg:bottom-[5.5rem] lg:right-6"
      >
        {changedRows.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-9 rounded-pill px-3"
            onClick={() => setLeaving(true)}
          >
            <ChevronLeft aria-hidden />
            Буцах
          </Button>
        ) : (
          <Button asChild variant="secondary" size="sm" className="h-9 rounded-pill px-3">
            <Link href={backHref}>
              <ChevronLeft aria-hidden />
              Буцах
            </Link>
          </Button>
        )}
        {editable ? (
          <Button
            type="submit"
            size="sm"
            className="h-9 rounded-pill px-4"
            disabled={save.isPending || changedRows.length === 0 || blocked.length > 0}
          >
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Хадгалаагүй өөрчлөлт байна"
        description={`${changedRows.length} хүүхдийн өөрчлөлт хадгалагдаагүй байна. Хадгалахгүйгээр гарвал алга болно.`}
        confirmLabel="Хадгалахгүй гарах"
        cancelLabel="Үлдэх"
        tone="danger"
        onConfirm={() => {
          setLeaving(false);
          router.push(backHref);
        }}
      />
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
    <div className="table-scroll rounded-control border border-border">
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
                  <DraftMark row={row} />
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
      <div className="table-scroll rounded-control border border-border">
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
                    <DraftMark row={row} />
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
    <div className="table-scroll rounded-control border border-border">
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
                  <DraftMark row={row} />
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
