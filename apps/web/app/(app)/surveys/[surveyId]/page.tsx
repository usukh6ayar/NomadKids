"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  surveyResultsSchema,
  type SurveyGroupResult,
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
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Card, SectionHeader } from "@/components/ui/card";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { BarRow } from "@/components/ui/chart/bar-row";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";

type DraftQuestion = {
  order: number;
  type: SurveyQuestionType;
  prompt: string;
  /**
   * CHECKBOX's choices, one entry each.
   *
   * ★ A list, where this was a comma-separated string — 2026-08-29.
   *
   * "Улаан, Ногоон, Хөх" in one field is a data format a teacher has to know:
   * it cannot hold a choice containing a comma, gives no way to reorder or
   * delete one without editing around the punctuation, and shows nothing of
   * what the parent will actually see. Every form builder gives an option its
   * own row for those reasons.
   */
  options: string[];
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
  const toast = useToast();
  const router = useRouter();
  const [period, setPeriod] = useState<"MIDLINE" | "ENDLINE">("ENDLINE");

  const clone = useMutation({
    mutationFn: () =>
      mutate(`/surveys/${surveyId}/clone`, surveySchema, {
        method: "POST",
        body: { period, schoolYear },
      }),
    onSuccess: (created) => {
      toast.success("Судалгааг хуулбарлалаа.");
      router.push(`/surveys/${created.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
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
  const queryClient = useQueryClient();
  const toast = useToast();
  const publish = useMutation({
    mutationFn: () => mutate(`/surveys/${surveyId}/publish`, surveySchema, { method: "POST" }),
    /*
      ★ `invalidateQueries`, not `router.refresh()` — which did nothing here.

      This page reads its survey through `useQuery`, and `router.refresh()`
      re-renders *server* components. Nothing on this screen is one, so
      publishing left the badge reading "Ноорог" and the buttons unchanged
      until a hard reload: the action worked and the screen denied it. Two
      symptoms of one cause, and the toast is the other half of the fix.
    */
    onSuccess: () => {
      toast.success("Судалгааг нийтэллээ. Эцэг эхчүүд бөглөж эхэлнэ.");
      void queryClient.invalidateQueries({ queryKey: qk.survey(surveyId) });
      void queryClient.invalidateQueries({ queryKey: qk.kindergartenSurveys("") });
    },
    onError: (error) => toast.error(errorMessage(error)),
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
  const queryClient = useQueryClient();
  const toast = useToast();
  const close = useMutation({
    mutationFn: () => mutate(`/surveys/${surveyId}/close`, surveySchema, { method: "POST" }),
    // Same repair as `publish` above — see the note there.
    onSuccess: () => {
      toast.success("Судалгааг хаалаа. Шинэ хариулт хүлээж авахгүй.");
      void queryClient.invalidateQueries({ queryKey: qk.survey(surveyId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
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
  const toast = useToast();
  const [questions, setQuestions] = useState<DraftQuestion[]>(() =>
    initialQuestions.length > 0
      ? initialQuestions
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((q) => ({
            order: q.order,
            type: q.type,
            prompt: q.prompt,
            options: Array.isArray(q.options) && q.options.length > 0 ? [...q.options] : [""],
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
                ? q.options.map((o) => o.trim()).filter(Boolean)
                : q.type === "MATRIX"
                  ? { rows: parseRows(q.rowsText), columns: parseColumns(q.columnsText) }
                  : undefined,
            // Empty means "not comparable" — the honest answer for a one-off
            // poll question, and what the API stores as null.
            indicatorKey: q.indicatorKey.trim() || null,
          })),
        },
      }),
    onSuccess: () => {
      toast.success("Асуултууд хадгалагдлаа.");
      onSaved();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /**
   * Why the form cannot be saved yet, or null.
   *
   * ★ Checked here rather than left to the API — which does reject it, with a
   * 400 the teacher meets *after* pressing the button.
   *
   * `prompt: z.string().min(1)` and the CHECKBOX refinement are the server's
   * rules and they stay authoritative; this is the same two rules stated where
   * a person can act on them, which is what a form builder does. Found by a
   * browser test that filled in the choices and left the question blank: the
   * save round-tripped to a validation error for a mistake visible on screen.
   */
  const blocker = ((): string | null => {
    const empty = questions.findIndex((q) => !q.prompt.trim());
    if (empty !== -1) return `${empty + 1}-р асуултын текст хоосон байна.`;

    const noChoice = questions.findIndex(
      (q) => q.type === "CHECKBOX" && q.options.every((o) => !o.trim()),
    );
    if (noChoice !== -1) return `${noChoice + 1}-р асуултад сонголт оруулна уу.`;

    return null;
  })();

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
              <Field
                label={`Асуулт ${index + 1}`}
                error={question.prompt.trim() ? undefined : "Асуултаа бичнэ үү"}
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={question.prompt}
                    onChange={(e) => update(index, { prompt: e.target.value })}
                    placeholder="Жишээ нь: Цэцэрлэгийн үйл ажиллагаанд хэр сэтгэл ханамжтай байна вэ?"
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
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-body font-medium text-ink">Сонголтууд</legend>
                {question.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="flex items-center gap-2">
                    {/*
                      ★ The empty circle a parent will actually tap.

                      It is `aria-hidden` decoration here — this row is a text
                      field, not a choice — but it is what makes the editor read
                      as the form it is building rather than as a list of
                      strings. `/children/:id/surveys/:id` draws the real one.
                    */}
                    <span
                      aria-hidden="true"
                      className="size-4 shrink-0 rounded-pill border-2 border-border"
                    />
                    <Input
                      aria-label={`${optionIndex + 1}-р сонголт`}
                      value={option}
                      onChange={(e) =>
                        update(index, {
                          options: question.options.map((o, i) =>
                            i === optionIndex ? e.target.value : o,
                          ),
                        })
                      }
                      placeholder={`Сонголт ${optionIndex + 1}`}
                    />
                    {/* The last remaining row keeps its field: a CHECKBOX with
                        no options is a question nobody can answer. */}
                    {question.options.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`${optionIndex + 1}-р сонголтыг хасах`}
                        onClick={() =>
                          update(index, {
                            options: question.options.filter((_, i) => i !== optionIndex),
                          })
                        }
                        className="grid size-11 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-danger"
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => update(index, { options: [...question.options, ""] })}
                  className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-body font-medium text-primary hover:text-primary-strong"
                >
                  <Plus size={16} aria-hidden="true" />
                  Сонголт нэмэх
                </button>
              </fieldset>
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

            {/*
              ★ Order is the thing this editor could not change until now.

              `order: index` is written on save, so the array's position *is*
              the question number a parent sees — and there was no way to move
              one. Rewriting three prompts to swap two questions is the kind of
              work a pair of arrows removes entirely.

              Buttons rather than drag: this list is edited on a phone as often
              as on a desktop, and a drag handle at 375px is a scroll gesture
              fighting a reorder gesture.
            */}
            <div className="flex flex-wrap items-center gap-1 border-t border-border-soft pt-3">
              <button
                type="button"
                aria-label={`${index + 1}-р асуултыг дээш`}
                disabled={index === 0}
                onClick={() => setQuestions((current) => swap(current, index, index - 1))}
                className="grid size-11 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink disabled:text-faint disabled:hover:bg-transparent"
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`${index + 1}-р асуултыг доош`}
                disabled={index === questions.length - 1}
                onClick={() => setQuestions((current) => swap(current, index, index + 1))}
                className="grid size-11 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink disabled:text-faint disabled:hover:bg-transparent"
              >
                <ArrowDown size={16} aria-hidden="true" />
              </button>

              {questions.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setQuestions((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Устгах
                </Button>
              ) : null}
            </div>
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

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={save.isPending || Boolean(blocker)} onClick={() => save.mutate()}>
          {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
        </Button>
        {/* `aria-live`, so a keyboard user who tabs to a disabled button is
            told why rather than finding a dead control. */}
        {blocker ? (
          <p aria-live="polite" className="text-body text-muted">
            {blocker}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A survey's answers — as a whole, per group, and compared between groups.
 *
 * ★ Three questions of one dataset, which the screen used to answer one of.
 *
 * It rendered a flat list of questions with each answer as a `Badge` — "Тийм:
 * 12  Үгүй: 3" — which is a legend with no chart. Three things were missing and
 * all three come from the same read:
 *
 *  · **A shape.** A bar whose length is the share answers a "which is the
 *    biggest" at a glance; a row of pills makes a reader compare numerals.
 *  · **One group at a time.** A director asks "what did Дэлбээ бүлэг say", and
 *    the only answer available was the kindergarten's average.
 *  · **Group against group.** Which is the actual question — a problem in one
 *    group disappears into an average across four, and disappearing is exactly
 *    what a survey is run to stop.
 *
 * ★★ The filter narrows the headline and never the comparison.
 *
 * A comparison filtered to one group is a chart with one bar. So the chips
 * change what the question cards count and leave the chart beneath them whole.
 */
function Results({ surveyId }: { surveyId: string }) {
  const [groupId, setGroupId] = useState("");

  const results = useQuery({
    queryKey: qk.surveyResults(surveyId, groupId),
    queryFn: () =>
      get(
        `/surveys/${surveyId}/results${groupId ? `?groupId=${groupId}` : ""}`,
        surveyResultsSchema,
      ),
    // The chart below is the same for every filter, so it must not blink to a
    // skeleton each time a chip is pressed.
    placeholderData: (previous) => previous,
  });

  if (results.isLoading) return <LoadingState rows={3} />;
  if (results.isError) return <ErrorState description={errorMessage(results.error)} />;

  const data = results.data!;
  const groups = data.byGroup;
  const selected = groups.find((entry) => entry.group.id === groupId);

  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="results-heading"
        title="Хариултууд"
        lede={selected ? `${selected.group.name}-ийн хариултууд.` : undefined}
        action={<span className="text-body text-muted">{data.totalResponses} хариулт</span>}
      />

      {/*
        ★ Rendered only when there is more than one group to choose between.

        A single-group kindergarten gets a chip row whose only effect is to
        re-fetch the same numbers — the rule `GroupSwitcher` and `Pagination`
        are both held to.
      */}
      {groups.length > 1 ? (
        <FilterChipRow label="Бүлгээр шүүх">
          <FilterChip active={!groupId} onClick={() => setGroupId("")}>
            Бүх бүлэг
          </FilterChip>
          {groups.map((entry) => (
            <FilterChip
              key={entry.group.id ?? "none"}
              active={groupId === entry.group.id}
              onClick={() => setGroupId(entry.group.id ?? "")}
            >
              {entry.group.name} ({entry.responseCount})
            </FilterChip>
          ))}
        </FilterChipRow>
      ) : null}

      {groups.length > 1 ? <GroupResponseChart groups={groups} /> : null}

      <div className="flex flex-col gap-3">
        {data.questions.map((q) => (
          <Card key={q.question.id} className="flex flex-col gap-3 px-4 py-4">
            <div>
              <p className="font-medium text-ink">{q.question.prompt}</p>
              <p className="text-caption text-muted">{q.responseCount} хариулсан</p>
            </div>

            {q.counts ? <AnswerBars counts={q.counts} total={q.responseCount} /> : null}

            {/*
              ★ The per-group split sits under the question it splits, not in a
              section of its own.

              "Тийм 12 / Үгүй 3" is only interesting beside "and eleven of the
              Тийм were one group" — putting the two on different parts of the
              page asks a reader to hold the first while scrolling to the
              second.
            */}
            {q.counts && groups.length > 1 ? (
              <QuestionByGroup questionId={q.question.id} groups={groups} />
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

/**
 * How many families in each group answered at all.
 *
 * ★ The first thing to check, before any answer is read.
 *
 * A group that did not respond has no opinion in the results, and an average
 * that quietly excludes it reads as the kindergarten's view. This is the bar
 * that says which groups are actually in the figures below.
 */
function GroupResponseChart({ groups }: { groups: SurveyGroupResult[] }) {
  const most = Math.max(...groups.map((entry) => entry.responseCount), 0);

  return (
    <Card pad="roomy" className="flex flex-col gap-2.5">
      <SectionHeader title="Бүлэг тус бүрийн оролцоо" as="h3" />
      {groups.map((entry) => (
        <BarRow
          key={entry.group.id ?? "none"}
          inline
          label={entry.group.name}
          percent={most === 0 ? 0 : (entry.responseCount / most) * 100}
          value={entry.responseCount}
          tone="sky"
          accessibleLabel={`${entry.group.name}: ${entry.responseCount} хариулт`}
        />
      ))}
    </Card>
  );
}

/**
 * One question's answers as bars — the share, not a row of pills.
 *
 * ★ Percentages of the answers to *this* question, not of the survey.
 *
 * A question somebody skipped has fewer answers than the survey has responses,
 * and dividing by the larger figure would make every bar on that card short for
 * a reason the card does not explain.
 */
function AnswerBars({ counts, total }: { counts: Record<string, number>; total: number }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-2">
      {entries.map(([key, count]) => (
        <BarRow
          key={key}
          inline
          label={key}
          percent={total === 0 ? 0 : (count / total) * 100}
          value={
            <span className="tabular-nums">
              {count}
              <span className="ms-1 text-muted">
                ({total === 0 ? 0 : Math.round((count / total) * 100)}%)
              </span>
            </span>
          }
          tone="sky"
          accessibleLabel={`${key}: ${count} хариулт`}
        />
      ))}
    </div>
  );
}

/**
 * The same question, group beside group.
 *
 * ★ A table, and deliberately.
 *
 * Four groups × four answers is a cross-tab, and the question a reader brings
 * to it — "is one column different from the others" — is answered by scanning a
 * column, which is what a table is for. Bars would need sixteen of them and a
 * legend nobody reads.
 *
 * Percentages **within each group**, because the groups are different sizes: a
 * group of eight and a group of twenty compared by raw count says only that one
 * is bigger, which is not what anybody is asking.
 */
function QuestionByGroup({
  questionId,
  groups,
}: {
  questionId: string;
  groups: SurveyGroupResult[];
}) {
  const rows = groups
    .map((entry) => ({
      name: entry.group.name,
      key: entry.group.id ?? "none",
      result: entry.questions.find((q) => q.questionId === questionId),
    }))
    .filter((row) => (row.result?.responseCount ?? 0) > 0);

  if (rows.length < 2) return null;

  // The columns are every answer anybody gave, in one fixed order — so a group
  // that never chose an option still has a cell for it rather than a shifted
  // row.
  const options = [...new Set(rows.flatMap((row) => Object.keys(row.result?.counts ?? {})))].sort();

  if (options.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-caption">
        <caption className="sr-only">Бүлэг тус бүрийн хариулт</caption>
        <thead>
          <tr>
            <th scope="col" className="border-b border-border py-1.5 pe-3 text-left text-muted">
              Бүлэг
            </th>
            {options.map((option) => (
              <th
                key={option}
                scope="col"
                className="border-b border-border px-2 py-1.5 text-right text-muted"
              >
                {option}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th
                scope="row"
                className="border-b border-border-soft py-1.5 pe-3 text-left font-medium text-ink"
              >
                {row.name}
              </th>
              {options.map((option) => {
                const count = row.result?.counts?.[option] ?? 0;
                const answered = row.result?.responseCount ?? 0;
                const share = answered === 0 ? 0 : Math.round((count / answered) * 100);

                return (
                  <td
                    key={option}
                    className="border-b border-border-soft px-2 py-1.5 text-right tabular-nums text-ink"
                  >
                    {count === 0 ? <span className="text-faint">—</span> : `${share}%`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Two questions traded, without mutating the array React is rendering. */
function swap<T>(items: T[], a: number, b: number): T[] {
  if (b < 0 || b >= items.length) return items;
  const next = [...items];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}

const BLANK_QUESTION: DraftQuestion = {
  order: 0,
  type: "RATING",
  prompt: "",
  options: [""],
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
