"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, ChevronRight, Star, TrendingDown, TrendingUp, Users } from "lucide-react";
import { z } from "zod";
import {
  surveyComparisonSchema,
  surveyResultsSchema,
  type SurveyQuestionResult,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Donut } from "@/components/ui/chart/donut";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { TONE_SURFACE, TONE_VAR, type Tone } from "@/components/ui/tone";
import { shortName } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Судалгааны үр дүн — "Ерөнхий дүн" and "Асуулт тус бүр".
 *
 * ★ REDESIGN 2026-09-12, to the client's own three screens ("хуучин загварыг
 * арилгаад яг энэ зураг шиг болго").
 *
 * What it replaced was three tabs — Тойм, Асуултууд, Хариултууд — where the
 * first was four tiles, the second a list that scrolled the third into view,
 * and the third every question's chart stacked down one page. A teacher
 * checking one question read past five others to reach it.
 *
 * The drawing is two questions asked in order: **how many replied** (one ring,
 * and a way through to the names), then **what did they say to this one**
 * (a picker, one chart, and the two figures that qualify it).
 *
 * ★★ One query, `qk.surveyResults(surveyId, "")`, shared with everything that
 * was already reading it — so the tabs cannot disagree about a total, which two
 * endpoints eventually would.
 */

/**
 * A 1–5 scale in words, best first.
 *
 * ★ The client's own vocabulary, from the drawing: "Маш сайн · Сайн · Дунд ·
 * Муу". A RATING question stores a score and carries no labels of its own —
 * `surveyQuestionSchema.options` is for CHECKBOX's choices and MATRIX's rows —
 * so naming the bands is this screen's job, and naming them once here is what
 * keeps two charts from calling 3 different things.
 */
const RATING_BAND: Record<number, { label: string; tone: Tone }> = {
  5: { label: "Маш сайн", tone: "mint" },
  4: { label: "Сайн", tone: "sky" },
  3: { label: "Дунд", tone: "sun" },
  2: { label: "Муу", tone: "peach" },
  1: { label: "Маш муу", tone: "peach" },
};

/** One bar of the per-question chart. */
type Slice = { key: string; label: string; count: number; tone: Tone };

/**
 * A question's answers as bars, whatever its type.
 *
 * RATING becomes the five named bands; CHECKBOX its own options; YES_NO the two
 * words. TEXT has no distribution — it answers `null`, and the caller prints the
 * replies instead of drawing a chart of nothing.
 */
function slicesOf(result: SurveyQuestionResult): Slice[] | null {
  const counts = result.counts ?? {};
  const type = result.question.type;

  if (type === "RATING") {
    return [5, 4, 3, 2, 1].map((score) => ({
      key: String(score),
      label: RATING_BAND[score]!.label,
      count: counts[String(score)] ?? 0,
      tone: RATING_BAND[score]!.tone,
    }));
  }

  if (type === "YES_NO") {
    return [
      { key: "true", label: "Тийм", count: counts.true ?? 0, tone: "mint" as Tone },
      { key: "false", label: "Үгүй", count: counts.false ?? 0, tone: "peach" as Tone },
    ];
  }

  if (type === "CHECKBOX" && Array.isArray(result.question.options)) {
    const palette: Tone[] = ["mint", "sky", "sun", "peach", "cornflower", "teal"];
    return result.question.options.map((option, index) => ({
      key: option,
      label: option,
      count: counts[option] ?? 0,
      tone: palette[index % palette.length]!,
    }));
  }

  return null;
}

/** The mean score of a RATING question, or null where a mean means nothing. */
function averageOf(result: SurveyQuestionResult): number | null {
  if (result.question.type !== "RATING") return null;
  const counts = result.counts ?? {};

  let total = 0;
  let answered = 0;
  for (const score of [1, 2, 3, 4, 5]) {
    const count = counts[String(score)] ?? 0;
    total += score * count;
    answered += count;
  }

  return answered === 0 ? null : total / answered;
}

