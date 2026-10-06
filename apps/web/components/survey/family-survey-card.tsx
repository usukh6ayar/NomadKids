"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight } from "lucide-react";
import { pollTallySchema, type surveySchema } from "@kinder/contracts";
import type { z } from "zod";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { stars } from "@/lib/stars";

type Survey = z.infer<typeof surveySchema>;

/** Хариулсан · Хариулаагүй · Хаагдсан, as a word rather than a filled pill. */
const STATE_TEXT = {
  answered: "text-mint-ink",
  open: "text-primary",
  closed: "text-muted",
} as const;

/** The date a survey is filed under — closed, else published, else created. */
export function surveyDate(survey: Survey): string {
  return survey.closedAt ?? survey.publishedAt ?? survey.createdAt;
}

/**
 * One survey, as a family reads it — the card on "Миний судалгаанууд".
 *
 * ★ Lifted out of that page on 2026-09-17, because the Судалгаа tab on the
 * board is meant to show the same list — the client: "доод цэсний Мэдээ →
 * Судалгаа таб дээр Миний судалгаанууд хуудсан дээрх жагсаалтын шиг картууд
 * харагд". The tab drew its own 220px tiles; two renderers over one list is
 * how a family comes to see a survey described two ways in two places.
 *
 * ★★ **An answered one navigates; it does not unfold.** Also the client's,
 * same note: "Хариулсан статустай хэсгийг сонгоход доошоо дэлгэгддэг цэс
 * харагдаж байгааг болиулна ... дарсан даруйд дэлгэрэнгүй эсвэл хариулсан үр
 * дүнгийн хуудас руу шилжинэ."
 *
 * What that replaces is a panel that opened inside the row with the family's
 * own answers or the poll's shares in it. The same content is on the survey's
 * own page — a poll shows the class's shares once answered (`PollAnswer`), a
 * questionnaire reads back what was sent (`[surveyId]/page.tsx`) — so the
 * fold was a second, smaller copy of a screen that already existed, and the
 * one row on the list that behaved unlike every other row.
 *
 * ★★★ Every state is a link now, including a closed one. A closed survey still
 * has something to read — the questions, and the family's answers if they sent
 * any — and a card that refuses to open is indistinguishable from one that is
 * broken.
 */
