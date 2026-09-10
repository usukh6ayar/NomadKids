"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  SURVEY_CATEGORY_LABEL,
  surveyResultsSchema,
  type SurveyGroupResult,
  surveySchema,
  SURVEY_PERIOD_LABEL,
  SURVEY_QUESTION_TYPE_LABEL,
  hasOptionList,
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
import { ArrowDown, ArrowUp, Plus, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Card, SectionHeader } from "@/components/ui/card";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { BarRow } from "@/components/ui/chart/bar-row";
import { Donut } from "@/components/ui/chart/donut";
import { Ring } from "@/components/ui/chart/ring";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

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

/**
 * The labels live in `@kinder/contracts` so the composer here and the answering
 * form a parent sees name the same type identically. They were duplicated here
 * until `SINGLE_CHOICE` was added and only one copy learned about it.
 */
const TYPE_LABEL = SURVEY_QUESTION_TYPE_LABEL;

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
        lede={SURVEY_CATEGORY_LABEL[data.category]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data.status !== "DRAFT" ? (
              <>
                <PrintButton />
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
        <PublishedSurvey surveyId={surveyId} questionCount={data.questions.length} />
      )}
    </div>
  );
}

/**
 * A published survey, in three tabs — the client's 2026-09-10 design:
 * Тойм · Асуултууд · Хариултууд.
 *
 * ★ Tabs here where the survey list got two *screens*, and the difference is
 * real.
 *
 * A poll and a questionnaire are two instruments; these three are one dataset
 * read three ways, and a reader moves between them constantly — "60% replied,
 * which question was that, what did they say". Separate routes would put a
 * navigation between glances at the same numbers. The query is shared, so
 * switching costs nothing.
 *
 * ★★ Тойм opens first, and it is the only one that fits on a phone unscrolled.
 *
 * The headline a teacher came for is "did enough people reply" — the rest is
 * what they read after deciding the answer is worth reading. The button at the
 * foot of Тойм goes straight to Хариултууд rather than asking them to find the
 * tab again.
 */
function PublishedSurvey({ surveyId, questionCount }: { surveyId: string; questionCount: number }) {
  const [tab, setTab] = useState<"overview" | "questions" | "answers">("overview");

  const TABS = [
    { key: "overview" as const, label: "Тойм" },
    { key: "questions" as const, label: "Асуултууд" },
    { key: "answers" as const, label: "Хариултууд" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div
        role="tablist"
        aria-label="Судалгааны үр дүн"
        data-ui="communication-tabs"
        className="grid grid-cols-3 gap-1 rounded-card bg-sunken p-1 sm:w-[420px]"
      >
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={cn(
              "min-h-10 rounded-card px-3 text-body font-semibold transition-colors",
              tab === entry.key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <SurveyOverview
          surveyId={surveyId}
          questionCount={questionCount}
          onOpenAnswers={() => setTab("answers")}
        />
      ) : null}

      {tab === "questions" ? (
        <SurveyQuestionIndex surveyId={surveyId} onOpenAnswers={() => setTab("answers")} />
      ) : null}

      {tab === "answers" ? (
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
      ) : null}
    </div>
  );
}

/**
 * Тойм — four figures and who has replied.
 *
 * ★ It reads the same query the Хариултууд tab does, unfiltered.
 *
 * `qk.surveyResults(surveyId, "")` is already in the cache by the time anybody
 * presses a tab, so this is a render rather than a request — and the two tabs
 * cannot disagree about a total, which two endpoints would eventually do.
 */
function SurveyOverview({
  surveyId,
  questionCount,
  onOpenAnswers,
}: {
  surveyId: string;
  questionCount: number;
  onOpenAnswers: () => void;
}) {
  const results = useQuery({
    queryKey: qk.surveyResults(surveyId, ""),
    queryFn: () => get(`/surveys/${surveyId}/results`, surveyResultsSchema),
  });

  if (results.isLoading) return <LoadingState rows={3} />;
  if (results.isError) return <ErrorState description={errorMessage(results.error)} />;

  const data = results.data!;
  const coverage =
    data.expectedResponses > 0
      ? Math.round((data.totalResponses / data.expectedResponses) * 100)
      : null;
  const audience = data.survey.group?.name ?? "Бүх бүлэг";

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3">
        <SummaryTile label="Нийт асуулт" value={questionCount} />
        <SummaryTile label="Нийт хариулт" value={data.totalResponses} />

        {/*
          ★ The ring carries the figure and the tile does not repeat it.

          Every other `SummaryTile` on this screen is a number with a word under
          it; this one is a number with a *shape* behind it, because coverage is
          the one figure on the tab that means something as a proportion. `Ring`
          is `aria-hidden` by default and named here for exactly that reason —
          it is the sole carrier.
        */}
        <Card pad="compact" className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <dt className="text-caption text-muted">Хамралт</dt>
            <dd className="text-title font-semibold tabular-nums leading-none text-ink">
              {coverage === null ? "—" : `${coverage}%`}
            </dd>
          </div>
          <Ring
            percent={coverage ?? 0}
            muted={coverage === null}
            size="sm"
            label={
              coverage === null
                ? "Хамралт тодорхойгүй"
                : `${data.expectedResponses}-аас ${data.totalResponses} нь хариулсан`
            }
          >
            <span className="sr-only">{coverage ?? 0}%</span>
          </Ring>
        </Card>

        <SummaryTile label="Хэнд зориулсан" value={audience} />
      </dl>

      {data.byGroup.length > 0 ? <GroupResponseChart groups={data.byGroup} /> : null}

      <Button size="lg" onClick={onOpenAnswers}>
        Үр дүнг дэлгэрэнгүй харах
      </Button>
    </div>
  );
}