export function SurveyResultsView({ surveyId }: { surveyId: string }) {
  const [tab, setTab] = useState<"overview" | "questions" | "answers">("overview");
  /** Which question the second tab is showing, by id. */
  const [questionId, setQuestionId] = useState<string | null>(null);

  const results = useQuery({
    queryKey: qk.surveyResults(surveyId, ""),
    queryFn: () => get(`/surveys/${surveyId}/results`, surveyResultsSchema),
  });

  const data = results.data;
  const questions = useMemo(() => data?.questions ?? [], [data]);
  const selected = questions.find((row) => row.question.id === questionId) ?? questions[0];

  if (results.isPending) return <LoadingState rows={4} />;
  if (results.isError) return <ErrorState description={errorMessage(results.error)} />;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Судалгааны үр дүн"
        className="grid grid-cols-3 gap-1 rounded-card bg-sunken p-1"
      >
        <button
          role="tab"
          type="button"
          id="survey-results-tab-overview"
          aria-selected={tab === "overview"}
          aria-controls="survey-results-panel-overview"
          onClick={() => setTab("overview")}
          className={tabClass(tab === "overview")}
        >
          Ерөнхий дүн
        </button>
        <button
          role="tab"
          type="button"
          id="survey-results-tab-questions"
          aria-selected={tab === "questions"}
          aria-controls="survey-results-panel-questions"
          onClick={() => setTab("questions")}
          className={tabClass(tab === "questions")}
        >
          Асуулт тус бүр
        </button>
        <button
          role="tab"
          type="button"
          id="survey-results-tab-answers"
          aria-selected={tab === "answers"}
          aria-controls="survey-results-panel-answers"
          onClick={() => setTab("answers")}
          className={tabClass(tab === "answers")}
        >
          Хариулт
        </button>
      </div>

      {tab === "overview" ? (
        <div
          role="tabpanel"
          id="survey-results-panel-overview"
          aria-labelledby="survey-results-tab-overview"
          className="flex flex-col gap-4"
        >
          <Coverage
            surveyId={surveyId}
            answered={data!.totalResponses}
            expected={data!.expectedResponses}
          />

          <QuestionIndex
            questions={questions}
            onOpen={(id) => {
              setQuestionId(id);
              setTab("questions");
            }}
          />
        </div>
      ) : null}

      {tab === "questions" ? (
        <div
          role="tabpanel"
          id="survey-results-panel-questions"
          aria-labelledby="survey-results-tab-questions"
          className="flex flex-col gap-4"
        >
          {questions.length === 0 || !selected ? (
            <EmptyState
              title="Асуулт алга"
              description="Энэ судалгаанд асуулт нэмэгдээгүй байна."
            />
          ) : (
            <>
              <label className="sr-only" htmlFor="survey-question-picker">
                Асуулт сонгох
              </label>
              <Select
                id="survey-question-picker"
                value={selected.question.id}
                onChange={(event) => setQuestionId(event.target.value)}
                className="h-12"
              >
                {questions.map((row, index) => (
                  <option key={row.question.id} value={row.question.id}>
                    {index + 1}. {row.question.prompt}
                  </option>
                ))}
              </Select>

              <QuestionBreakdown result={selected} expected={data!.expectedResponses} />

              <button
                type="button"
                onClick={() => setTab("answers")}
                className="flex min-h-11 w-full items-center rounded-card border border-border bg-surface px-3 text-body font-semibold text-primary transition-colors hover:bg-primary-soft"
              >
                Хариултуудыг харах
                <ChevronRight size={18} aria-hidden="true" className="ms-auto" />
              </button>

              <QuestionComparisonCard surveyId={surveyId} questionId={selected.question.id} />
            </>
          )}
        </div>
      ) : null}

      {tab === "answers" ? (
        <div
          role="tabpanel"
          id="survey-results-panel-answers"
          aria-labelledby="survey-results-tab-answers"
          className="flex flex-col gap-3"
        >
          {questions.length === 0 || !selected ? (
            <EmptyState
              title="Асуулт алга"
              description="Энэ судалгаанд асуулт нэмэгдээгүй байна."
            />
          ) : (
            <>
              <label className="sr-only" htmlFor="survey-answer-question-picker">
                Хариултын асуулт сонгох
              </label>
              <Select
                id="survey-answer-question-picker"
                value={selected.question.id}
                onChange={(event) => setQuestionId(event.target.value)}
                className="h-12"
              >
                {questions.map((row, index) => (
                  <option key={row.question.id} value={row.question.id}>
                    {index + 1}. {row.question.prompt}
                  </option>
                ))}
              </Select>
              <ChildAnswers surveyId={surveyId} result={selected} />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function tabClass(active: boolean): string {
  return cn(
    "min-h-11 rounded-card px-3 text-body font-semibold transition-colors",
    active ? "bg-primary text-primary-contrast" : "text-muted hover:text-ink",
  );
}

/**
 * Хамрагдсан байдал — the ring, and the way through to the names.
 *
 * ★ The link is the drawing's own row, and it goes to a screen rather than
 * opening a panel: "who has not replied yet" is a list a teacher works through
 * with a phone in their hand, and it wants the width.
 */
function Coverage({
  surveyId,
  answered,
  expected,
}: {
  surveyId: string;
  answered: number;
  expected: number;
}) {
  const missing = Math.max(0, expected - answered);
  const percent = expected === 0 ? null : Math.round((answered / expected) * 100);

  return (
    <Card pad="roomy" className="flex flex-col gap-4">
      <h3 className="text-lead font-semibold text-ink">Хамрагдсан байдал</h3>

      <div className="flex flex-wrap items-center justify-center gap-6 sm:flex-nowrap sm:justify-start sm:gap-8">
        <Donut
          size={168}
          segments={[
            { label: "Бөглөсөн", value: answered, tone: "mint" },
            { label: "Бөглөөгүй", value: missing, color: "var(--color-track)" },
          ]}
          label={`${expected}-аас ${answered} нь бөглөсөн`}
          centre={
            <div className="text-center">
              <p className="text-display font-bold leading-none tabular-nums text-ink">
                {percent === null ? "—" : `${percent}%`}
              </p>
              <p className="mt-1 text-caption tabular-nums text-muted">
                {answered}/{expected}
              </p>
            </div>
          }
        />

        <dl className="flex min-w-0 flex-1 flex-col gap-3">
          {[
            { key: "done", label: "Бөглөсөн", value: answered, tone: "mint" as Tone },
            { key: "todo", label: "Бөглөөгүй", value: missing, tone: null },
          ].map((row) => (
            <div key={row.key} className="flex items-center gap-2.5">
              <span
                className="size-3 shrink-0 rounded-pill"
                style={{ background: row.tone ? TONE_VAR[row.tone] : "var(--color-track)" }}
                aria-hidden="true"
              />
              <dt className="min-w-0 flex-1 truncate text-body text-ink">{row.label}</dt>
              <dd className="text-lead font-bold tabular-nums text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <Link
        href={`/surveys/${surveyId}/respondents`}
        className="-mx-1 flex min-h-11 items-center gap-2 rounded-control border-t border-border px-1 pt-3 text-body font-medium text-primary hover:underline"
      >
        Хэн бөглөсөн / бөглөөгүй харах
        <ArrowRight size={16} aria-hidden="true" className="ms-auto" />
      </Link>
    </Card>
  );
}

/**
 * Асуултуудын дүн — every question, one row each.
 *
 * ★ A bar and a number, not a chart. The row answers "is this one doing well"
 * at a glance; the chart that answers "how exactly" is one tap away, and
 * drawing it here would make the list a page nobody can scan.
 *
 * The bar is the mean out of five where a mean exists, and the share who
 * answered where it does not — a TEXT question has no score, and an empty bar
 * beside it would read as a bad result rather than as a different kind of
 * question.
 */
function QuestionIndex({
  questions,
  onOpen,
}: {
  questions: SurveyQuestionResult[];
  onOpen: (questionId: string) => void;
}) {
  if (questions.length === 0) return null;

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <h3 className="text-lead font-semibold text-ink">Асуултуудын дүн</h3>

      <ul className="flex flex-col">
        {questions.map((row, index) => {
          const average = averageOf(row);
          const percent =
            average === null
              ? row.responseCount === 0
                ? 0
                : 100
              : Math.round((average / 5) * 100);

          return (
            <li key={row.question.id} className="border-b border-border-soft last:border-0">
              <button
                type="button"
                onClick={() => onOpen(row.question.id)}
                className="flex w-full items-center gap-3 py-3 text-start transition-colors hover:bg-canvas"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-control bg-sunken text-caption font-bold tabular-nums text-ink">
                  {index + 1}
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="truncate text-body text-ink">{row.question.prompt}</span>
                  <span
                    aria-hidden="true"
                    className="h-2 w-full overflow-hidden rounded-pill bg-track"
                  >
                    <span
                      className="block h-full rounded-pill"
                      style={{ width: `${percent}%`, background: TONE_VAR.mint }}
                    />
                  </span>
                </span>

                <span className="shrink-0 text-body font-bold tabular-nums text-ink">
                  {average === null ? row.responseCount : average.toFixed(1)}
                </span>
                <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** One question: the bars, then the two figures that qualify them. */
function QuestionBreakdown({
  result,
  expected,
}: {
  result: SurveyQuestionResult;
  expected: number;
}) {
  const slices = slicesOf(result);
  const average = averageOf(result);
  const answered = slices
    ? slices.reduce((sum, slice) => sum + slice.count, 0)
    : result.responseCount;
  const share = expected === 0 ? null : Math.round((result.responseCount / expected) * 100);
  const tallest = Math.max(1, ...(slices ?? []).map((slice) => slice.count));

  return (
    <div className="flex flex-col gap-3">
      <Card pad="roomy">
        {slices === null ? (
          /*
            A TEXT question has no distribution, so it shows what was written
            instead of a chart of nothing. Capped, because a hundred answers is
            an export rather than a screen.
          */
          <div className="flex flex-col gap-2">
            {(result.responses ?? []).length === 0 ? (
              <p className="text-body text-muted">Бичвэр хариулт алга.</p>
            ) : (
              (result.responses ?? []).slice(0, 20).map((text, index) => (
                <p key={index} className="rounded-row bg-sunken px-3 py-2 text-body text-ink">
                  {text}
                </p>
              ))
            )}
          </div>
        ) : (
          /*
            ★ Columns, not rows — the drawing's own shape.

            A vertical bar per option with the count and its share written over
            it. The height is against the tallest bar rather than against the
            total: at 60/25/10/5 a share-scaled chart is four stubs, and the
            question a reader asks of this picture is "which answer won", not
            "what fraction of the whole is each".
          */
          <div className="flex items-end justify-between gap-2 sm:gap-4" style={{ height: 208 }}>
            {slices.map((slice) => {
              const percent = answered === 0 ? 0 : Math.round((slice.count / answered) * 100);
              return (
                <div key={slice.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <span className="text-caption font-semibold tabular-nums text-ink">
                    {slice.count}
                    <span className="ms-1 font-normal text-muted">({percent}%)</span>
                  </span>
                  <span
                    role="img"
                    aria-label={`${slice.label}: ${slice.count} хариулт, ${percent} хувь`}
                    className="w-full rounded-t-control"
                    style={{
                      height: `${Math.max(4, (slice.count / tallest) * 130)}px`,
                      background: TONE_VAR[slice.tone],
                    }}
                  />
                  <span className="w-full truncate text-center text-caption text-muted">
                    {slice.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Figure
          tone="sun"
          icon={<Star size={18} />}
          label="Дундаж үнэлгээ"
          value={average === null ? "—" : average.toFixed(1)}
          note={average === null ? undefined : "/ 5"}
        />
        <Figure
          tone="sky"
          icon={<Users size={18} />}
          label="Оролцсон"
          value={`${result.responseCount}/${expected}`}
          note={share === null ? undefined : `(${share}%)`}
        />
      </div>
    </div>
  );
}

function Figure({
  tone,
  icon,
  label,
  value,
  note,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-card border border-border-soft bg-surface p-3">
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-control",
          TONE_SURFACE[tone],
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-caption leading-snug text-muted">{label}</p>
        <p className="text-lead font-bold leading-tight tabular-nums text-ink">
          {value}
          {note ? <span className="ms-1 text-body font-normal text-muted">{note}</span> : null}
        </p>
      </div>
    </div>
  );
}

/** One child's answer, in the compact list shown in the supplied design. */
function ChildAnswers({ surveyId, result }: { surveyId: string; result: SurveyQuestionResult }) {
  const questionId = result.question.id;
  const answers = useQuery({
    queryKey: ["surveys", surveyId, "answers", questionId],
    queryFn: () =>
      get(
        `/surveys/${surveyId}/questions/${questionId}/answers`,
        z.object({
          anonymous: z.boolean().default(false),
          items: z
            .array(
              z.object({
                child: z.object({
                  id: z.string(),
                  firstName: z.string(),
                  lastName: z.string().nullish(),
                }),
                value: z.unknown(),
              }),
            )
            .default([]),
        }),
      ),
  });

  if (answers.isPending) return <LoadingState rows={4} />;
  if (answers.isError) return <ErrorState description={errorMessage(answers.error)} />;

  const data = answers.data!;
  if (data.anonymous) {
    return (
      <EmptyState
        title="Нэргүй судалгаа"
        description="Энэ судалгаа нэрээ нууцлан бөглөгддөг тул хэн юу хариулсныг харуулахгүй."
      />
    );
  }
  if (data.items.length === 0) {
    return <EmptyState title="Хариулт алга" description="Одоогоор хариулт ирээгүй байна." />;
  }

  const rows = [...data.items].sort((a, b) =>
    shortName(a.child).localeCompare(shortName(b.child), "mn"),
  );

  return (
    <Card pad="none" className="divide-y divide-border-soft overflow-hidden">
      {rows.map((row) => {
        const badge = answerBadge(result, row.value);
        return (
          <Link
            key={`${row.child.id}-${String(row.value)}`}
            href={`/children/${row.child.id}/general`}
            className="flex min-h-14 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-canvas"
          >
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-pill bg-sunken text-caption font-bold text-muted"
            >
              {(row.child.firstName[0] ?? "?").toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-body text-ink">
              {shortName(row.child)}
            </span>
            <span
              className={cn(
                "max-w-32 truncate rounded-pill px-2.5 py-1 text-caption font-semibold",
                badge.tone ? TONE_SURFACE[badge.tone] : "bg-sunken text-muted",
              )}
            >
              {badge.label}
            </span>
            <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
          </Link>
        );
      })}
    </Card>
  );
}

function answerBadge(
  result: SurveyQuestionResult,
  value: unknown,
): { label: string; tone: Tone | null } {
  if (result.question.type === "RATING") {
    const score = typeof value === "number" ? value : Number(value);
    const band = Number.isFinite(score) ? RATING_BAND[score] : undefined;
    if (band) return { label: band.label, tone: band.tone };
  }

  if (result.question.type === "YES_NO") {
    if (value === true || value === "true") return { label: "Тийм", tone: "mint" };
    if (value === false || value === "false") return { label: "Үгүй", tone: "peach" };
  }

  if (typeof value === "string") {
    return { label: value.length > 24 ? `${value.slice(0, 24)}…` : value, tone: null };
  }

  return { label: "—", tone: null };
}

/**
 * Өмнөхтэй харьцуулах — this question, in both waves.
 *
 * ★ The client's own block: paired bars, then the table that reads them out,
 * then the one sentence the movement supports.
 *
 * The sentence is computed rather than written. "«Маш сайн» үзүүлэлт өмнөхөөс
 * +20% өссөн байна" is a claim about *this* data, so a caption would keep
 * saying it under a chart that changed — the same argument the rating card's
 * own insight line has carried since it was written.
 */
/** `2026-09-01T…` → `2026.09`, the way the drawing labels a wave. */
function waveLabel(iso: string | null | undefined, fallback: string): string {
  if (!iso) return fallback;
  return `${iso.slice(0, 4)}.${iso.slice(5, 7)}`;
}

function QuestionComparisonCard({
  surveyId,
  questionId,
}: {
  surveyId: string;
  questionId: string;
}) {
  const comparison = useQuery({
    queryKey: qk.surveyComparison(surveyId),
    queryFn: () => get(`/surveys/${surveyId}/comparison`, surveyComparisonSchema),
  });

  if (comparison.isPending) return <LoadingState rows={3} />;
  // A survey with no baseline is the ordinary case, not a failure — the card
  // simply is not drawn.
  if (comparison.isError) return null;

  const data = comparison.data!;
  const row = data.questions.find((entry) => entry.questionId === questionId);
  if (!data.baseline || !row) return null;

  const bands = [5, 4, 3, 2, 1].map((score) => ({
    score,
    label: RATING_BAND[score]!.label,
    tone: RATING_BAND[score]!.tone,
    before: row.baselineCounts[String(score)] ?? 0,
    now: row.endlineCounts[String(score)] ?? 0,
  }));

  const beforeTotal = bands.reduce((sum, band) => sum + band.before, 0);
  const nowTotal = bands.reduce((sum, band) => sum + band.now, 0);
  if (beforeTotal === 0 && nowTotal === 0) return null;

  const tallest = Math.max(1, ...bands.flatMap((band) => [band.before, band.now]));
  const share = (count: number, total: number) =>
    total === 0 ? 0 : Math.round((count / total) * 100);

  /* The headline band's own movement, in points of share. */
  const top = bands[0]!;
  const delta = share(top.now, nowTotal) - share(top.before, beforeTotal);

  const beforeLabel = waveLabel(data.baseline.publishedAt, "Өмнө");
  const nowLabel = waveLabel(data.endline?.publishedAt, "Одоо");

  return (
    <section aria-labelledby="survey-comparison-heading" className="flex flex-col gap-3">
      <h3 id="survey-comparison-heading" className="text-lead font-semibold text-ink">
        Өмнө авсан ижил судалгаатай харьцуулах
      </h3>

      <Card pad="roomy" className="flex flex-col gap-4">
        {/*
          ★ The question itself heads the card — the client's own second
          drawing. The picker above says which question is selected, but this
          card is the piece a teacher screenshots for a meeting, and a chart
          with no question on it is a chart about nothing.
        */}
        <p className="text-body font-semibold leading-snug text-ink">{row.prompt}</p>

        {/*
          ★ Named by when each wave ran, not "Өмнө/Одоо" — 2026-09-12.

          Two waves of one questionnaire are told apart by their date; "өмнө"
          is true of every earlier wave there has ever been, and a teacher
          comparing three terms cannot tell which one they are looking at.
        */}
        <div className="flex flex-wrap items-center justify-end gap-4 text-caption text-muted">
          {[
            { key: "before", label: beforeLabel, opacity: 0.4 },
            { key: "now", label: nowLabel, opacity: 1 },
          ].map((entry) => (
            <span key={entry.key} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-pill"
                style={{ background: TONE_VAR.sky, opacity: entry.opacity }}
              />
              {entry.label}
            </span>
          ))}
        </div>

        <div className="flex items-end justify-between gap-3" style={{ height: 172 }}>
          {bands
            .filter((band) => band.before > 0 || band.now > 0)
            .map((band) => (
              <div key={band.score} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <div className="flex h-full w-full items-end justify-center gap-1">
                  {[
                    { key: "before", count: band.before, opacity: 0.4 },
                    { key: "now", count: band.now, opacity: 1 },
                  ].map((bar) => (
                    <div key={bar.key} className="flex w-full flex-col items-center gap-1">
                      <span className="text-caption font-semibold tabular-nums text-ink">
                        {bar.count}
                      </span>
                      <span
                        aria-hidden="true"
                        className="w-full rounded-t-control"
                        style={{
                          height: `${Math.max(3, (bar.count / tallest) * 110)}px`,
                          background: TONE_VAR[band.tone],
                          opacity: bar.opacity,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <span className="w-full truncate text-center text-caption text-muted">
                  {band.label}
                </span>
              </div>
            ))}
        </div>

        <table className="w-full border-collapse text-caption">
          <caption className="sr-only">Хариултын харьцуулалт</caption>
          <thead>
            <tr className="bg-sunken text-muted">
              <th scope="col" className="rounded-s-row px-3 py-2 text-start font-medium">
                Хариулт
              </th>
              <th scope="col" className="px-2 py-2 text-end font-medium tabular-nums">
                {beforeLabel}
              </th>
              <th scope="col" className="rounded-e-row px-3 py-2 text-end font-medium tabular-nums">
                {nowLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {bands
              .filter((band) => band.before > 0 || band.now > 0)
              .map((band) => (
                <tr key={band.score} className="border-b border-border-soft last:border-0">
                  <th scope="row" className="px-3 py-2 text-start font-normal text-ink">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-pill"
                        style={{ background: TONE_VAR[band.tone] }}
                      />
                      {band.label}
                    </span>
                  </th>
                  <td className="px-2 py-2 text-end tabular-nums text-muted">
                    {band.before} ({share(band.before, beforeTotal)}%)
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums text-ink">
                    {band.now} ({share(band.now, nowTotal)}%)
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        {delta === 0 ? null : (
          <p
            className={cn(
              "flex items-center gap-2 rounded-card px-3 py-2.5 text-body",
              delta > 0 ? TONE_SURFACE.mint : TONE_SURFACE.peach,
            )}
          >
            {delta > 0 ? (
              <TrendingUp size={18} aria-hidden="true" className="shrink-0" />
            ) : (
              <TrendingDown size={18} aria-hidden="true" className="shrink-0" />
            )}
            «{top.label}» үзүүлэлт өмнөхөөс {delta > 0 ? "+" : ""}
            {delta}% {delta > 0 ? "өссөн" : "буурсан"} байна.
          </p>
        )}
      </Card>
    </section>
  );
}
