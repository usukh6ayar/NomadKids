"use client";

import { useQuery } from "@tanstack/react-query";
import { adminDashboardSchema, type AdminDashboard } from "@kinder/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AssessmentSwitch } from "@/components/assessment/assessment-switch";
import {
  A79_DEMO_NOTE,
  a79ChildRows,
  a79GroupAverages,
  useA79GroupSummary,
} from "@/components/assessment/a79-group-summary";
import { DemoBanner } from "@/components/feedback/feedback-parts";
import { Badge } from "@/components/ui/badge";
import { A79_BAND_LABEL, a79Band } from "@/lib/a79-progress";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/card";
import { TableShell, Td, Th } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";

type Coverage = AdminDashboard["assessmentCoverage"][number];

function coveragePercent(group: Pick<Coverage, "children" | "assessed">) {
  if (group.children <= 0) return 0;
  return Math.min(100, Math.round((group.assessed / group.children) * 100));
}

/*
  ★ «Явцын үнэлгээ» · «Үр дүнгийн үнэлгээ» for the director too — 2026-10-08,
  the client: "удирдлага үнэлгээ дээр явцын ба үр дүнгийнх бас харагдана".
  The same switch a teacher has on their group, here across the groups: the
  progress table as it was, and the groups each opening their А/79 result.
  In the address (`?view=results`), as the teacher's two are two routes.
*/
const SWITCH_HREFS = { progress: "/admin/assessment", results: "/admin/assessment?view=results" };

