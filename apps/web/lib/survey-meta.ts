import { BarChart3, CheckCircle2, ListChecks, PenLine } from "lucide-react";

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
export const SURVEY_TYPE_META: Record<
  "RATING" | "YES_NO" | "CHECKBOX" | "TEXT",
  { label: string; tone: "mint" | "sky" | "sun" | "peach"; Icon: typeof BarChart3 }
> = {
  RATING: { label: "Рэйтинг судалгаа", tone: "mint", Icon: BarChart3 },
  YES_NO: { label: "Тийм/Үгүй судалгаа", tone: "sky", Icon: CheckCircle2 },
  CHECKBOX: { label: "Сонголтот судалгаа", tone: "sun", Icon: ListChecks },
  TEXT: { label: "Нээлттэй судалгаа", tone: "peach", Icon: PenLine },
};

export const SURVEY_TONE_BG: Record<string, string> = {
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  sun: "bg-sun text-sun-ink",
  peach: "bg-peach text-peach-ink",
};
