"use client";

import { useQueries } from "@tanstack/react-query";
import { groupReportSchema, type GroupReport } from "@kinder/contracts";
import { BarChart3, CalendarCheck2, ClipboardCheck, MessageSquare, UsersRound } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { useSwitchableGroups } from "@/components/shell/group-switcher";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ColumnChart } from "@/components/ui/chart/columns";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatCard } from "@/components/ui/stat-card";
import { MonthSelect } from "@/components/ui/month-select";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";

function currentMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 7);
}

function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  return {
    from: `${month}-01`,
    to: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10),
  };
}

function percent(value: number, total: number) {
  return total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
}

function groupAssessmentPercent(report: GroupReport) {
  return percent(report.assessment.assessed, report.children);
}

/** Five headline figures and the two comparisons the director asked to keep. */
export function AdminReportsOverview() {
  const groups = useSwitchableGroups();
  const [month, setMonth] = useState(currentMonth);
  const range = monthRange(month);
  const groupItems = groups.data?.items ?? [];
  const reportQueries = useQueries({
    queries: groupItems.map((group) => ({
      queryKey: ["group", group.id, "report", range.from, range.to],
      queryFn: () =>
        get(`/groups/${group.id}/report?from=${range.from}&to=${range.to}`, groupReportSchema),
    })),
  });
  const reports = reportQueries.flatMap((query) => (query.data ? [query.data] : []));
  const loading = groups.isLoading || reportQueries.some((query) => query.isLoading);
  const failed = groups.isError || reportQueries.some((query) => query.isError);

  const totalChildren = reports.reduce((sum, report) => sum + report.children, 0);
  const assessed = reports.reduce((sum, report) => sum + report.assessment.assessed, 0);
  const attended = reports.reduce((sum, report) => sum + report.attendance.attended, 0);
  const recorded = reports.reduce((sum, report) => sum + report.attendance.recorded, 0);
  const surveyResponses = reports.reduce((sum, report) => sum + report.surveys.responded, 0);
  const observationTypes = { daily: 0, conversation: 0, artwork: 0 };
  for (const report of reports) {
    for (const type of report.observations.byType) {
      if (type.code === "daily") observationTypes.daily += type.count;
      if (type.code === "conversation") observationTypes.conversation += type.count;
      if (type.code === "artwork") observationTypes.artwork += type.count;
    }
  }

  const attendancePercent = percent(attended, recorded);
  const assessmentPercent = percent(assessed, totalChildren);
  const surveyPercent = percent(surveyResponses, totalChildren);
  const attendanceColumns = reports.map((report) => ({
    label: report.group.name,
    value: report.attendance.percent,
    accessibleLabel: `${report.group.name} бүлгийн ирц`,
  }));
  const assessmentColumns = reports.map((report) => ({
    label: report.group.name,
    value: groupAssessmentPercent(report),
    accessibleLabel: `${report.group.name} бүлгийн явцын үнэлгээ`,
  }));

  const retry = () => {
    void groups.refetch();
    for (const query of reportQueries) void query.refetch();
  };

  return (
    <div className="page-band">
      <PageHeader
        title="Цэцэрлэгийн нэгдсэн тайлан"
        lede="Бүх бүлгийн хүүхдийн хөгжил, ирц болон үйл ажиллагааны ерөнхий тойм"
        actions={
          <label className="flex w-full flex-col gap-1 text-caption text-muted sm:w-56">
            <span className="sr-only">Тайлангийн сар</span>
            <MonthSelect
              aria-label="Тайлангийн сар"
              max={currentMonth()}
              value={month}
              onValueChange={setMonth}
            />
          </label>
        }
      />

      {failed ? (
        <ErrorState
          description={errorMessage(groups.error ?? reportQueries.find((query) => query.error)?.error)}
          action={<Button onClick={retry}>Дахин оролдох</Button>}
        />
      ) : loading ? (
        <LoadingState rows={4} shape="cards" />
      ) : groupItems.length === 0 ? (
        <EmptyState title="Бүлэг бүртгэгдээгүй байна" />
      ) : (
        <div className="flex flex-col gap-6">
          <section
            aria-label="Тайлангийн товч үзүүлэлт"
            className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
          >
            <StatCard
              label="Нийт хүүхэд"
              value={totalChildren}
              tone="sky"
              art={<UsersRound size={21} />}
            />
            <StatCard
              label="Нийт бүлэг"
              value={reports.length}
              tone="cornflower"
              art={<UsersRound size={21} />}
            />
            <StatCard
              label="Ирц"
              value={`${attendancePercent}%`}
              unit={`${attended} / ${recorded} ирцийн бүртгэл`}
              tone="mint"
              art={<CalendarCheck2 size={21} />}
            />
            <StatCard
              label="Явцын үнэлгээ"
              value={`${assessmentPercent}%`}
              unit={`Ажиглалт ${observationTypes.daily} · Ярилцлага ${observationTypes.conversation} · Бүтээл ${observationTypes.artwork}`}
              tone="sun"
              art={<ClipboardCheck size={21} />}
            />
            <StatCard
              label="Судалгааны явц"
              value={`${surveyPercent}%`}
              unit={`${surveyResponses} / ${totalChildren} хүүхэд`}
              tone="peach"
              art={<MessageSquare size={21} />}
              className="col-span-2 md:col-span-1"
            />
          </section>

          <section aria-labelledby="group-comparison-heading">
            <SectionHeader
              id="group-comparison-heading"
              title="Бүлгүүдийн харьцуулалт"
              icon={<BarChart3 size={20} />}
            />
            <div className="grid items-start gap-4 xl:grid-cols-2">
              <Card pad="roomy">
                <h3 className="mb-5 text-lead font-semibold text-ink">Ирцийн хувь (бүлэг тус бүр)</h3>
                {attendanceColumns.length ? (
                  <ColumnChart
                    columns={attendanceColumns}
                    emptyLabel="ирц бүртгээгүй"
                    height={180}
                  />
                ) : (
                  <p className="py-14 text-center text-body text-muted">Ирцийн мэдээлэл алга.</p>
                )}
              </Card>

              <Card pad="roomy">
                <h3 className="mb-5 text-lead font-semibold text-ink">
                  Явцын үнэлгээний гүйцэтгэл
                </h3>
                {assessmentColumns.length ? (
                  <ColumnChart columns={assessmentColumns} height={180} />
                ) : (
                  <p className="py-14 text-center text-body text-muted">
                    Үнэлгээний мэдээлэл алга.
                  </p>
                )}
              </Card>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
