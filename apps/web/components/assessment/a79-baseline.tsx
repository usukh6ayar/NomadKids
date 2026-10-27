"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { a79GroupSummarySchema, surveySchema } from "@kinder/contracts";
import {
  A79ChildrenTable,
  A79SummaryChart,
  KindergartenSummaryBody,
  a79ChildRows,
  type A79ReportGroup,
} from "@/components/assessment/a79-group-summary";
import {
  A79BaselineNotStarted,
  useBaselineSheets,
} from "@/components/assessment/a79-baseline-fill";
import {
  A79BaselineStartDialog,
  useBaselineSetup,
} from "@/components/assessment/a79-baseline-start";
import { teacherSheetRowSchema } from "@/components/survey/teacher-sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import {
  asGroupSummary,
  isA79BaselineSurvey,
  mergeBaselines,
  withFeeDue,
} from "@/lib/a79-baseline";
import { formatDate, shortName } from "@/lib/format";
import { staffSurveysSchema } from "@/lib/survey-access";

const sheetSchema = z.object({ survey: surveySchema, rows: z.array(teacherSheetRowSchema) });

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
    (s) => isA79BaselineSurvey(s) && (!s.groupId || groupIds.includes(s.groupId)),
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
 * more: they were absent. The report itself has no fill button for them.
 *
 * ★★ `fill` — the group's «Гарааны үнэлгээ» page (2026-10-27, the user): the
 * baseline is started there («Шинэ гарааны үнэлгээ», each child's level
 * chosen), filled by group or by child, and children are added to it. Only
 * the children the teacher put on it are offered to fill; the report pages
 * leave `fill` off and only read.
 */
export function A79BaselinePanel({
  groupId,
  heading = true,
  fill = false,
}: {
  groupId: string;
  heading?: boolean;
  fill?: boolean;
}) {
  const { isLoading, error, byGroup } = useGroupBaselines([groupId]);
  const group = byGroup.get(groupId);

  const body = (() => {
    if (isLoading) return <LoadingState rows={4} />;
    if (error) return <ErrorState description={errorMessage(error)} />;
    if (!group?.hasSurvey) {
      if (fill) return <BaselineStart groupId={groupId} />;
      return (
        <EmptyState
          title="Гарааны үнэлгээ хараахан аваагүй байна"
          description="Багш бүлгийн «Гарааны үнэлгээ» хуудаснаас «Шинэ гарааны үнэлгээ» товчоор эхлүүлнэ."
          action={
            <Link
              href={`/groups/${groupId}/baseline`}
              className={buttonVariants({ variant: "secondary" })}
            >
              Гарааны үнэлгээ
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
        {fill ? <BaselineFillSection groupId={groupId} /> : null}
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
              <A79SummaryChart rows={scored} averageLabel="Гарааны дундаж" />
            ) : null}
            <A79ChildrenTable
              groupId={groupId}
              rows={rows}
              linkChildren={fill}
              childHref={(childId) => `/groups/${groupId}/baseline/${childId}`}
            />
          </>
        ) : (
          <p className="py-6 text-center text-body text-muted">
            Гарааны үнэлгээнд хараахан хүүхэд хамрагдаагүй байна.
          </p>
        )}

        {fill ? (
          <A79BaselineNotStarted
            groupId={groupId}
            listed={new Set(rows.map((row) => row.childId))}
          />
        ) : null}
        {!fill && rows.length > 0 && notAssessed.length > 0 ? (
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

/** «Шинэ гарааны үнэлгээ» — the group has no baseline yet. */
function BaselineStart({ groupId }: { groupId: string }) {
  const setup = useBaselineSetup(groupId);
  const [open, setOpen] = useState(false);
  if (setup.isLoading) return <LoadingState rows={2} />;
  if (setup.error) return <ErrorState description={errorMessage(setup.error)} />;
  const roster = setup.data?.roster ?? [];
  return (
    <>
      <EmptyState
        title="Гарааны үнэлгээ хараахан аваагүй байна"
        description={
          roster.length > 0
            ? "Хүүхдүүдээ сонгож, түвшинг нь тогтоогоод гарааны үнэлгээг эхлүүлнэ үү."
            : "Хүүхэд бүлэгт бүртгэгдсэний дараа гарааны үнэлгээ эхлүүлнэ."
        }
        action={
          roster.length > 0 ? (
            <Button type="button" onClick={() => setOpen(true)}>
              <Plus aria-hidden />
              Шинэ гарааны үнэлгээ
            </Button>
          ) : undefined
        }
      />
      {open ? (
        <A79BaselineStartDialog
          groupId={groupId}
          roster={roster}
          adding={false}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}

/**
 * «Бүлгээр бөглөх» and «Хүүхэд нэмэх» above the report on the group's own
 * page — a child is filled in from their name on the table, or under it.
 */
function BaselineFillSection({ groupId }: { groupId: string }) {
  const setup = useBaselineSetup(groupId);
  const { sheets } = useBaselineSheets(groupId);
  const [adding, setAdding] = useState(false);
  // Children join a baseline made on this page — never the wizard's, which
  // already holds the whole group.
  const left =
    (setup.data?.surveys.length ?? 0) > 0
      ? (setup.data?.roster ?? []).filter((child) => !child.surveyId)
      : [];
  const anyRows = sheets.some((sheet) => sheet.rows.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {anyRows ? (
          <Link
            href={`/groups/${groupId}/baseline/fill`}
            className={buttonVariants({ variant: "primary", size: "sm" })}
          >
            Бүлгээр бөглөх
          </Link>
        ) : null}
        {left.length > 0 ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Хүүхэд нэмэх ({left.length})
          </Button>
        ) : null}
      </div>
      {adding && setup.data ? (
        <A79BaselineStartDialog
          groupId={groupId}
          roster={setup.data.roster}
          adding
          open={adding}
          onOpenChange={setAdding}
        />
      ) : null}
    </div>
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
          emptyDescription="Багш нар бүлгийн «Гарааны үнэлгээ»-г бөглөсний дараа бүлгийн үзүүлэлтүүд энд харагдана."
        />
      ) : null}
    </section>
  );
}
