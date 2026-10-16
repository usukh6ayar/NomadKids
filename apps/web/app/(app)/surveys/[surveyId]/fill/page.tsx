"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { z } from "zod";
import { surveySchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { TeacherSheet, teacherSheetRowSchema } from "@/components/survey/teacher-sheet";

const sheetSchema = z.object({
  survey: surveySchema,
  rows: z.array(teacherSheetRowSchema),
});

/**
 * Багшийн судалгаа, filled in for the whole group at once — client,
 * 2026-09-21. The table is `TeacherSheet`; this page loads it.
 */
export default function TeacherSheetPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <TeacherSheetScreen />
    </RequireRole>
  );
}

function TeacherSheetScreen() {
  const { surveyId } = useParams<{ surveyId: string }>();
  const backHref = `/surveys/${surveyId}`;

  const sheet = useQuery({
    queryKey: ["survey", surveyId, "teacher-sheet"],
    queryFn: () => get(`/surveys/${surveyId}/teacher-sheet`, sheetSchema),
  });

  const title = sheet.data?.survey.title ?? "Багшийн судалгаа";

  return (
    <div className="flex flex-col gap-4 py-2">
      <PageHeader backHref={backHref} title={title} />

      {sheet.isLoading ? <LoadingState rows={5} /> : null}
      {sheet.isError ? <ErrorState description={errorMessage(sheet.error)} /> : null}

      {sheet.data && sheet.data.rows.length === 0 ? (
        <EmptyState
          title="Бөглөх хүүхэд алга"
          description="Таны бүлэгт хүүхэд элсүүлсний дараа энд хүснэгтээр бөглөнө."
        />
      ) : null}

      {sheet.data && sheet.data.rows.length > 0 ? (
        <>
          {sheet.data.survey.status !== "PUBLISHED" ? (
            <p className="rounded-card bg-sunken px-4 py-3 text-body text-muted">
              Энэ судалгаа нийтлэгдээгүй эсвэл хаагдсан тул зөвхөн харах боломжтой.
            </p>
          ) : null}
          <TeacherSheet
            key={sheet.dataUpdatedAt}
            surveyId={surveyId}
            questions={sheet.data.survey.questions}
            rows={sheet.data.rows}
            editable={sheet.data.survey.status === "PUBLISHED"}
          />
        </>
      ) : null}
    </div>
  );
}
