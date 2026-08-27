"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import Image from "next/image";
import { z } from "zod";
import { surveySchema, surveyResultsSchema, SURVEY_PERIOD_LABEL } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Card, SectionHeader } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
import { BarRow } from "@/components/ui/chart/bar-row";
import { Skeleton } from "@/components/ui/states";
import { formatDate } from "@/lib/format";

/** The survey's face, shared with `/home`'s own survey tile. */
const SURVEY_ART = (
  <IconChip
    icon={<Image src="/icons/icon-survey.webp" alt="" width={48} height={48} />}
    tone="teal"
    size="lg"
  />
);

const surveyListSchema = z.array(surveySchema);

/**
 * How the kindergarten's current survey is going — the sketch's "Судалгаа"
 * panel with its bars and "Нийт 23 хүүхэд бөглөсөн".
 *
 * ★ Two requests, and the second one is gated.
 *
 * The survey list does not carry a response count, so the total has to come
 * from `GET /surveys/:id/results`. That query is `enabled` only once a
 * PUBLISHED survey has actually been found — a kindergarten with no open
 * survey makes exactly one request and renders the empty state, rather than
 * paying for a second round trip to be told there is nothing to show.
 *
 * ★★ The most recently published survey, not "the latest survey".
 *
 * A draft has no responses and a closed one is history; neither is what a
 * teacher needs on a dashboard. The list arrives `createdAt desc`, so the
 * first PUBLISHED row is the current one.
 *
 * ★★★ The bars are per-question response counts, not scores.
 *
 * `surveyQuestionResultSchema` carries how many people answered each question;
 * it does not carry a target. The same argument `ObservationMix` makes applies
 * here — a share is a fact, a completion percentage against a denominator
 * nobody set is a number the screen invented.
 */
