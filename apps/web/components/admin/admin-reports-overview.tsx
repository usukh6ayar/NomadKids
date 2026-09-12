"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { groupReportSchema, termSchema, type GroupReport } from "@kinder/contracts";
import Link from "next/link";
import {
  CalendarCheck2,
  ChevronRight,
  ClipboardCheck,
  Eye,
  FileWarning,
  Lightbulb,
  MessageSquare,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/shell/app-shell";
import { useSwitchableGroups } from "@/components/shell/group-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { BarRow } from "@/components/ui/chart/bar-row";
import { LineChart } from "@/components/ui/chart/line-chart";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatCard } from "@/components/ui/stat-card";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { formatDayMonth } from "@/lib/format";
import { cn } from "@/lib/utils";

const termsSchema = z.array(termSchema);
type Period = "month" | "term" | "year";

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

function yearRange() {
  const now = new Date();
  const startYear = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return { from: `${startYear}-09-01`, to: `${startYear + 1}-08-31` };
}

function percent(value: number, total: number) {
  return total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
}

function groupAssessmentPercent(report: GroupReport) {
  return percent(report.assessment.assessed, report.children);
}

export function AdminReportsOverview() {
  const { primaryKindergartenId } = useSession();
  const groups = useSwitchableGroups();
  const [period, setPeriod] = useState<Period>("month");
  const [month, setMonth] = useState(currentMonth);
  const [termId, setTermId] = useState("");

  const terms = useQuery({
    queryKey: ["kindergarten", primaryKindergartenId, "terms"],
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/terms`, termsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });
  const termItems = terms.data ?? [];
  const activeTerm = termItems.find((term) => term.id === termId) ?? termItems.at(-1);
  const range =
    period === "month"
      ? monthRange(month)
      : period === "year"
        ? yearRange()
        : activeTerm?.startsOn && activeTerm.endsOn
          ? { from: activeTerm.startsOn.slice(0, 10), to: activeTerm.endsOn.slice(0, 10) }
          : null;

  const groupItems = groups.data?.items ?? [];
  const reportQueries = useQueries({
    queries: groupItems.map((group) => ({
      queryKey: ["group", group.id, "report", range?.from, range?.to],
      queryFn: () =>
        get(`/groups/${group.id}/report?from=${range!.from}&to=${range!.to}`, groupReportSchema),
      enabled: Boolean(range),
    })),
  });
  const reports = reportQueries.flatMap((query) => (query.data ? [query.data] : []));
  const loading =
    groups.isLoading || terms.isLoading || reportQueries.some((query) => query.isLoading);
  const failed = groups.isError || terms.isError || reportQueries.some((query) => query.isError);

  const totalChildren = reports.reduce((sum, report) => sum + report.children, 0);
  const assessed = reports.reduce((sum, report) => sum + report.assessment.assessed, 0);
  const missing = Math.max(0, totalChildren - assessed);
  const attended = reports.reduce((sum, report) => sum + report.attendance.attended, 0);
  const recorded = reports.reduce((sum, report) => sum + report.attendance.recorded, 0);
  const observedChildren = reports.reduce((sum, report) => sum + report.observations.children, 0);
  const observations = reports.reduce((sum, report) => sum + report.observations.total, 0);
  const surveyResponses = reports.reduce((sum, report) => sum + report.surveys.responded, 0);
  const assessmentPercent = percent(assessed, totalChildren);
  const attendancePercent = percent(attended, recorded);
  const observationPercent = percent(observedChildren, totalChildren);
  const surveyPercent = percent(surveyResponses, totalChildren);
  const domainDenominator = reports.reduce(
    (sum, report) => sum + report.children * Math.max(1, report.terms.length),
    0,
  );

  const domainMap = new Map<string, { name: string; count: number }>();
  const dayMap = new Map<string, number[]>();
  for (const report of reports) {
    for (const domain of report.assessment.byDomain) {
      const current = domainMap.get(domain.id) ?? { name: domain.name, count: 0 };
      current.count += domain.count;
      domainMap.set(domain.id, current);
    }
    for (const day of report.attendance.byDay) {
      if (day.percent === null) continue;
      const values = dayMap.get(day.date) ?? [];
      values.push(day.percent);
      dayMap.set(day.date, values);
    }
  }
  const domains = [...domainMap.values()];
  const trend = [...dayMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({
      label: formatDayMonth(date),
      value: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    }));
  const attentionGroups = reports
    .filter((report) => groupAssessmentPercent(report) < 85)
    .sort((left, right) => groupAssessmentPercent(left) - groupAssessmentPercent(right));
  const leadingGroups = [...reports]
    .sort((left, right) => groupAssessmentPercent(right) - groupAssessmentPercent(left))
    .slice(0, 3);

  const retry = () => {
    void groups.refetch();
    void terms.refetch();
    for (const query of reportQueries) void query.refetch();
  };

  return (
    <div className="page-band">
      <PageHeader
        title="Цэцэрлэгийн нэгтгэл"
        lede="Бүлгүүдийн хүүхдийн хөгжил, ирц болон оролцооны ерөнхий тойм"
        meta={
          range ? (
            <Badge tone="sky">
              {formatDayMonth(range.from)} – {formatDayMonth(range.to)}
            </Badge>
          ) : null
        }
      />

      <Card pad="compact" className="mb-5 flex flex-wrap items-end gap-3">
        <div
          role="radiogroup"
          aria-label="Тайлангийн хугацаа"
          className="grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-control bg-canvas p-1 sm:max-w-md"
        >
          {(
            [
              ["month", "Сар"],
              ["term", "Улирал"],
              ["year", "Жил"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                "min-h-11 rounded-control px-3 text-body font-medium transition-colors",
                period === value
                  ? "bg-primary text-primary-ink shadow-sm"
                  : "text-muted hover:bg-surface",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {period === "month" ? (
          <label className="flex w-full flex-col gap-1 text-caption text-muted sm:w-56">
            Сар
            <input
              aria-label="Тайлангийн сар"
              type="month"
              max={currentMonth()}
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="min-h-11 rounded-control border border-border bg-surface px-3 text-body text-ink"
            />
          </label>
        ) : null}
        {period === "term" && termItems.length > 0 ? (
          <label className="flex w-full flex-col gap-1 text-caption text-muted sm:w-64">
            Улирал
            <select
              aria-label="Тайлангийн улирал"
              value={activeTerm?.id ?? ""}
              onChange={(event) => setTermId(event.target.value)}
              className="min-h-11 rounded-control border border-border bg-surface px-3 text-body text-ink"
            >
              {termItems.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.number}. {term.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </Card>

      {failed ? (
        <ErrorState
          description={errorMessage(
            groups.error ?? terms.error ?? reportQueries.find((query) => query.error)?.error,
          )}
          action={<Button onClick={retry}>Дахин оролдох</Button>}
        />
      ) : loading ? (
        <LoadingState rows={4} shape="cards" />
      ) : groupItems.length === 0 ? (
        <EmptyState title="Бүлэг бүртгэгдээгүй байна" />
      ) : !range ? (
        <EmptyState
          title="Улирал тохируулаагүй байна"
          description="Удирдлагын хэсгээс улирал үүсгэнэ үү."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <section
            aria-label="Тайлангийн товч үзүүлэлт"
            className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
          >
            <StatCard
              label="Нийт бүлэг"
              value={reports.length}
              unit="бүлэг"
              tone="cornflower"
              art={<UsersRound size={21} />}
            />
            <StatCard
              label="Нийт хүүхэд"
              value={totalChildren}
              unit="хүүхэд"
              tone="sun"
              art={<UsersRound size={21} />}
            />
            <StatCard
              label="Үнэлгээ хийсэн"
              value={assessed}
              unit={`${assessmentPercent}%`}
              tone="mint"
              art={<ClipboardCheck size={21} />}
            />
            <StatCard
              label="Ирцтэй"
              value={attended}
              unit={`${attendancePercent}%`}
              tone="sky"
              art={<CalendarCheck2 size={21} />}
            />
            <StatCard
              label="Ажиглалттай"
              value={observedChildren}
              unit={`${observationPercent}%`}
              tone="teal"
              art={<Eye size={21} />}
            />
            <StatCard
              label="Үнэлгээ дутуу"
              value={missing}
              unit="хүүхэд"
              tone="peach"
              art={<FileWarning size={21} />}
            />
          </section>

          <div className="grid items-start gap-4 xl:grid-cols-2">
            <section aria-labelledby="report-trend-heading">
              <SectionHeader
                id="report-trend-heading"
                title="Ирцийн хандлага"
                lede="Бүх бүлгийн өдрийн дундаж"
              />
              <Card pad="roomy">
                {trend.length ? (
                  <LineChart points={trend} label="Ирцийн хандлага" />
                ) : (
                  <p className="py-14 text-center text-body text-muted">
                    Энэ хугацаанд ирц бүртгээгүй байна.
                  </p>
                )}
              </Card>
            </section>

            <section aria-labelledby="report-domains-heading">
              <SectionHeader
                id="report-domains-heading"
                title="Хөгжлийн чиглэлээр"
                lede="Үнэлгээнд хамрагдсан хүүхдийн хувь"
              />
              <Card pad="roomy" className="flex flex-col gap-3">
                {domains.length ? (
                  domains.map((domain, index) => (
                    <BarRow
                      key={domain.name}
                      inline
                      label={domain.name}
                      labelWidth="w-[136px] xl:w-[180px]"
                      percent={percent(domain.count, domainDenominator)}
                      value={`${percent(domain.count, domainDenominator)}%`}
                      accessibleLabel={`${domain.name} — ${percent(domain.count, domainDenominator)}% хамрагдсан`}
                      tone={(["sky", "mint", "sun", "cornflower", "teal"] as const)[index % 5]}
                    />
                  ))
                ) : (
                  <p className="py-14 text-center text-body text-muted">
                    Үнэлгээний мэдээлэл алга.
                  </p>
                )}
              </Card>
            </section>
          </div>

          <section aria-labelledby="group-report-table-heading">
            <SectionHeader
              id="group-report-table-heading"
              title="Бүлгүүдийн нэгдсэн тайлан"
              lede={`${formatDayMonth(range.from)} – ${formatDayMonth(range.to)}`}
            />
            <Card className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] border-collapse text-body">
                <caption className="sr-only">Бүлгүүдийн нэгдсэн тайлан</caption>
                <thead className="bg-canvas text-caption text-muted">
                  <tr>
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-3 py-3 text-left">Бүлгийн нэр</th>
                    <th className="px-3 py-3 text-right">Хүүхэд</th>
                    <th className="px-3 py-3 text-right">Үнэлсэн</th>
                    <th className="px-3 py-3 text-right">Гүйцэтгэл</th>
                    <th className="px-3 py-3 text-right">Ирц</th>
                    <th className="px-3 py-3 text-right">Ажиглалт</th>
                    <th className="px-3 py-3 text-right">Судалгаа</th>
                    <th className="px-3 py-3 text-right">Дутуу</th>
                    <th aria-label="Дэлгэрэнгүй" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {reports.map((report, index) => {
                    const completion = groupAssessmentPercent(report);
                    return (
                      <tr key={report.group.id} className="hover:bg-canvas">
                        <td className="px-4 py-3 tabular-nums text-muted">{index + 1}</td>
                        <td className="px-3 py-3 font-medium text-ink">{report.group.name}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{report.children}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {report.assessment.assessed}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Badge
                            tone={completion >= 95 ? "mint" : completion >= 80 ? "sun" : "peach"}
                          >
                            {completion}%
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {report.attendance.percent === null
                            ? "—"
                            : `${report.attendance.percent}%`}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {report.observations.total}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {report.surveys.responded}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-peach-ink">
                          {Math.max(0, report.children - report.assessment.assessed)}
                        </td>
                        <td className="px-3 py-3">
                          <Link
                            href={`/groups/${report.group.id}/assessment`}
                            aria-label={`${report.group.name} дэлгэрэнгүй`}
                            className="text-primary"
                          >
                            <ChevronRight size={18} aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
            <div className="flex flex-col gap-3 md:hidden">
              {reports.map((report) => {
                const completion = groupAssessmentPercent(report);
                return (
                  <Link
                    key={report.group.id}
                    href={`/groups/${report.group.id}/assessment`}
                    className="block rounded-card"
                  >
                    <Card pad="compact">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-ink">{report.group.name}</h3>
                          <p className="text-caption text-muted">
                            {report.children} хүүхэд · {report.assessment.assessed} үнэлсэн
                          </p>
                        </div>
                        <Badge
                          tone={completion >= 95 ? "mint" : completion >= 80 ? "sun" : "peach"}
                        >
                          {completion}%
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-caption text-muted">
                        <span>
                          Ирц{" "}
                          <b className="block text-body text-ink">
                            {report.attendance.percent === null
                              ? "—"
                              : `${report.attendance.percent}%`}
                          </b>
                        </span>
                        <span>
                          Ажиглалт{" "}
                          <b className="block text-body text-ink">{report.observations.total}</b>
                        </span>
                        <span>
                          Дутуу{" "}
                          <b className="block text-body text-peach-ink">
                            {Math.max(0, report.children - report.assessment.assessed)}
                          </b>
                        </span>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>

          <div className="grid items-start gap-4 xl:grid-cols-2">
            <Card pad="roomy">
              <div className="flex items-center gap-2">
                <MessageSquare size={20} className="text-primary" />
                <h2 className="text-lead font-semibold text-ink">Сарын онцлох үзүүлэлт</h2>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  { label: "Ирцийн дундаж", value: `${attendancePercent}%` },
                  { label: "Судалгааны оролцоо", value: `${surveyPercent}%` },
                  { label: "Ажиглалт", value: observations },
                  { label: "Ажиглалттай хүүхэд", value: observedChildren },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-caption text-muted">{item.label}</p>
                    <p className="mt-1 text-title font-semibold tabular-nums text-ink">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
            <Card pad="roomy" tone={attentionGroups.length ? "sun" : "mint"}>
              <div className="flex items-center gap-2">
                <Lightbulb size={20} className="text-sun-ink" />
                <h2 className="text-lead font-semibold text-ink">Анхаарах зүйл</h2>
              </div>
              <ul className="mt-3 flex flex-col gap-2 text-body text-ink">
                <li>• {attentionGroups.length} бүлгийн үнэлгээний гүйцэтгэл 85%-аас доош байна.</li>
                <li>• {missing} хүүхдийн үнэлгээ дутуу байна.</li>
                {leadingGroups[0] ? (
                  <li>
                    • Шилдэг гүйцэтгэлтэй: {leadingGroups[0].group.name} (
                    {groupAssessmentPercent(leadingGroups[0])}%).
                  </li>
                ) : null}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
