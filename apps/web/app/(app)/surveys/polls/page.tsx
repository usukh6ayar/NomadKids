"use client";

import { SurveyBoard } from "@/components/survey/survey-board";

/** Асуулга — the polls. See `forms/page.tsx` on why this is a static segment. */
export default function SurveyPollsPage() {
  return <SurveyBoard kind="POLL" />;
}