export function SurveySummary() {
  const { primaryKindergartenId } = useSession();

  const { data: surveys, isLoading: listLoading } = useQuery({
    queryKey: qk.kindergartenSurveys(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/surveys`, surveyListSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  const active = surveys?.find((s) => s.status === "PUBLISHED") ?? null;

  const { data: results, isLoading: resultsLoading } = useQuery({
    queryKey: qk.surveyResults(active?.id ?? ""),
    queryFn: () => get(`/surveys/${active!.id}/results`, surveyResultsSchema),
    enabled: Boolean(active?.id),
  });

  if (listLoading) {
    return (
      <section aria-labelledby="survey-summary-heading">
        <SectionHeader
          id="survey-summary-heading"
          title="Судалгаа"
          lede="Идэвхтэй судалгаа"
          icon={SURVEY_ART}
        />
        <Card pad="roomy" className="flex flex-col gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-2 w-full" />
        </Card>
      </section>
    );
  }

  return (
    <section aria-labelledby="survey-summary-heading">
      <SectionHeader
        id="survey-summary-heading"
        title="Судалгаа"
        lede={active ? "Идэвхтэй судалгаа" : undefined}
        icon={SURVEY_ART}
        action={
          <Link
            href="/surveys"
            className="text-body font-medium text-primary hover:text-primary-strong"
          >
            Бүгд →
          </Link>
        }
      />

      <Card pad="roomy">
        {!active ? (
          /*
            ★ 64px, not the product's usual 96px empty-state mascot.

            This card sits in the narrower half of a 7/5 row beside the class
            board, and measured at 1440px the full-size illustration made the
            empty survey ~290px tall against the board's ~150px — so the row
            read as lopsided by accident rather than by weighting. The board is
            meant to be the larger of the two; an empty state should not be
            what overturns that.
          */
          /*
            ★ `mascot-family`, not `mascot-teacher` — which this used to draw.

            The hero at the top of the same screen now carries the teacher
            mascot, and the same drawing twice on one page reads as a template
            rather than as illustration. The family is also the better subject:
            a survey is the kindergarten asking parents something, and this
            state is offering to start that.
          */
          <div className="flex flex-col items-center gap-1.5 py-1 text-center">
            <Image src="/background/mascot-family.webp" alt="" width={64} height={64} />
            <p className="text-body font-medium text-ink">Идэвхтэй судалгаа алга</p>
            <p className="text-caption text-muted">
              Судалгаа үүсгээд нийтэлснээр эцэг эхчүүд бөглөж эхэлнэ.
            </p>
            <Link
              href="/surveys"
              className="mt-1 text-body font-medium text-primary hover:text-primary-strong"
            >
              Судалгаа үүсгэх →
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <div className="min-w-0">
                <Link
                  href={`/surveys/${active.id}`}
                  className="text-lead font-semibold leading-heading text-ink hover:text-primary"
                >
                  {active.title}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-caption text-muted">
                  {active.period ? (
                    <span className="rounded-pill bg-primary-soft px-2 py-0.5 font-medium text-primary">
                      {SURVEY_PERIOD_LABEL[active.period]}
                    </span>
                  ) : null}
                  {active.publishedAt ? (
                    <span>{formatDate(active.publishedAt)}-нд нийтэлсэн</span>
                  ) : null}
                </p>
              </div>

              {/*
                The headline number the sketch calls for. It waits for its own
                query rather than rendering a zero that would later change —
                a count that corrects itself upward reads as data loss.
              */}
              {/*
                ★ A `div`, not a `p`. `Skeleton` renders a `<div>`, and a
                `<div>` inside a `<p>` is invalid HTML: the browser closes the
                paragraph early, so the server's tree and the client's differ
                and React reports a hydration error. Found in the browser
                console, not by any test — jsdom parses the nesting happily.
              */}
              <div className="shrink-0 text-right">
                {resultsLoading ? (
                  <Skeleton className="ml-auto h-7 w-12" />
                ) : (
                  <span className="block font-semibold tabular-nums leading-heading text-ink text-display">
                    {results?.totalResponses ?? 0}
                  </span>
                )}
                <span className="block text-caption text-muted">хариулт</span>
              </div>
            </div>

            {results && results.questions.length > 0 ? (
              <QuestionBars questions={results.questions} total={results.totalResponses} />
            ) : !resultsLoading ? (
              <p className="border-t border-border-soft pt-2.5 text-caption text-muted">
                Хараахан хэн ч бөглөөгүй байна.
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </section>
  );
}

/**
 * One bar per question — how many of the total answered it.
 *
 * Capped at four rows. A twenty-question survey would turn a dashboard tile
 * into a scrolling report; the survey's own screen is where that belongs, and
 * the link above goes there.
 *
 * ★ `BarRow`, not the markup this file used to inline — the same move
 * `ObservationMix` made, and for the same reason: track height, radius and the
 * transition become one decision for every chart in the product instead of one
 * per screen.
 *
 * ★★ It carries `role="img"` with a sentence, where this used to declare
 * `role="progressbar"` — and the change is a correction, not a side effect.
 *
 * A progressbar is announced as a number out of a hundred, which asserts that
 * somebody set a target of "everyone answers every question". Nothing in
 * `surveyQuestionResultSchema` sets one. `ObservationMix` refused exactly this
 * framing in its visible text and then shipped it in its ARIA; this file was
 * doing the same thing. "Асуулт: 12 хариулт" is the fact.
 */
function QuestionBars({
  questions,
  total,
}: {
  questions: z.infer<typeof surveyResultsSchema>["questions"];
  total: number;
}) {
  const shown = questions.slice(0, 4);

  return (
    <div className="flex flex-col gap-2.5 border-t border-border-soft pt-3">
      {shown.map((row) => {
        const answered = row.responseCount;
        const share = total === 0 ? 0 : Math.round((answered / total) * 100);

        return (
          <BarRow
            key={row.question.id}
            label={row.question.prompt}
            percent={share}
            tone="teal"
            value={answered}
            accessibleLabel={`${row.question.prompt}: ${answered} хариулт`}
          />
        );
      })}

      {questions.length > shown.length ? (
        <p className="text-caption text-muted">+{questions.length - shown.length} асуулт</p>
      ) : null}
    </div>
  );
}
