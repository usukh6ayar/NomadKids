"use client";

import { useQuery } from "@tanstack/react-query";
import { adminDashboardSchema, type AdminDashboard } from "@kinder/contracts";
import Link from "next/link";
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

export function AdminAssessmentOverview() {
  const dashboard = useQuery({
    queryKey: qk.dashboard.admin(),
    queryFn: () => get("/dashboard/admin", adminDashboardSchema),
  });

  const header = <PageHeader title="Явцын үнэлгээ" />;

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

  /*
    ★ One table, and nothing else — client, 2026-09-25: "аль болох хүснэгтэн
    минимал албан харагдуул", then the summary table, the lede, the legend
    and the status column removed the same day. Each group's counts and its
    percentage, in plain type.
  */
  return (
    <>
      <PageHeader
        title="Явцын үнэлгээ"
        actions={
          <span className="text-body text-muted">
            {data.currentTerm?.name ?? "Улирал тохируулаагүй"}
          </span>
        }
      />

      <div className="flex flex-col gap-6 lg:gap-8">
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
