"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { z } from "zod";
import { ClipboardList } from "lucide-react";
import { hasOptionList, surveySchema, surveyResultsSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { BoardCard, BoardCardEmpty } from "./board-card";
import { ColumnChart } from "@/components/ui/chart/columns";
import { Skeleton } from "@/components/ui/states";

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

  if (listLoading || (Boolean(active?.id) && resultsLoading)) return <SurveySkeleton />;

  if (!active) {
    return (
      <BoardCard title="Судалгаа">
        <BoardCardEmpty
          icon={<ClipboardList size={22} />}
          title="Идэвхтэй судалгаа алга"
          hint="Судалгаа нийтэлснээр эцэг эхчүүд бөглөж эхэлнэ."
        />
      </BoardCard>
    );
  }

  const columns = optionColumns(results?.questions[0]);

  return (
    <BoardCard
      title="Судалгаа"
      /*
        "23 хүн", where the sketch puts it. `totalResponses` is how many people
        answered the survey — not how many answered the question the chart
        draws, which is a different and less useful number.
      */
      figure={`${results?.totalResponses ?? 0} хүн`}
      footer={
        <Link
          href={`/surveys/${active.id}`}
          className="line-clamp-1 text-caption text-muted hover:text-primary"
        >
          {active.title}
        </Link>
      }
    >
      {columns ? (
        /*
          Turned labels only when they are sentences. A rating scale is five
          single digits and a Тийм/Үгүй pair is two short words — both sit flat,
          and turning them would cost 84px of card height to no purpose.
        */
        <ColumnChart
          columns={columns}
          tilted={columns.some((column) => column.label.length > 6)}
          emptyLabel="хариулаагүй"
          height={120}
        />
      ) : (
        /*
          A published survey nobody has answered, or a first question that has
          no fixed choices to count — a free-text or matrix question, where
          `counts` is null and a bar chart would be inventing categories. Both
          are the same thing to a reader: there is nothing to draw yet.
        */
        <BoardCardEmpty
          icon={<ClipboardList size={22} />}
          title={
            (results?.totalResponses ?? 0) === 0 ? "Хараахан хэн ч бөглөөгүй" : "Хариулт бэлэн"
          }
          hint={
            (results?.totalResponses ?? 0) === 0
              ? "Эцэг эхчүүд бөглөж эхэлмэгц энд харагдана."
              : "Дэлгэрэнгүйг судалгааны хуудаснаас."
          }
        />
      )}
    </BoardCard>
  );
}

/**
 * The first question's answers, as chart columns — the sketch's own bars.
 *
 * ★ Three question types can be charted and they name their buckets three
 * different ways, which is why this is a function rather than a loop over
 * `counts`.
 *
 * `surveys.service.ts` builds `counts` per type:
 *
 *   CHECKBOX  keyed by the choice text; `question.options` is the choice list
 *   RATING    keyed by the stringified number — "1".."5"; no `options`
 *   YES_NO    keyed by "true" / "false"; no `options`
 *   TEXT      `counts: null` — free prose, nothing to count
 *
 * A CHECKBOX walks `options` rather than `counts`, because `counts` is a
 * `Record` whose key order is whatever the server serialised and whose absent
 * key is an unchosen answer. Iterating it would reorder the scale between
 * renders and silently drop the choice nobody picked — and a satisfaction scale
 * missing its bottom rung reads far better than it is. The other two walk their
 * own fixed scale, for the same reason.
 *
 * ★★ The labels are the scale's, never a reading of it.
 *
 * The client's sketch labels the five rating columns "Маш сэтгэл ханамжтай"
 * down to "Маш хангалтгүй". Those words are not in this product: a RATING
 * question stores 1-5 and the screen a parent answers on
 * (`/children/:id/surveys/:id`) shows exactly that, five numbered buttons. The
 * prompt above them is free text and can ask anything, so naming 5 "very
 * satisfied" would be right for a satisfaction poll and wrong for "how many
 * days a week does your child read?". The columns carry the scale the question
 * was actually answered on. Naming a rating scale is a product decision that
 * belongs in the survey builder, beside the prompt, not guessed at here.
 *
 * ★★★ Percentages of the answered total, not raw counts. Five bars at 1, 2, 0,
 * 1, 0 are unreadable at this height; the same five as shares are the shape the
 * sketch draws. Returns `null` when there is nothing honest to draw, and the
 * caller renders a state for that.
 */
function optionColumns(
  first: z.infer<typeof surveyResultsSchema>["questions"][number] | undefined,
) {
  if (!first) return null;

  const counts = first.counts;
  if (!counts) return null;

  const scale = bucketsFor(first.question);
  if (!scale) return null;

  const answered = scale.reduce((sum, bucket) => sum + (counts[bucket.key] ?? 0), 0);
  if (answered === 0) return null;

  return scale.map((bucket) => ({
    label: bucket.label,
    value: Math.round(((counts[bucket.key] ?? 0) / answered) * 100),
    accessibleLabel: bucket.label,
  }));
}

/**
 * The buckets a question's answers fall into, in the question's own order.
 *
 * `null` for anything with no fixed scale — TEXT, and a MATRIX, whose `options`
 * is rows *and* columns rather than one axis. `Array.isArray` is what narrows
 * that union; without it a matrix renders `[object Object]`.
 *
 * ★ SINGLE_CHOICE shares CHECKBOX's buckets — 2026-09-12, the same fix as
 * `slicesOf` in `survey/survey-results-view.tsx`, found beside it. A poll is
 * one single-choice question by definition, so this branch decided whether the
 * card drew anything at all for the commonest thing on the board, and it
 * answered `null`. `hasOptionList` rather than a second literal, so the pair of
 * types that carry an option list stays the contract's fact.
 */
function bucketsFor(
  question: z.infer<typeof surveyResultsSchema>["questions"][number]["question"],
): { key: string; label: string }[] | null {
  if (question.type === "RATING") {
    return [1, 2, 3, 4, 5].map((n) => ({ key: String(n), label: String(n) }));
  }

  if (question.type === "YES_NO") {
    return [
      { key: "true", label: "Тийм" },
      { key: "false", label: "Үгүй" },
    ];
  }

  if (hasOptionList(question.type) && Array.isArray(question.options)) {
    return question.options.map((option) => ({ key: option, label: option }));
  }

  return null;
}

/** The card's footprint with nothing in it yet — title row, plot, footer. */
function SurveySkeleton() {
  return (
    <Card pad="roomy" className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-14" />
      </div>
      <Skeleton className="h-[144px] w-full rounded-control" />
      <Skeleton className="mt-auto h-3 w-40" />
    </Card>
  );
}
