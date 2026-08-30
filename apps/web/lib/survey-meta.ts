import { BarChart3, CheckCircle2, CircleDot, Grid3x3, ListChecks, PenLine } from "lucide-react";
import type { SurveyQuestionType } from "@kinder/contracts";

/**
 * How a survey's own first question decides its tag, icon and tint.
 *
 * ★ Taken from `questions[0].type`, not from the survey itself — a survey has
 * no type field of its own (`surveySchema`, `packages/contracts/src/domain.ts`),
 * only its questions do. Real surveys built through the sidebar's `/surveys`
 * form are one question per survey in practice, so the first question's shape
 * is an honest stand-in for "what kind of survey is this" without inventing a
 * field the schema does not have.
 *
 * Shared by the notifications page's "Судалгаа" tab and
 * `/children/[childId]/surveys` — one map, so the two lists cannot disagree
 * on what a rating survey's icon or colour is.
 */
/**
 * ★ Keyed by `SurveyQuestionType`, not by a hand-written union — and that is
 * the repair for how this file broke the build rather than a tidy-up.
 *
 * The two sides of the 2026-08-27 merge never touched the same line. One added
 * `MATRIX` to `surveyQuestionTypeSchema` (RFP Module 1.1); the other wrote this
 * map over the four kinds that existed when it was written. Git merged both
 * cleanly and the result did not compile: `survey.questions[0].type` can be
 * `MATRIX`, and `Record<"RATING" | …>` has no such key. It failed in Vercel's
 * `next build`, which is the first place anything looked.
 *
 * Spelling the union by hand is what made that possible. Taking the key type
 * from the contract means the next kind added to the enum is a type error in
 * this file on the day it lands, not a production build failure a week later.
 */
export const SURVEY_TYPE_META: Record<
  SurveyQuestionType,
  { label: string; tone: "mint" | "sky" | "sun" | "peach"; Icon: typeof BarChart3 }
> = {
  RATING: { label: "Рэйтинг судалгаа", tone: "mint", Icon: BarChart3 },
  YES_NO: { label: "Тийм/Үгүй судалгаа", tone: "sky", Icon: CheckCircle2 },
  /*
   * ★ This entry is the mechanism above working as intended.
   *
   * `SINGLE_CHOICE` was added to the contract on 2026-08-31 and this file
   * stopped compiling the same minute — which is exactly what the note says
   * taking the key type from the enum buys, rather than finding out from a
   * Vercel build a week later.
   *
   * `sun` is shared with `CHECKBOX` deliberately: both are "pick from a list",
   * and the palette admits four tones for six types, so the two that are the
   * same shape share one rather than borrowing a tone that means something
   * else on the other screens.
   */
  SINGLE_CHOICE: { label: "Нэг сонголтот судалгаа", tone: "sun", Icon: CircleDot },
  CHECKBOX: { label: "Сонголтот судалгаа", tone: "sun", Icon: ListChecks },
  TEXT: { label: "Нээлттэй судалгаа", tone: "peach", Icon: PenLine },
  /*
   * Several indicators on one shared scale. `cornflower` would be the tone the
   * palette files as "category", but this map's own type admits only the four
   * the other kinds use, and widening it is a visual decision for the survey
   * screens rather than something a merge repair should make. `sky` is the
   * neutral-information tone and the honest placeholder.
   */
  MATRIX: { label: "Матриц судалгаа", tone: "sky", Icon: Grid3x3 },
};

export const SURVEY_TONE_BG: Record<string, string> = {
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  sun: "bg-sun text-sun-ink",
  peach: "bg-peach text-peach-ink",
};
