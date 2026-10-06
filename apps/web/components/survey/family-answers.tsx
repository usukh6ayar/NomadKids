"use client";

import {
  SURVEY_CATEGORY_LABEL,
  SURVEY_PERIOD_LABEL,
  type SurveyQuestion,
  type surveySchema,
} from "@kinder/contracts";
import type { z } from "zod";
import { formatDate } from "@/lib/format";
import { stars } from "@/lib/stars";

type Survey = z.infer<typeof surveySchema>;

/**
 * What this family sent, read back.
 *
 * ★ Lifted out of the family's survey list on 2026-09-17, when the rows
 * stopped unfolding. The panel it used to draw inside a row is now what the
 * survey's own page shows for an answered questionnaire — the same content in
 * the one place a parent is taken to, rather than a small second copy of it in
 * a list.
 *
 * ★★ Their own answers, never the kindergarten's aggregate. A questionnaire's
 * distribution is the teacher's screen; `/children/:id/surveys/:id/tally`
 * answers a poll and 404s a form for exactly that reason (§1.7). A poll's
 * shares are drawn by `PollAnswer` instead, which is where an answered poll
 * already lands.
 */
export function FamilyAnswers({ survey }: { survey: Survey }) {
  const byQuestion = new Map((survey.myAnswers ?? []).map((row) => [row.questionId, row.value]));

  if (survey.questions.length === 0) {
    return <p className="text-body text-muted">Асуулт алга.</p>;
  }

  /*
    ★ Question and answer told apart — client, 2026-10-06 ("асуулт хариулт
    мэдэгдэхгүй байна"). Each question is numbered and in ink; the answer
    sits under it on a tinted block, so the eye never has to guess which line
    is which. No «Таны хариулт» label — taken off the same day; the tint says
    it.
  */
  return (
    <ol className="flex flex-col gap-3">
      {survey.questions.map((question, index) => {
        const value = byQuestion.get(question.id);
        const text = answerText(question, value);
        const blank = text === "Хариулаагүй";
        return (
          <li key={question.id} className="flex flex-col gap-1.5">
            <p className="flex gap-2 text-body font-semibold leading-snug text-ink">
              <span className="shrink-0 text-muted tabular-nums">{index + 1}.</span>
              <span>{question.prompt}</span>
            </p>
            <div className="ml-6 rounded-control bg-canvas px-3 py-2">
              <p className={blank ? "text-body text-faint" : "text-body text-ink"}>{text}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * What the survey is — its subject, who it went to, when it ran — above the
 * answers. Client, 2026-10-06: "судалгаа хэн хэзээ авсан ямар чиглэлийн
 * судалгаа болох мэдэгдэх".
 *
 * ★ "Хэн" is the audience, not the author: the survey payload carries no
 * creator (`Survey.createdById` exists but is not sent to a family), so the
 * card names the group it went to, or the whole kindergarten.
 */
export function SurveyFacts({ survey }: { survey: Survey }) {
  const facts: { label: string; value: string }[] = [
    { label: "Чиглэл", value: SURVEY_CATEGORY_LABEL[survey.category] ?? "—" },
    {
      label: "Хамрах хүрээ",
      value: survey.group?.name ? `${survey.group.name} бүлэг` : "Бүх цэцэрлэг",
    },
    ...(survey.period || survey.term
      ? [
          {
            label: "Үе шат",
            value: [survey.term?.name, survey.period ? SURVEY_PERIOD_LABEL[survey.period] : null]
              .filter(Boolean)
              .join(" · "),
          },
        ]
      : []),
    { label: "Эхэлсэн", value: formatDate(survey.publishedAt ?? survey.createdAt) },
    ...(survey.closedAt || survey.closesAt
      ? [
          {
            label: survey.closedAt ? "Дууссан" : "Дуусах",
            value: formatDate(survey.closedAt ?? survey.closesAt),
          },
        ]
      : []),
  ];
  const about = survey.purpose?.trim() || survey.description?.trim();

  return (
    <div className="flex flex-col gap-2.5">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-caption">
        {facts.map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="text-muted">{fact.label}</dt>
            <dd className="text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {about ? <p className="text-caption leading-snug text-muted">{about}</p> : null}
    </div>
  );
}

function answerText(question: SurveyQuestion, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Хариулаагүй";
  if (Array.isArray(value))
    return value.length === 0 ? "Хариулаагүй" : value.map(String).join(", ");

  if (question.type === "RATING") return stars(value);
  if (question.type === "YES_NO") return value === true || value === "true" ? "Тийм" : "Үгүй";

  /* MATRIX answers with a score per indicator — "Хэл яриа: 4" a line each. */
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([row, score]) => `${row}: ${String(score)}`)
      .join(" · ");
  }

  return String(value);
}
