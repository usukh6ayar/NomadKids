"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { SURVEY_KIND_LABEL, pollTallySchema, type surveySchema } from "@kinder/contracts";
import type { z } from "zod";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  ageThen,
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
    One grey line of facts, in the order a parent scans them: which kind it is,
    how many questions, when it ran, and how old they were. The age is the same
    number the filter offers, so a chip and a row cannot disagree.
  */
  const facts = [
    SURVEY_KIND_LABEL[survey.kind],
    survey.questions.length > 0 ? `${survey.questions.length} асуулт` : null,
    formatDate(surveyDate(survey)),
    ageThen === null || ageThen === undefined ? null : `${ageThen} нас`,
  ].filter(Boolean);

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
          <span className="block font-semibold leading-snug text-ink">{survey.title}</span>
          <span className="mt-1 block text-caption text-muted">{facts.join(" · ")}</span>
        </span>

        <span className={cn("shrink-0 text-caption font-semibold", STATE_TEXT[state])}>
          {stateLabel}
        </span>

        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-faint" />
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
        <div className="border-t border-border-soft px-4 py-2.5">
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
              <p className="truncate text-caption text-muted">{question.prompt}</p>
            ) : null}

            {question.options.map((option) => {
              const percent = total === 0 ? 0 : Math.round((option.count / total) * 100);
              const mine = Array.isArray(question.myAnswer)
                ? question.myAnswer.includes(option.label)
                : question.myAnswer === option.label;

              return (
                <div key={option.label} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-caption",
                      mine ? "font-semibold text-primary" : "text-muted",
                    )}
                  >
                    {option.label}
                    {mine ? " · таны сонголт" : ""}
                  </span>

                  <span
                    aria-hidden="true"
                    className="h-1 w-16 overflow-hidden rounded-pill bg-track sm:w-24"
                  >
                    <span
                      className={cn("block h-full rounded-pill", mine ? "bg-primary" : "bg-border")}
                      style={{ width: `${percent}%` }}
                    />
                  </span>

                  <span className="w-9 shrink-0 text-end text-caption tabular-nums text-muted">
                    {percent}%
                  </span>
                </div>
              );
            })}
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
    <dl className="flex flex-col gap-1">
      {survey.questions.map((question) => (
        <div key={question.id} className="flex items-baseline gap-2">
          <dt className="min-w-0 flex-1 truncate text-caption text-muted">{question.prompt}</dt>
          <dd className="shrink-0 text-caption font-medium text-ink">
            {shortAnswer(question.type, byQuestion.get(question.id))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The same rendering `FamilyAnswers` does, kept to one short line. */
function shortAnswer(type: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map(String).join(", ");
  if (type === "RATING") return `${String(value)} / 5`;
  if (type === "YES_NO") return value === true || value === "true" ? "Тийм" : "Үгүй";
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([row, score]) => `${row}: ${String(score)}`)
      .join(" · ");
  }
  return String(value);
}