/**
 * Асуултууд — the questionnaire itself, with how many answered each.
 *
 * ★ Not the same list as Хариултууд, and the difference is the point.
 *
 * This one is scannable: six rows, each a prompt, its type and a count. It
 * answers "what did we ask" and "did anybody skip one" — two questions the
 * results tab buries under charts, because a card carrying a distribution is
 * half a screen tall and six of them are not a list you can scan.
 *
 * ★★ A row opens Хариултууд rather than a page of its own.
 *
 * The client's design pages through questions one at a time with arrows. The
 * content of that page is exactly the card the results tab already draws, so a
 * second route rendering it would be a second copy of every chart. The row
 * scrolls to that card instead.
 */
function SurveyQuestionIndex({
  surveyId,
  onOpenAnswers,
}: {
  surveyId: string;
  onOpenAnswers: () => void;
}) {
  const results = useQuery({
    queryKey: qk.surveyResults(surveyId, ""),
    queryFn: () => get(`/surveys/${surveyId}/results`, surveyResultsSchema),
  });

  if (results.isLoading) return <LoadingState rows={4} />;
  if (results.isError) return <ErrorState description={errorMessage(results.error)} />;

  const questions = results.data!.questions;

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-caption text-muted">Нийт {questions.length} асуулт</p>

      <ul className="flex flex-col gap-2">
        {questions.map((q, index) => (
          <li key={q.question.id}>
            <button
              type="button"
              onClick={() => {
                onOpenAnswers();
                /*
                  After the tab has rendered. The results card does not exist
                  in the DOM until the state change flushes, so scrolling now
                  would find nothing — and a silent no-op reads as a dead row.
                */
                requestAnimationFrame(() =>
                  document
                    .getElementById(`question-${q.question.id}`)
                    ?.scrollIntoView({ block: "start" }),
                );
              }}
              className="flex w-full items-center gap-3 rounded-card border border-border bg-surface px-3.5 py-3 text-left transition-colors hover:border-primary hover:bg-canvas"
            >
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-pill bg-primary-soft text-caption font-semibold tabular-nums text-primary"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium leading-snug text-ink">
                  {q.question.prompt}
                </span>
                <span className="block text-caption text-muted">
                  {SURVEY_QUESTION_TYPE_LABEL[q.question.type]}
                </span>
              </span>
              <span className="shrink-0 text-caption tabular-nums text-muted">
                {q.responseCount} хариулт
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Хэвлэх — the client's fourth action on the survey screen.
 *
 * ★ `window.print()`, not a generated PDF, and that is the right tool here.
 *
 * The report worker exists for documents that must look identical everywhere
 * and be stored — it needs Chromium, a gigabyte of RAM and system Cyrillic
 * fonts (CLAUDE.md §6), and it runs as a queued job with a `ReportJob` row. A
 * teacher printing the results they are looking at wants this page on paper
 * now, which the browser already does perfectly and instantly.
 *
 * The `data-print-hide` attribute on the sidebar, the bottom bar, the desktop
 * header and the chat button — with the `@media print` block in `globals.css`
 * that acts on it — is what makes the output a results sheet rather than a
 * screenshot of an app.
 */
function PrintButton() {
  return (
    <Button size="sm" variant="secondary" onClick={() => window.print()}>
      Хэвлэх
    </Button>
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
            options: hasOptionList(q.type)
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
      (q) => hasOptionList(q.type) && q.options.every((o) => !o.trim()),
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

            {/*
              Shown for both option-bearing types. `hasOptionList` is imported
              rather than spelled `=== "CHECKBOX" || === "SINGLE_CHOICE"` here and
              again in the validation below — two copies of the same predicate is
              how one of them misses the next type that carries options.
            */}
            {hasOptionList(question.type) ? (
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

  /*
    Who the counts are counting. A CHILD survey is answered once per child, so
    the number under "Бөглөсөн" is children; a kindergarten-wide one is answered
    once per person. Naming it matters because the two denominators differ and
    a bare "18" beside "Бөглөөгүй" does not say 18 of what.
  */
  const respondentNoun = data.survey.scope === "CHILD" ? "хүүхэд" : "эцэг эх";
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
        ★ Бөглөсөн and Бөглөөгүй, the client's two headline numbers.

        The second is the one that could not be shown before: the API now
        returns how many responses the survey is *waiting on* — enrolled
        children for a CHILD survey, distinct guardians for a kindergarten-wide
        one — because only the server can see enrolments and memberships.

        Rendered only when there is a population to compare against. A survey
        whose expected count is zero (a kindergarten with no active enrolments,
        or an older API that does not send the field) would otherwise show
        "0 бөглөөгүй" beside a real response count, which reads as complete
        when it is really unknown.
      */}
      {data.expectedResponses > 0 ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <SummaryTile label="Бөглөсөн" value={data.totalResponses} hint={respondentNoun} />
          <SummaryTile label="Бөглөөгүй" value={data.missingResponses} hint={respondentNoun} />
          <SummaryTile
            label="Хамралт"
            value={`${Math.round((data.totalResponses / data.expectedResponses) * 100)}%`}
            hint={`${data.expectedResponses}-аас`}
          />
        </dl>
      ) : null}

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
        {data.questions.map((q, index) => (
          <Card
            key={q.question.id}
            id={`question-${q.question.id}`}
            className="flex flex-col gap-3 px-4 py-4 scroll-mt-4"
          >
            {/*
              ★ Numbered, because the client's design numbers them and because
              a results sheet is read alongside the questionnaire it came from.

              "Гурав дахь асуулт дээр эцэг эхчүүд..." is how a teacher refers to
              one of these in a meeting, and a card that does not carry the
              number makes them count down the page to find it.
            */}
            <div className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-pill bg-primary-soft text-caption font-semibold tabular-nums text-primary"
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="font-medium leading-snug text-ink">{q.question.prompt}</p>
                <p className="text-caption text-muted">
                  {SURVEY_QUESTION_TYPE_LABEL[q.question.type]} · {q.responseCount} хариулсан
                </p>
              </div>
            </div>

            {/*
              ★ The chart follows the question's type, not its data shape.

              Every one of these arrives as the same `Record<string, number>`,
              and drawing them all as sorted bars was the screen treating a
              five-point scale, a yes/no and a list of activities as one thing.
              They are read differently: a scale is a distribution (order is the
              information), a yes/no is a share of a whole, a choice list is a
              ranking. `question.type` is the only thing that knows which.
            */}
            {q.counts && q.question.type === "RATING" ? (
              <RatingResult counts={q.counts} total={q.responseCount} />
            ) : q.counts && q.question.type === "YES_NO" ? (
              <YesNoResult counts={q.counts} total={q.responseCount} />
            ) : q.counts ? (
              <AnswerBars counts={q.counts} total={q.responseCount} />
            ) : null}

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
/**
 * Бүлэг тус бүрийн оролцоо — each group against its own roster.
 *
 * ★ A share of the group, not of the biggest group — changed 2026-09-10 at
 * the client's request ("5 / 6 (83%)").
 *
 * The bars were scaled to whichever group had replied most, which answers "who
 * replied most" — a question nobody asks. A group of six with five replies is
 * nearly done; a group of four with one has barely started; scaled against each
 * other they were drawn five-to-one and the second looked merely quieter. The
 * denominator is `expectedChildren`, which only the API can know.
 *
 * ★★ A group with no roster falls back to the old scaling rather than
 * disappearing. "Бүлэггүй" — staff answers, which belong to no group — has
 * nothing to be a share of, and a bar of zero beside a real count would read as
 * "nobody replied" rather than "this is not a group".
 */
function GroupResponseChart({ groups }: { groups: SurveyGroupResult[] }) {
  const most = Math.max(...groups.map((entry) => entry.responseCount), 0);

  return (
    <Card pad="roomy" className="flex flex-col gap-2.5">
      <SectionHeader title="Бүлэг тус бүрийн оролцоо" as="h3" />
      {groups.map((entry) => {
        const expected = entry.expectedChildren;
        const share = expected > 0 ? (entry.responseCount / expected) * 100 : null;

        return (
          <BarRow
            key={entry.group.id ?? "none"}
            inline
            label={entry.group.name}
            percent={share ?? (most === 0 ? 0 : (entry.responseCount / most) * 100)}
            value={
              <span className="tabular-nums">
                {expected > 0 ? `${entry.responseCount} / ${expected}` : entry.responseCount}
                {share === null ? null : (
                  <span className="ms-1 text-muted">({Math.round(share)}%)</span>
                )}
              </span>
            }
            tone="sky"
            accessibleLabel={
              expected > 0
                ? `${entry.group.name}: ${expected}-аас ${entry.responseCount} хариулсан`
                : `${entry.group.name}: ${entry.responseCount} хариулт`
            }
          />
        );
      })}
    </Card>
  );
}

/**
 * A RATING question, read the way a rating is read — 2026-09-10's design.
 *
 * ★ The average first, then the distribution, then what it means.
 *
 * "3.7 / 5" is the number a teacher repeats to a parent; the five bars are how
 * they check whether it is 3.7 because everyone said 3.7 or because half said 5
 * and half said 2. The row of stars is the same figure a third time and earns
 * its place: it is the one form of it a reader takes in without reading.
 *
 * ★★ Fixed at 5 → 1, never sorted by size and never dropping an empty score.
 *
 * A distribution whose rows move is not a distribution — the shape is the
 * information, and "nobody gave this a 1" is one of the more useful things on
 * the card. `AnswerBars` sorts by count because a list of named options has no
 * inherent order; a scale does.
 */
function RatingResult({ counts, total }: { counts: Record<string, number>; total: number }) {
  const scores = [5, 4, 3, 2, 1];
  const answered = scores.reduce((sum, score) => sum + (counts[String(score)] ?? 0), 0);
  const average =
    answered === 0
      ? null
      : scores.reduce((sum, score) => sum + score * (counts[String(score)] ?? 0), 0) / answered;

  /*
    ★ The insight line, and it is computed rather than written.

    The client's mock reads "Ихэнх эцэг эх 3-5 оноо өгсөн байна", which is a
    sentence about *this* data — so it has to be derived, or it becomes a
    caption that keeps saying the same thing under a chart that changed. Stated
    only when a clear majority actually sits at one end; a spread with no story
    gets no sentence rather than a hedged one.
  */
  const high = (counts["4"] ?? 0) + (counts["5"] ?? 0);
  const low = (counts["1"] ?? 0) + (counts["2"] ?? 0);
  const insight =
    answered === 0
      ? null
      : high / answered >= 0.6
        ? "Ихэнх эцэг эх 4–5 оноо өгсөн байна."
        : low / answered >= 0.6
          ? "Ихэнх эцэг эх 1–2 оноо өгсөн байна."
          : null;

  return (
    <div className="flex flex-col gap-3">
      {average === null ? null : (
        <div className="flex items-center gap-3 rounded-card bg-sunken px-3.5 py-3">
          <span className="text-title font-semibold tabular-nums leading-none text-ink">
            {average.toFixed(1)}
            <span className="text-body font-normal text-muted"> / 5</span>
          </span>
          <Stars value={average} />
          <span className="ms-auto text-caption tabular-nums text-muted">{answered} хариулт</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {scores.map((score) => {
          const count = counts[String(score)] ?? 0;
          const percent = answered === 0 ? 0 : Math.round((count / answered) * 100);

          return (
            <BarRow
              key={score}
              inline
              labelWidth="w-6"
              label={String(score)}
              percent={percent}
              value={
                <span className="tabular-nums">
                  {count}
                  <span className="ms-1 text-muted">({percent}%)</span>
                </span>
              }
              tone="sky"
              accessibleLabel={`${score} оноо: ${count} хариулт, ${percent} хувь`}
            />
          );
        })}
      </div>

      {insight ? (
        <p className="rounded-card bg-sun/25 px-3 py-2 text-caption text-ink">{insight}</p>
      ) : null}
      {total > answered ? (
        <p className="text-caption text-muted">
          {total - answered} хариулт энэ хуваарилалтад ороогүй (1–5-аас гадуур утга).
        </p>
      ) : null}
    </div>
  );
}

/**
 * Five stars, filled to a fraction.
 *
 * ★ `aria-hidden`, because the number is right beside it.
 *
 * A screen reader hearing "3.7 / 5" and then "three and a half stars" is told
 * one fact twice in two units. The stars are for the eye that has not read the
 * number yet.
 */
function Stars({ value }: { value: number }) {
  return (
    <span aria-hidden="true" className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={16}
          className={cn(
            value >= i - 0.5 ? "fill-sun text-sun" : "fill-track text-track",
            "shrink-0",
          )}
        />
      ))}
    </span>
  );
}

/**
 * A YES_NO question as a donut — 2026-09-10's design.
 *
 * ★ A donut here, bars everywhere else, and the difference is the question.
 *
 * Two mutually exclusive answers that sum to the whole is the one shape a
 * donut reads well: "is this mostly yes" is answered by the arc without
 * reading either number. A five-point scale in a donut would be five wedges
 * nobody can compare, which is why `RatingResult` next door is bars.
 *
 * The counts stay beside it as bars — the arc says "mostly yes" and the rows
 * say how many, and neither replaces the other.
 */
function YesNoResult({ counts, total }: { counts: Record<string, number>; total: number }) {
  /*
    The stored value is a JSON boolean, so the tally's keys are the strings
    "true" and "false". Read explicitly rather than by position: a question
    nobody answered "no" would otherwise draw its "yes" in the no colour.
  */
  const yes = counts["true"] ?? 0;
  const no = counts["false"] ?? 0;
  const answered = yes + no;
  const share = (n: number) => (answered === 0 ? 0 : Math.round((n / answered) * 100));

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
      <Donut
        size={120}
        segments={[
          { label: "Тийм", value: yes, tone: "sky" },
          { label: "Үгүй", value: no, tone: "cornflower" },
        ]}
        label={`${answered} хариултаас Тийм ${share(yes)} хувь, Үгүй ${share(no)} хувь`}
        centre={
          <span className="text-center">
            <span className="block text-lead font-semibold tabular-nums leading-none text-ink">
              {answered}
            </span>
            <span className="block text-caption text-muted">хариулт</span>
          </span>
        }
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {[
          { label: "Тийм", count: yes, tone: "sky" as const },
          { label: "Үгүй", count: no, tone: "cornflower" as const },
        ].map((row) => (
          <BarRow
            key={row.label}
            inline
            labelWidth="w-12"
            label={row.label}
            percent={share(row.count)}
            value={
              <span className="tabular-nums">
                {row.count}
                <span className="ms-1 text-muted">({share(row.count)}%)</span>
              </span>
            }
            tone={row.tone}
            accessibleLabel={`${row.label}: ${row.count} хариулт`}
          />
        ))}
        {total > answered ? (
          <p className="text-caption text-muted">{total - answered} хариулт тодорхойгүй.</p>
        ) : null}
      </div>
    </div>
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

/**
 * One headline number in the results summary.
 *
 * A `<dl>` cell rather than a `<div>`: "Бөглөсөн / 12" is a term and its
 * definition, and the pairing is what a screen reader needs to read them as
 * belonging together instead of as six loose numbers.
 */
function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-card border border-border bg-surface px-3 py-2.5">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-lead font-semibold tabular-nums text-ink">{value}</dd>
      {hint ? <p className="text-caption text-faint">{hint}</p> : null}
    </div>
  );
}
