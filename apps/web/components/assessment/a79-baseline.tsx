"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { z } from "zod";
import { surveySchema } from "@kinder/contracts";
import {
  A79ChildrenTable,
  A79SummaryChart,
  a79ChildRows,
  useA79GroupSummary,
} from "@/components/assessment/a79-group-summary";
import { teacherSheetRowSchema } from "@/components/survey/teacher-sheet";
import { buttonVariants } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { asGroupSummary, baselineLevel, mergeBaselines, withFeeDue } from "@/lib/a79-baseline";
import { formatDate, shortName } from "@/lib/format";
import { staffSurveysSchema, type StaffSurvey } from "@/lib/survey-access";

const sheetSchema = z.object({ survey: surveySchema, rows: z.array(teacherSheetRowSchema) });

/**
 * Every А/79 baseline survey of the group — published or closed teacher
 * surveys of the Гарааны wave whose questions are one level's criteria. A
 * class may have one per level (2026-10-21, the user: five children on IV,
 * seven on III). A Гарааны survey that is not А/79 is not one of them.
 *
 * ★ A survey addressed to no one group (a director's «бүх бүлэг») counts too:
 * its sheet names each row's group, and the panel keeps this group's rows.
 */
function useBaselineSurveys(groupId: string) {
  const { primaryKindergartenId } = useSession();
  const surveys = useQuery({
    queryKey: qk.kindergartenSurveys(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/surveys`, staffSurveysSchema),
    enabled: Boolean(primaryKindergartenId),
  });
  const baselines = (surveys.data ?? []).filter(
    (s: StaffSurvey) =>
      s.respondent === "TEACHER" &&
      s.period === "BASELINE" &&
      (s.groupId === groupId || !s.groupId) &&
      s.status !== "DRAFT" &&
      baselineLevel(s.questions) !== null,
  );
  return { baselines, isLoading: surveys.isLoading, error: surveys.error };
}

/**
 * «Гарааны үнэлгээ» — the group's А/79 baselines in one report, drawn with
 * the result screen's chart and table (2026-10-21, the user). The arithmetic
 * is `lib/a79-baseline.ts`.
 *
 * ★ A child no survey was filled for is listed as not assessed and nothing
 * more: they were absent. No «Бөглөх» link, no fill button — a teacher must
 * never be nudged into filling a row for a child who was not there.
 */
export function A79BaselinePanel({
  groupId,
  heading = true,
}: {
  groupId: string;
  heading?: boolean;
}) {
  const { baselines, isLoading, error } = useBaselineSurveys(groupId);
  const sheets = useQueries({
    queries: baselines.map((survey) => ({
      queryKey: ["survey", survey.id, "teacher-sheet"],
      queryFn: () => get(`/surveys/${survey.id}/teacher-sheet`, sheetSchema),
    })),
  });
  const sheetError = sheets.find((sheet) => sheet.isError)?.error;
  /*
    ★ Who the server withholds figures for — a solo workspace's unpaid child
    (CLAUDE.md §1.7). Only the flag is read from the result summary; nothing
    of the result itself is shown here. Absent (404, not built), nobody is.
  */
  const results = useA79GroupSummary(groupId);
  const feeDue = new Set(
    (results.data?.children ?? []).filter((c) => c.feeDue).map((c) => c.childId),
  );

  const body = (() => {
    if (isLoading) return <LoadingState rows={4} />;
    if (error) return <ErrorState description={errorMessage(error)} />;
    if (baselines.length === 0) {
      return (
        <EmptyState
          title="Гарааны үнэлгээ хараахан аваагүй байна"
          description="«Багшийн судалгаа» хэсгээс «А/79 Гарааны үнэлгээ» загвараар судалгаа үүсгэнэ үү."
          action={
            <Link href="/surveys/teacher" className={buttonVariants({ variant: "secondary" })}>
              Багшийн судалгаа
            </Link>
          }
        />
      );
    }
    // The fee flags are awaited only once there is a baseline to withhold from.
    if (results.isLoading || sheets.some((sheet) => sheet.isLoading)) {
      return <LoadingState rows={4} />;
    }
    if (sheetError) return <ErrorState description={errorMessage(sheetError)} />;

    const mergedRaw = mergeBaselines(
      sheets.flatMap((sheet) =>
        sheet.data
          ? [
              {
                questions: sheet.data.survey.questions,
                // This group's children only — a «бүх бүлэг» survey holds every group's.
                rows: sheet.data.rows.filter((row) => !row.group || row.group.id === groupId),
              },
            ]
          : [],
      ),
    );
    const merged = mergedRaw ? withFeeDue(mergedRaw, feeDue) : null;
    if (!merged || merged.children.length === 0) {
      return (
        <EmptyState
          title="Бүлэгт хүүхэд алга"
          description="Хүүхэд бүлэгт бүртгэгдсэний дараа гарааны үнэлгээ энд харагдана."
        />
      );
    }
    const rows = a79ChildRows(asGroupSummary(merged));
    // Named on the table, counted in no average — the result screen's rule.
    const scored = rows.filter((row) => !row.feeDue);
    const notAssessed = merged.children.filter((c) => c.notFilled);
    const twice = merged.children.filter((c) => c.assessedTwice);

    return (
      <>
        <p className="text-caption text-muted">
          {[
            `${rows.length}/${merged.children.length} хүүхэд үнэлэгдсэн`,
            ...merged.byLevel.map((row) => `${row.level} түвшин ${row.count}`),
            merged.lastSubmittedAt ? formatDate(merged.lastSubmittedAt) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {merged.unmatched > 0 ? (
          <p role="status" className="rounded-control bg-sun px-3 py-2 text-caption text-sun-ink">
            {merged.unmatched} асуулт А/79-ийн шалгууртай таарахгүй тул тоологдоогүй.
          </p>
        ) : null}

        {rows.length > 0 ? (
          <>
            {scored.length > 0 ? (
              <A79SummaryChart
                rows={scored}
                averageLabel="Гарааны дундаж"
                description={`Бүлгийн гарааны дундаж, ${scored.length} хүүхэд. Хүүхдийн хувь бол өөрийн түвшний шалгуурын хэдийг гарааны үнэлгээнд биелүүлсэн нь.`}
              />
            ) : null}
            <A79ChildrenTable groupId={groupId} rows={rows} linkChildren={false} />
          </>
        ) : (
          <p className="py-6 text-center text-body text-muted">
            Гарааны үнэлгээнд хараахан хүүхэд хамрагдаагүй байна.
          </p>
        )}

        {rows.length > 0 && notAssessed.length > 0 ? (
          <p className="text-caption text-muted">
            Гарааны үнэлгээнд хамрагдаагүй: {notAssessed.map((c) => shortName(c)).join(", ")}
          </p>
        ) : null}
        {twice.length > 0 ? (
          <p className="text-caption text-muted">
            Хоёр судалгаагаар үнэлэгдсэн (сүүлийнхийг авсан):{" "}
            {twice.map((c) => shortName(c)).join(", ")}
          </p>
        ) : null}
      </>
    );
  })();

  return (
    <section className="flex flex-col gap-3">
      {heading ? <SectionHeader title="Гарааны үнэлгээ" as="h2" /> : null}
      {body}
    </section>
  );
}
