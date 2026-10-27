"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { z } from "zod";
import { a79GroupSummarySchema, surveySchema } from "@kinder/contracts";
import {
  A79ChildrenTable,
  A79SummaryChart,
  KindergartenSummaryBody,
  a79ChildRows,
  type A79ReportGroup,
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

const isA79Baseline = (s: StaffSurvey) =>
  s.respondent === "TEACHER" &&
  s.period === "BASELINE" &&
  s.status !== "DRAFT" &&
  baselineLevel(s.questions) !== null;

/**
 * The А/79 baselines of some groups, merged per group — one survey list, one
 * sheet per survey, one fee read per group, however many groups ask.
 *
 * ★ A group's baselines are its published or closed teacher surveys of the
 * Гарааны wave whose questions are one level's criteria. A class may have one
 * per level (2026-10-21, the user: five children on IV, seven on III); a
 * Гарааны survey that is not А/79 is not one of them. A survey addressed to
 * no one group (a director's «бүх бүлэг») counts for each group, its rows
 * narrowed to that group's children.
 *
 * ★★ Who the server withholds figures for — a solo workspace's unpaid child
 * (CLAUDE.md §1.7) — is read from the result summary's flag alone; nothing of
 * the result itself is shown. Absent (404, not built), nobody is.
 */
function useGroupBaselines(groupIds: string[]) {
  const { primaryKindergartenId } = useSession();
  const surveys = useQuery({
    queryKey: qk.kindergartenSurveys(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/surveys`, staffSurveysSchema),
    enabled: Boolean(primaryKindergartenId),
  });
  const baselines = (surveys.data ?? []).filter(
    (s) => isA79Baseline(s) && (!s.groupId || groupIds.includes(s.groupId)),
  );
  const sheets = useQueries({
    queries: baselines.map((survey) => ({
      queryKey: ["survey", survey.id, "teacher-sheet"],
      queryFn: () => get(`/surveys/${survey.id}/teacher-sheet`, sheetSchema),
    })),
  });
  const fees = useQueries({
    queries: groupIds.map((id) => ({
      // The key `useA79GroupSummary` uses — one read shared with the result screen.
      queryKey: ["group", id, "a79-summary", null, null],
      queryFn: () => get(`/groups/${id}/a79-summary`, a79GroupSummarySchema),
      retry: false,
      enabled: baselines.length > 0,
    })),
  });

  const isLoading =
    surveys.isLoading ||
    (baselines.length > 0 && (sheets.some((q) => q.isLoading) || fees.some((q) => q.isLoading)));
  const error = surveys.error ?? sheets.find((q) => q.isError)?.error ?? null;

  const byGroup = new Map(
    groupIds.map((groupId, index) => {
      const feeDue = new Set(
        (fees[index]?.data?.children ?? []).filter((c) => c.feeDue).map((c) => c.childId),
      );
      const own = baselines.flatMap((survey, i) =>
        (!survey.groupId || survey.groupId === groupId) && sheets[i]?.data
          ? [
              {
                questions: sheets[i]!.data!.survey.questions,
                rows: sheets[i]!.data!.rows.filter((row) => !row.group || row.group.id === groupId),
              },
            ]
          : [],
      );
      const merged = mergeBaselines(own);
      return [
        groupId,
        {
          hasSurvey: baselines.some((s) => !s.groupId || s.groupId === groupId),
          merged: merged ? withFeeDue(merged, feeDue) : null,
        },
      ] as const;
    }),
  );
  return { isLoading, error, byGroup };
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
  const { isLoading, error, byGroup } = useGroupBaselines([groupId]);
  const group = byGroup.get(groupId);

  const body = (() => {
    if (isLoading) return <LoadingState rows={4} />;
    if (error) return <ErrorState description={errorMessage(error)} />;
    if (!group?.hasSurvey) {
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
    const merged = group.merged;
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
    const partial = merged.children.filter((c) => c.partial);
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
        {partial.length > 0 ? (
          <p className="text-caption text-muted">
            Дутуу бөглөсөн (хариулаагүй шалгуурыг биелээгүйд тооцов):{" "}
            {partial.map((c) => `${shortName(c)} (${c.answered}/${c.total})`).join(", ")}
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

/**
 * The director's «Гарааны үнэлгээ» — the kindergarten chart and one row per
 * group, as the result tab draws its own (2026-10-22, the user: a director
 * sees every group, so the groups first; a group's children one click on).
 * «6/8» is how many of the group were assessed; a group with no А/79
 * baseline says so instead of a 0.
 */
export function A79BaselineKindergartenPanel({ groups }: { groups: A79ReportGroup[] }) {
  const { isLoading, error, byGroup } = useGroupBaselines(groups.map((g) => g.id));

  return (
    <section className="mt-3 flex flex-col gap-3">
      <SectionHeader title="Гарааны үнэлгээ" as="h2" />
      {isLoading ? <LoadingState rows={3} /> : null}
      {error ? <ErrorState description={errorMessage(error)} /> : null}
      {!isLoading && !error && groups.length === 0 ? (
        <EmptyState title="Бүлэг бүртгэгдээгүй байна" />
      ) : null}
      {!isLoading && !error && groups.length > 0 ? (
        <KindergartenSummaryBody
          groups={groups.map((group) => ({
            group,
            summary: asGroupSummary(byGroup.get(group.id)?.merged ?? { children: [] }),
          }))}
          hrefFor={(groupId) => `/groups/${groupId}/baseline`}
          countFor={(groupId) => {
            const merged = byGroup.get(groupId)?.merged;
            if (!merged) return "—";
            const assessed = merged.children.filter((c) => !c.notFilled).length;
            return `${assessed}/${merged.children.length}`;
          }}
          noDataLabel="Гарааны үнэлгээ аваагүй"
          emptyTitle="Гарааны үнэлгээ хараахан аваагүй байна"
          emptyDescription="Багш нар «А/79 Гарааны үнэлгээ» судалгааг бөглөсний дараа бүлгийн үзүүлэлтүүд энд харагдана."
        />
      ) : null}
    </section>
  );
}