export function FamilySurveyCard({
  childId,
  survey,
  ageThen: _ageThen,
}: {
  childId: string;
  survey: Survey;
  /** How old the child was when it ran; omitted where the list has no ages. */
  ageThen?: number | null;
}) {
  const answered = Boolean(survey.respondedByMe);
  const answerable = !answered && survey.status !== "CLOSED";
  const state = answered ? "answered" : answerable ? "open" : "closed";
  const stateLabel = answered ? "Хариулсан" : answerable ? "Хариулаагүй" : "Хаагдсан";

  /*
    ★ The date alone beside the title — client, 2026-10-06, with a drawing.
    Kind, question count and age used to share that line; the page's filter
    still narrows by kind and age, and the answers under the row say what the
    survey asked.
  */

  return (
    <Card
      pad="none"
      className="overflow-hidden transition-colors hover:border-primary"
      data-testid="survey-row"
    >
      {/*
        ★ The pressed state is on the link itself — the client asked for the
        card to look "дарсан мэт" the moment it is tapped.

        `active:` fires on pointer-down, before the navigation resolves, which
        is exactly the gap it exists to fill: on a phone a route change costs a
        few hundred milliseconds and a card that does not react in them reads
        as a card that did not take the tap.
      */}
      <Link
        href={`/children/${childId}/surveys/${survey.id}`}
        className={cn(
          "flex items-center gap-3 px-4 py-3.5 transition-colors",
          "hover:bg-canvas active:bg-primary-soft active:text-primary",
        )}
      >
        <span className="min-w-0 flex-1">
          {/* The date above the title — client, 2026-10-06 ("эсрэгээрээ"). */}
          <span className="block text-caption tabular-nums text-muted">
            {formatDate(surveyDate(survey))}
          </span>
          <span className="mt-0.5 block text-lead font-bold leading-snug text-ink">
            {survey.title}
          </span>
        </span>

        {/* Answered is a green tick, as drawn; the other two states stay words. */}
        {answered ? (
          <span
            role="img"
            aria-label={stateLabel}
            className="grid size-7 shrink-0 place-items-center rounded-pill bg-mint-solid text-white"
          >
            <Check size={16} strokeWidth={3} aria-hidden="true" />
          </span>
        ) : (
          <span className={cn("shrink-0 text-caption font-semibold", STATE_TEXT[state])}>
            {stateLabel}
          </span>
        )}

        <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-muted" />
      </Link>

      {/*
        ★★★★ An answered survey shows its answer on the card — 2026-09-17, the
        client: "судалгаа дарахад ил харагддаг бай, дарахад харагддаг биш;
        хариулсан байдал ил харагдах".

        The press-to-open panel is not coming back — pressing navigates, and
        that is the previous note. What returns is the *content*, drawn flat
        under the row instead of behind a toggle, so a parent scanning the list
        can see what they said without going anywhere. The row above it is
        still the link to the full screen.

        Outside the `<Link>`, deliberately: a block of text and bars inside an
        anchor is a large target that navigates on a stray tap while somebody
        is reading it.
      */}
      {answered ? (
        <div className="px-3 pb-3">
          {survey.kind === "POLL" ? (
            <CompactShares childId={childId} survey={survey} />
          ) : (
            <CompactAnswers survey={survey} />
          )}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The class's shares, in as little height as they can be read in — the client:
 * "график шахаж зай эзлэхгүй маш нарийн болгох".
 *
 * ★ A 4px bar with the label and the figure on one line above it, and no card,
 * no legend and no heading per question. The full-size version of this is on
 * the survey's own screen (`PollResult`), which is one press away and is where
 * a parent goes to study it; this is the glance.
 *
 * ★★ One request per answered poll on the list, and it is worth naming.
 *
 * The panel this replaces fetched only when a row was expanded, so a list of
 * ten answered polls issued nothing until asked. Flat, it issues ten — bounded
 * by how many polls a family has, cached for a minute, and only for polls they
 * have already answered. If a kindergarten ever runs enough polls for that to
 * matter, the answer is a tally on the list payload rather than a fold.
 */
function CompactShares({ childId, survey }: { childId: string; survey: Survey }) {
  const tally = useQuery({
    queryKey: qk.childSurveyTally(childId, survey.id),
    queryFn: () => get(`/children/${childId}/surveys/${survey.id}/tally`, pollTallySchema),
    staleTime: 60_000,
    retry: false,
  });

  /* A tally this family may not read is not an error worth a red panel — their
     own answer is still worth showing, and that is the fallback. */
  if (tally.isError) return <CompactAnswers survey={survey} />;
  if (tally.isPending) return <p className="text-caption text-muted">Ачаалж байна…</p>;

  const data = tally.data!;
  if (data.questions.length === 0) return <CompactAnswers survey={survey} />;

  return (
    <div className="flex flex-col gap-2">
      {data.questions.map((question) => {
        const total = question.totalResponses;
        return (
          <div key={question.questionId} className="flex flex-col gap-1">
            {data.questions.length > 1 ? (
              <p className="truncate px-1 text-caption text-muted">{question.prompt}</p>
            ) : null}

            <ol className={ANSWER_TABLE}>
              {question.options.map((option, index) => {
                const percent = total === 0 ? 0 : Math.round((option.count / total) * 100);
                const mine = Array.isArray(question.myAnswer)
                  ? question.myAnswer.includes(option.label)
                  : question.myAnswer === option.label;

                return (
                  <li key={option.label} className="flex items-center gap-2.5 px-2.5 py-2">
                    <LineNumber>{index + 1}</LineNumber>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-caption text-ink",
                        mine && "font-semibold",
                      )}
                    >
                      {option.label}
                      {mine ? " · таны сонголт" : ""}
                    </span>

                    <span
                      aria-hidden="true"
                      className="h-2 w-20 shrink-0 overflow-hidden rounded-pill bg-track sm:w-40"
                    >
                      <span
                        className="block h-full rounded-pill bg-gradient-to-r from-sky-solid to-teal-ink/60"
                        style={{ width: `${percent}%` }}
                      />
                    </span>

                    <span className="w-10 shrink-0 text-end text-caption font-semibold tabular-nums text-ink">
                      {percent}%
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A questionnaire's answer, in one line per question.
 *
 * Also the poll's fallback when the tally is refused: their own answer is
 * theirs to read whatever the aggregate rules say (§1.7).
 */
function CompactAnswers({ survey }: { survey: Survey }) {
  const byQuestion = new Map((survey.myAnswers ?? []).map((row) => [row.questionId, row.value]));

  if (survey.questions.length === 0) {
    return <p className="text-caption text-muted">Асуулт алга.</p>;
  }

  return (
    <dl className={ANSWER_TABLE}>
      {survey.questions.map((question, index) => (
        <div
          key={question.id}
          className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,38%)] items-center"
        >
          <span className="py-2 pl-2.5">
            <LineNumber>{index + 1}</LineNumber>
          </span>
          <dt className="px-2.5 py-2 text-caption leading-snug text-ink">{question.prompt}</dt>
          <dd className="self-stretch border-l border-border-soft px-3 py-2 text-caption leading-snug text-ink">
            {shortAnswer(question.type, byQuestion.get(question.id))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The answers as a small bordered table, a numbered line each — client,
 * 2026-10-06, with a drawing: the question, a rule, and what was said.
 */
const ANSWER_TABLE =
  "flex flex-col divide-y divide-border-soft overflow-hidden rounded-control border border-border-soft bg-surface";

/** A line's number on a soft disc. */
function LineNumber({ children }: { children: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-6 shrink-0 place-items-center rounded-pill bg-canvas text-caption font-semibold tabular-nums text-ink"
    >
      {children}
    </span>
  );
}

/** The same rendering `FamilyAnswers` does, kept to one short line. */
function shortAnswer(type: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map(String).join(", ");
  if (type === "RATING") return stars(value);
  if (type === "YES_NO") return value === true || value === "true" ? "Тийм" : "Үгүй";
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([row, score]) => `${row}: ${String(score)}`)
      .join(" · ");
  }
  return String(value);
}
