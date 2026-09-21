"use client";

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronDown, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import { z } from "zod";
import {
  hasOptionList,
  surveyComparisonSchema,
  surveyResultsSchema,
  type SurveyQuestionResult,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Card } from "@/components/ui/card";
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
 * and a way through to the names), then **what did they say to each one** —
 * every question's chart, stacked down the page.
 *
 * ★★★ 2026-09-12, at the client's request: "асуултуудыг бүгдийг доош жагсаан
 * харуулаад өг сонгохгүй". The second tab had a picker and drew one question
 * at a time, so reading a ten-question survey was ten selections and no way to
 * see two charts at once or to print the lot. It now draws them all in order,
 * and the overview's list scrolls to the one it names rather than selecting it.
 *
 * ★★★ Dropped in the same pass, also at the client's request: the "Дундаж
 * үнэлгээ" and "Оролцсон" tiles under each chart, and the "Хариултуудыг харах"
 * row. The mean is already the number every row of "Асуултуудын дүн" carries,
 * the participation figure is what the ring at the head of Ерөнхий дүн says,
 * and the third tab is the way to the answers — repeating all three under every
 * chart is what made the page long enough to need a picker.
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
 * RATING becomes the five named bands; SINGLE_CHOICE and CHECKBOX their own
 * options; YES_NO the two words. TEXT has no distribution — it answers `null`,
 * and the caller prints the replies instead of drawing a chart of nothing.
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

  /*
    ★ SINGLE_CHOICE draws the same chart as CHECKBOX — 2026-09-12.

    It used to fall through to `null` and be printed as free text, so a poll —
    which is one SINGLE_CHOICE question by definition — answered "Бичвэр
    хариулт алга" on the very tab that exists to show its percentages. The API
    had the counts all along (`SurveysService.results` buckets by the value,
    which for a single choice *is* the option). The two types differ in how
    many boxes a parent may tick, which is a fact about the form and not about
    the chart.

    `hasOptionList` rather than a second literal: the pair of types that carry
    an option list is the contract's own fact, and this is the third place that
    would have had to be edited when a fourth choice type arrives.
  */
  if (hasOptionList(type) && Array.isArray(result.question.options)) {
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

  const results = useQuery({
    queryKey: qk.surveyResults(surveyId, ""),
    queryFn: () => get(`/surveys/${surveyId}/results`, surveyResultsSchema),
  });

  const data = results.data;
  const questions = useMemo(() => data?.questions ?? [], [data]);

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
          <Coverage answered={data!.totalResponses} expected={data!.expectedResponses} />

          <QuestionIndex
            questions={questions}
            onOpen={(id) => {
              setTab("questions");
              /*
                The panel it opens lists every question, so the row has to land
                the reader on its own chart — without this the tab switches and
                they are at the top of a page of charts hunting for the one they
                tapped. After paint, and `?.()` because jsdom has no
                `scrollIntoView`.
              */
              requestAnimationFrame(() =>
                document.getElementById(questionAnchor(id))?.scrollIntoView?.({
                  behavior: "smooth",
                  block: "start",
                }),
              );
            }}
          />
        </div>
      ) : null}

      {tab === "questions" ? (
        <div
          role="tabpanel"
          id="survey-results-panel-questions"
          aria-labelledby="survey-results-tab-questions"
          className="flex flex-col gap-6"
        >
          {questions.length === 0 ? (
            <EmptyState
              title="Асуулт алга"
              description="Энэ судалгаанд асуулт нэмэгдээгүй байна."
            />
          ) : (
            /*
              Every question, in the order it was asked. Each is a landmark
              with the prompt as its name, which is what lets the overview's
              list jump to one and a screen reader move between them.
            */
            questions.map((row, index) => (
              <section
                key={row.question.id}
                id={questionAnchor(row.question.id)}
                aria-labelledby={`${questionAnchor(row.question.id)}-heading`}
                className="flex scroll-mt-4 flex-col gap-3"
              >
                <h3
                  id={`${questionAnchor(row.question.id)}-heading`}
                  className="flex items-start gap-2.5 text-lead font-semibold text-ink"
                >
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-control bg-sunken text-caption font-bold tabular-nums text-ink">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 leading-snug">{row.question.prompt}</span>
                </h3>

                <QuestionBreakdown result={row} />

                <QuestionComparisonCard surveyId={surveyId} questionId={row.question.id} />
              </section>
            ))
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
          {questions.length === 0 ? (
            <EmptyState
              title="Асуулт алга"
              description="Энэ судалгаанд асуулт нэмэгдээгүй байна."
            />
          ) : (
            <ResponseRoster surveyId={surveyId} questions={questions} />
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The id the overview's list jumps to, and the question section's own anchor. */
function questionAnchor(questionId: string): string {
  return `survey-question-${questionId}`;
}

function tabClass(active: boolean): string {
  return cn(
    "min-h-11 rounded-card px-3 text-body font-semibold transition-colors",
    active ? "bg-primary text-primary-contrast" : "text-muted hover:text-ink",
  );
}

/**
 * Хамрагдсан байдал — the ring, and the two numbers it splits into.
 *
 * ★ 2026-09-12, at the client's request: the "Хэн бөглөсөн / бөглөөгүй харах"
 * row is gone. The Хариулт tab now opens on those two rosters itself, so the
 * link was a second door onto the same lists one tab away — and the ring's own
 * "Бөглөсөн / Бөглөөгүй" legend already names what it led to.
 */
function Coverage({ answered, expected }: { answered: number; expected: number }) {
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

/** One question's answers, as the chart that type is read by. */
function QuestionBreakdown({ result }: { result: SurveyQuestionResult }) {
  const slices = slicesOf(result);
  const answered = slices
    ? slices.reduce((sum, slice) => sum + slice.count, 0)
    : result.responseCount;
  const tallest = Math.max(1, ...(slices ?? []).map((slice) => slice.count));

  return (
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
  );
}

/** A child, the way both `/participation` and the answers route name one. */
const rosterChildSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string().nullish(),
});

const rosterRowSchema = z.object({
  child: rosterChildSchema,
  group: z.object({ id: z.string(), name: z.string() }).nullish(),
});

const participationSchema = z.object({
  anonymous: z.boolean().default(false),
  answered: z.array(rosterRowSchema.extend({ submittedAt: z.string() })).default([]),
  pending: z.array(rosterRowSchema).default([]),
});

const questionAnswersSchema = z.object({
  anonymous: z.boolean().default(false),
  items: z.array(z.object({ child: rosterChildSchema, value: z.unknown() })).default([]),
});

type RosterSide = "done" | "todo";

/**
 * Хариулт — бөглөсөн, бөглөөгүй, and what each child actually said.
 *
 * ★ 2026-09-12, at the client's request: "хариулт хэсэг рүү дарахаар бөглөсөн
 * бөглөөгүй гэсэн 2 тусдаа болгочих, бөглөсөн хүүхэд дээр дараад орохоор
 * асуулт тус бүрд юу гэж хариулсан нь дропдаун харагд."
 *
 * What it replaced was a question picker over one flat list of children — so
 * reading one family's questionnaire meant selecting each question in turn and
 * finding the same name six times. The axis is turned: the child is the row,
 * and their whole questionnaire opens underneath it.
 *
 * ★★ The roster comes from `/participation`, which is also what says who has
 * *not* replied — the half this tab could not show before, and the reason the
 * overview's link out to a separate screen could go.
 *
 * ★★★ An anonymous survey shows neither list. That is the API's decision, not
 * this screen's (`SurveysService.participation`, `questionAnswers`): a list of
 * everybody who has not replied names the others by subtraction.
 */
function ResponseRoster({
  surveyId,
  questions,
}: {
  surveyId: string;
  questions: SurveyQuestionResult[];
}) {
  const [side, setSide] = useState<RosterSide>("done");
  /** Which child's questionnaire is open. One at a time — the drawing's own. */
  const [openChildId, setOpenChildId] = useState<string | null>(null);

  const participation = useQuery({
    queryKey: ["surveys", surveyId, "participation"],
    queryFn: () => get(`/surveys/${surveyId}/participation`, participationSchema),
  });

  /*
    One request per question, under the key the per-question list already used,
    so the two readings of this data share a cache entry rather than fetching
    it twice. The pivot is this screen's own work: the API answers "who said
    what to question three", and the drawing asks "what did this child say to
    all of them".
  */
  const answers = useQueries({
    queries: questions.map((row) => ({
      queryKey: ["surveys", surveyId, "answers", row.question.id],
      queryFn: () =>
        get(`/surveys/${surveyId}/questions/${row.question.id}/answers`, questionAnswersSchema),
    })),
  });

  if (participation.isPending) return <LoadingState rows={6} />;
  if (participation.isError) return <ErrorState description={errorMessage(participation.error)} />;

  const data = participation.data!;
  if (data.anonymous) {
    return (
      <EmptyState
        title="Нэргүй судалгаа"
        description="Энэ судалгаа нэрээ нууцлан бөглөгддөг тул хэн юу хариулсныг харуулахгүй."
      />
    );
  }

  const byName = (a: { child: { firstName: string; lastName?: string | null } }, b: typeof a) =>
    shortName(a.child).localeCompare(shortName(b.child), "mn");
  const done = [...data.answered].sort(byName);
  const todo = [...data.pending].sort(byName);

  /** This child's answer to the question at `index`, or undefined. */
  const valueOf = (index: number, childId: string): unknown =>
    (answers[index]?.data?.items ?? []).find((item) => item.child.id === childId)?.value;
  const answersPending = answers.some((query) => query.isPending);

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="Бөглөлтийн байдал"
        className="grid grid-cols-2 gap-1 rounded-card bg-sunken p-1"
      >
        {(
          [
            { key: "done", label: "Бөглөсөн", count: done.length },
            { key: "todo", label: "Бөглөөгүй", count: todo.length },
          ] as { key: RosterSide; label: string; count: number }[]
        ).map((entry) => (
          <button
            key={entry.key}
            role="tab"
            type="button"
            aria-selected={side === entry.key}
            onClick={() => setSide(entry.key)}
            className={tabClass(side === entry.key)}
          >
            {entry.label} ({entry.count})
          </button>
        ))}
      </div>

      {side === "done" ? (
        done.length === 0 ? (
          <EmptyState title="Хариулт алга" description="Одоогоор хариулт ирээгүй байна." />
        ) : (
          <Card pad="none" className="divide-y divide-border-soft overflow-hidden">
            {done.map((row) => {
              const open = openChildId === row.child.id;
              const panelId = `survey-child-answers-${row.child.id}`;
              return (
                <div key={row.child.id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenChildId(open ? null : row.child.id)}
                    className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-canvas"
                  >
                    <Initial child={row.child} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">
                        {shortName(row.child)}
                      </span>
                      {row.group ? (
                        <span className="block truncate text-caption text-muted">
                          {row.group.name}
                        </span>
                      ) : null}
                    </span>
                    <ChevronDown
                      size={18}
                      aria-hidden="true"
                      className={cn(
                        "shrink-0 text-muted transition-transform",
                        open ? "rotate-180" : null,
                      )}
                    />
                  </button>

                  {open ? (
                    <div
                      id={panelId}
                      className="border-t border-border-soft bg-sunken px-3 py-3 pb-4"
                    >
                      {answersPending ? (
                        <LoadingState rows={questions.length} />
                      ) : (
                        <dl className="flex flex-col gap-3">
                          {questions.map((question, index) => (
                            <div key={question.question.id} className="flex flex-col gap-1">
                              <dt className="text-caption leading-snug text-muted">
                                {index + 1}. {question.question.prompt}
                              </dt>
                              <dd>
                                <AnswerValue
                                  result={question}
                                  value={valueOf(index, row.child.id)}
                                />
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </Card>
        )
      ) : todo.length === 0 ? (
        <EmptyState title="Бүгд бөглөсөн" description="Бөглөөгүй хүүхэд байхгүй байна." />
      ) : (
        /*
          A pending row goes to the child rather than opening — there is nothing
          to open, and the next thing a teacher does with this list is find the
          family's number.
        */
        <Card pad="none" className="divide-y divide-border-soft overflow-hidden">
          {todo.map((row) => (
            <Link
              key={row.child.id}
              href={`/children/${row.child.id}/general`}
              className="flex min-h-14 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-canvas"
            >
              <Initial child={row.child} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">{shortName(row.child)}</span>
                {row.group ? (
                  <span className="block truncate text-caption text-muted">{row.group.name}</span>
                ) : null}
              </span>
              <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

/** The initial in a circle, the roster's own avatar. */
function Initial({ child }: { child: { firstName: string } }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-9 shrink-0 place-items-center rounded-pill bg-sunken text-caption font-bold text-muted"
    >
      {(child.firstName[0] ?? "?").toUpperCase()}
    </span>
  );
}

/**
 * One child's answer to one question, drawn the way that type reads.
 *
 * A rating and a yes/no are one word and carry a colour; a free text is a
 * paragraph and carries none; a multiple choice is however many it picked. The
 * value arrives as whatever JSON the answering form wrote, so the shape is
 * checked here rather than assumed from the type alone.
 */
function AnswerValue({ result, value }: { result: SurveyQuestionResult; value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-body text-muted">Хариулаагүй</span>;
  }

  /* CHECKBOX answers with the options it picked. */
  if (Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1.5">
        {value.map((entry, index) => (
          <span
            key={index}
            className="rounded-pill bg-surface px-2.5 py-1 text-caption font-semibold text-ink"
          >
            {String(entry)}
          </span>
        ))}
      </span>
    );
  }

  /* MATRIX answers with a score per indicator row. */
  if (typeof value === "object") {
    return (
      <span className="flex flex-col gap-1">
        {Object.entries(value as Record<string, unknown>).map(([indicator, score]) => {
          const band = typeof score === "number" ? RATING_BAND[score] : undefined;
          return (
            <span key={indicator} className="flex items-center gap-2 text-body">
              <span className="min-w-0 flex-1 truncate text-muted">{indicator}</span>
              <span className="shrink-0 font-semibold text-ink">
                {band?.label ?? String(score)}
              </span>
            </span>
          );
        })}
      </span>
    );
  }

  if (result.question.type === "TEXT") {
    return (
      <span className="block rounded-row bg-surface px-3 py-2 text-body text-ink">
        {String(value)}
      </span>
    );
  }

  /*
    A single choice is its own option, uncut — `answerBadge` shortens a value to
    fit a 32-wide pill in a list, and this one has the full row.
  */
  if (result.question.type === "SINGLE_CHOICE") {
    return (
      <span className="inline-block rounded-pill bg-surface px-2.5 py-1 text-caption font-semibold text-ink">
        {String(value)}
      </span>
    );
  }

  const badge = answerBadge(result, value);
  return (
    <span
      className={cn(
        "inline-block rounded-pill px-2.5 py-1 text-caption font-semibold",
        badge.tone ? TONE_SURFACE[badge.tone] : "bg-surface text-ink",
      )}
    >
      {badge.label}
    </span>
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
  /*
    One heading id per question — every question draws its own card now, and a
    duplicated id would point every section's label at the first one.
  */
  const headingId = `survey-comparison-${questionId}`;
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
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-lead font-semibold text-ink">
        Өмнө авсан ижил судалгаатай харьцуулах
      </h3>

      <Card pad="roomy" className="flex flex-col gap-4">
        {/*
          ★ The question itself heads the card — the client's own second
          drawing. Its section already carries the prompt, but this card is the
          piece a teacher screenshots for a meeting, and a chart with no
          question on it is a chart about nothing.
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