export function AdminAssessmentOverview() {
  const view = useSearchParams().get("view") === "results" ? "results" : "progress";
  const dashboard = useQuery({
    queryKey: qk.dashboard.admin(),
    queryFn: () => get("/dashboard/admin", adminDashboardSchema),
  });

  const header = (
    <>
      <PageHeader title="Үнэлгээ" />
      {/* Pulled up under the title — 2026-10-08, the client: "зайг дээш шах". */}
      <div className="-mt-2 mb-3">
        <AssessmentSwitch active={view} hrefs={SWITCH_HREFS} />
      </div>
    </>
  );

  if (dashboard.isLoading) {
    return (
      <>
        {header}
        <LoadingState rows={4} shape="cards" />
      </>
    );
  }

  if (dashboard.isError) {
    return (
      <>
        {header}
        <ErrorState
          description={errorMessage(dashboard.error)}
          action={
            <Button variant="secondary" onClick={() => void dashboard.refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      </>
    );
  }

  const data = dashboard.data!;
  const coverage = data.assessmentCoverage;

  if (view === "results") {
    return (
      <>
        {header}
        {/* No «Бүлгүүд» heading: the table says what it is, and the space went. */}
        <section aria-label="Бүлгүүд">
          <ResultsDemoNote firstGroupId={coverage[0]?.groupId} />
          {coverage.length === 0 ? (
            <EmptyState
              title="Бүлэг бүртгэгдээгүй байна"
              description="Бүлэг нэмсний дараа үр дүнгийн үнэлгээ энд харагдана."
            />
          ) : (
            <TableShell caption="Бүлгүүдийн үр дүнгийн үнэлгээ" minWidth="min-w-[640px]">
              <thead>
                <tr>
                  <Th className="w-12">№</Th>
                  <Th>Бүлэг</Th>
                  <Th numeric>Хүүхэд</Th>
                  <Th numeric>Мэдлэг</Th>
                  <Th numeric>Чадвар</Th>
                  <Th numeric>Төлөвшил</Th>
                  <Th numeric>Нийт</Th>
                  <Th>Үр дүн</Th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((group, index) => (
                  <ResultRow key={group.groupId} index={index} group={group} />
                ))}
              </tbody>
            </TableShell>
          )}
        </section>
      </>
    );
  }

  /*
    ★ One table, and nothing else — client, 2026-09-25: "аль болох хүснэгтэн
    минимал албан харагдуул", then the summary table, the lede, the legend
    and the status column removed the same day. Each group's counts and its
    percentage, in plain type.
  */
  return (
    <>
      <PageHeader
        title="Үнэлгээ"
        actions={
          <span className="text-body text-muted">
            {data.currentTerm?.name ?? "Улирал тохируулаагүй"}
          </span>
        }
      />
      {/* Pulled up under the title — 2026-10-08, the client: "зайг дээш шах". */}
      <div className="-mt-2 mb-3">
        <AssessmentSwitch active="progress" hrefs={SWITCH_HREFS} />
      </div>

      <div className="flex flex-col gap-4">
        <section aria-labelledby="assessment-groups-heading">
          <SectionHeader id="assessment-groups-heading" title="Бүлгүүдийн харьцуулалт" />

          {!data.currentTerm ? (
            <EmptyState
              title="Идэвхтэй улирал тохируулаагүй байна"
              description="Улирал тохируулсны дараа бүлгүүдийн үнэлгээний явц харагдана."
              action={
                <Button asChild size="sm">
                  <Link href="/admin/terms">Улирал тохируулах</Link>
                </Button>
              }
            />
          ) : coverage.length === 0 ? (
            <EmptyState
              title="Үнэлгээний мэдээлэл алга"
              description="Идэвхтэй бүлэг бүртгэгдээгүй байна."
            />
          ) : (
            <TableShell caption="Бүлгүүдийн үнэлгээний гүйцэтгэл" minWidth="min-w-[640px]">
              <thead>
                <tr>
                  <Th className="w-12">№</Th>
                  <Th>Бүлэг</Th>
                  <Th numeric>Хүүхэд</Th>
                  <Th numeric>Үнэлсэн</Th>
                  <Th numeric>Дутуу</Th>
                  <Th numeric>Гүйцэтгэл</Th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((group, index) => (
                  <tr key={group.groupId}>
                    <Td className="tabular-nums text-muted">{index + 1}</Td>
                    <Td>
                      <Link
                        href={`/groups/${group.groupId}/assessment`}
                        className="font-medium text-ink hover:text-primary hover:underline"
                      >
                        {group.name}
                      </Link>
                    </Td>
                    <Td numeric>{group.children}</Td>
                    <Td numeric>{group.assessed}</Td>
                    <Td numeric>{Math.max(0, group.children - group.assessed)}</Td>
                    <Td numeric>{group.children > 0 ? `${coveragePercent(group)}%` : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </section>
      </div>
    </>
  );
}

const BAND_TONE = { MASTERED: "mint", PROGRESSING: "sun", DEVELOPING: "peach" } as const;

/**
 * One group's А/79 averages — Мэдлэг · Чадвар · Төлөвшил · Нийт, the client's
 * 2026-10-08 ask. Each row reads its group's summary through the hook the
 * group's own result page uses, so the two show the same figures and share
 * the cache. One request a group: a kindergarten-wide endpoint would make it
 * one in all, and is the backend's to add.
 */
function ResultRow({ index, group }: { index: number; group: Coverage }) {
  const { data } = useA79GroupSummary(group.groupId);
  const averages = data ? a79GroupAverages(a79ChildRows(data)) : null;
  const cell = (value: number | undefined) => (value === undefined ? "—" : `${value}%`);
  const band = averages ? a79Band(averages.total) : null;
  return (
    <tr>
      <Td className="tabular-nums text-muted">{index + 1}</Td>
      <Td>
        <Link
          href={`/groups/${group.groupId}/results`}
          className="font-medium text-ink hover:text-primary hover:underline"
        >
          {group.name}
        </Link>
      </Td>
      <Td numeric>{group.children}</Td>
      <Td numeric>{cell(averages?.byDomain.Мэдлэг)}</Td>
      <Td numeric>{cell(averages?.byDomain.Чадвар)}</Td>
      <Td numeric>{cell(averages?.byDomain.Төлөвшил)}</Td>
      <Td numeric className="font-semibold text-ink">
        {cell(averages?.total)}
      </Td>
      <Td>{band ? <Badge tone={BAND_TONE[band]}>{A79_BAND_LABEL[band]}</Badge> : null}</Td>
    </tr>
  );
}

/** Said once above the table while the figures are samples. */
function ResultsDemoNote({ firstGroupId }: { firstGroupId?: string }) {
  const { demo } = useA79GroupSummary(firstGroupId ?? "");
  return demo ? (
    <div className="mb-3">
      <DemoBanner>{A79_DEMO_NOTE}</DemoBanner>
    </div>
  ) : null;
}
