"use client";

import { type SurveyQuestion, type surveySchema } from "@kinder/contracts";
import type { z } from "zod";

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

  return (
    <dl className="flex flex-col gap-3">
      {survey.questions.map((question, index) => (
        <div key={question.id} className="flex flex-col gap-1">
          <dt className="text-caption leading-snug text-muted">
            {index + 1}. {question.prompt}
          </dt>
          <dd className="text-body leading-snug text-ink">
            {answerText(question, byQuestion.get(question.id))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One answer as a sentence fragment.
 *
 * ★ A rating reads "4 / 5" rather than a word.
 *
 * The teacher's analysis screen names the bands ("Маш сайн") because it is
 * comparing distributions; a family reading their own answer back wants the
 * thing they actually chose. Keeping the score here also keeps this screen out
 * of a vocabulary it would then have to stay in step with — the kind of
 * hand-copied list CLAUDE.md §7 records going wrong in four places at once.
 */
function answerText(question: SurveyQuestion, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Хариулаагүй";
  if (Array.isArray(value))
    return value.length === 0 ? "Хариулаагүй" : value.map(String).join(", ");

  if (question.type === "RATING") return `${String(value)} / 5`;
  if (question.type === "YES_NO") return value === true || value === "true" ? "Тийм" : "Үгүй";

  /* MATRIX answers with a score per indicator — "Хэл яриа: 4" a line each. */
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([row, score]) => `${row}: ${String(score)}`)
      .join(" · ");
  }

  return String(value);
}
