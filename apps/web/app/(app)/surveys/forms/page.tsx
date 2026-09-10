"use client";

import { SurveyBoard } from "@/components/survey/survey-board";

/**
 * Судалгаа — the questionnaires.
 *
 * ★ A static segment, deliberately placed beside `[surveyId]`.
 *
 * Next.js resolves a literal segment before a dynamic one, so `/surveys/forms`
 * can never be read as a survey whose id is "forms". The alternative — a query
 * string on `/surveys` — would have made the two kinds one page again, which
 * is the thing the client asked to undo.
 */
export default function SurveyFormsPage() {
  return <SurveyBoard kind="FORM" />;
}
