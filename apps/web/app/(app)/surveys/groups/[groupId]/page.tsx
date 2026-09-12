"use client";

import { useParams } from "next/navigation";
import { GroupSurveyBoard } from "@/components/survey/survey-board";

/** Management's group-scoped survey and poll list. */
export default function GroupSurveysPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return <GroupSurveyBoard groupId={groupId} />;
}
