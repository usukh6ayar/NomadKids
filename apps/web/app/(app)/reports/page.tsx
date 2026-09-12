"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { z } from "zod";
import { groupReportSchema, termSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { GroupSwitcher, useSwitchableGroups } from "@/components/shell/group-switcher";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatCard } from "@/components/ui/stat-card";
import { BarRow } from "@/components/ui/chart/bar-row";
import { ColumnChart } from "@/components/ui/chart/columns";
import { Donut } from "@/components/ui/chart/donut";
import { ATTENDANCE_STATUS_CHART_TONE, ATTENDANCE_STATUS_LABEL } from "@/lib/attendance-meta";
import { formatDayMonth } from "@/lib/format";
import { cn } from "@/lib/utils";

const termsSchema = z.array(termSchema);

/**
 * "Тайлан" — a teacher's own group, over a month, a term or a school year.
 *
 * ★ Rebuilt 2026-09-12 to the client's design, and the period is the change.
 *
 * This screen was one month of attendance and nothing else, which is what the
 * client asked to be rid of: "багшид байгаа тайлангийн мэдээллүүдийг арилган
 * шинийг оруул". A report is what a teacher hands over at the end of a term or
 * a year, so the period selector is the first control and everything below it
 * follows the same range.
 *
 * ★★ One request, not four. `GET /groups/:id/report` returns the attendance,
 * the assessment coverage, the notes by kind and the surveys together. Composing
 * them here would put the report's arithmetic in a browser, where the file a
 * teacher downloads cannot reach it — and two answers to one question drift the
 * first time either side changes a filter.
 */
export default function ReportsPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <Suspense fallback={<LoadingState rows={4} />}>
        <Reports />
      </Suspense>
    </RequireRole>
  );
}

type Period = "month" | "term" | "year";

const TABS = [
  { key: "summary", label: "Нэгтгэл" },
  { key: "attendance", label: "Ирцийн тайлан" },
  { key: "assessment", label: "Явцын үнэлгээ" },
  { key: "surveys", label: "Судалгааны тайлан" },
  { key: "observations", label: "Ажиглалтын тайлан" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** `YYYY-MM` for today, in the UTC framing every date on this screen uses. */
function currentMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 7);
}

/** The first and last day of a `YYYY-MM`. */
function monthRange(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, monthNumber, 0));
  return { from: `${month}-01`, to: last.toISOString().slice(0, 10) };
}

/**
 * The school year containing today, as a range.
 *
 * ★ September to August, which is the Mongolian school year and what every
 * `SchoolYear` in this product spans. Derived rather than read from the table
 * because the year selector has to work before a kindergarten has configured
 * one, and being a month out at the edges is better than an empty screen.
 */
function yearRange(): { from: string; to: string } {
  const now = new Date();
  const startYear = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return { from: `${startYear}-09-01`, to: `${startYear + 1}-08-31` };
}

function Reports() {
  const { group } = useMyGroup();
  const { primaryKindergartenId } = useSession();
  const searchParams = useSearchParams();

  /*
    ★ A director gets a group picker instead of a dead end — 2026-09-09.

    The group is in the query string rather than in local state, so a director
    comparing two groups can keep both open and the Back button steps between
    them — the reason `GroupSwitcher` is links everywhere else.
  */
  const groups = useSwitchableGroups(!group);
  const items = groups.data?.items ?? [];
  const chosen = searchParams.get("group") ?? "";
  const groupId =
    group?.id ?? (items.some((item) => item.id === chosen) ? chosen : items[0]?.id) ?? "";

  const [period, setPeriod] = useState<Period>("month");
  const [month, setMonth] = useState(currentMonth);
  const [termId, setTermId] = useState("");
  const [tab, setTab] = useState<TabKey>("summary");

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

  const report = useQuery({
    queryKey: ["group", groupId, "report", range?.from, range?.to],
    queryFn: () =>
      get(`/groups/${groupId}/report?from=${range!.from}&to=${range!.to}`, groupReportSchema),
    enabled: Boolean(groupId && range),
  });

  const header = (
    <PageHeader
      title="Тайлан"
      lede="Багшийн өдөр тутмын ажил, хүүхдийн хөгжил, эцэг эхийн оролцооны нэгтгэл"
    />
  );

  if (!groupId && !groups.isLoading) {
    return (
      <div className="page-band">
        {header}
        <EmptyState
          title="Бүлэг хараахан хуваарилагдаагүй байна"
          description="Тайлан нэг бүлгийн ажлыг нэгтгэж харуулна. Бүлэг хуваарилагдсаны дараа энд гарч ирнэ."
        />
      </div>
    );
  }

  return (
    <div className="page-band">
      {header}

      <GroupSwitcher groups={items} activeGroupId={groupId} href={(id) => `/reports?group=${id}`} />

      {/*
        ★ Сар · Улирал · Жил — the client's three, 2026-09-12.

        One range drives every figure below, which is why the selector is one
        control rather than a period picker per tab: a report where the
        attendance covers September and the surveys cover the year is four
        reports in a trench coat.
      */}
      <Card pad="roomy" className="flex flex-col gap-3">
        <div
          role="radiogroup"
          aria-label="Хугацаа"
          className="grid grid-cols-3 gap-1 rounded-control bg-canvas p-1"
        >
          {(
            [
              ["month", "Сар"],
              ["term", "Улирал"],
              ["year", "Бүтэн жил"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                "min-h-[44px] rounded-control px-2 text-body font-medium transition-colors",
                period === value
                  ? "bg-primary text-primary-ink shadow-sm"
                  : "text-muted hover:bg-surface hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {period === "month" ? (
          <Field label="Сар" className="w-full sm:w-56">
            {({ id }) => (
              <Input
                id={id}
                type="month"
                max={currentMonth()}
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            )}
          </Field>
        ) : null}

        {period === "term" ? (
          termItems.length === 0 ? (
            <p className="text-body text-muted">
              Улирал бүртгэгдээгүй байна. Захирал улирал үүсгэсний дараа сонгоно.
            </p>
          ) : (
            <Field label="Улирал" className="w-full sm:w-56">
              {({ id }) => (
                <Select
                  id={id}
                  value={activeTerm?.id ?? ""}
                  onChange={(event) => setTermId(event.target.value)}
                >
                  {termItems.map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.number}. {term.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )
        ) : null}

        {range ? (
          <p className="text-caption text-muted">
            {formatDayMonth(range.from)} – {formatDayMonth(range.to)}
          </p>
        ) : null}
      </Card>

      {report.isLoading ? <LoadingState rows={4} /> : null}
      {report.isError ? <ErrorState description={errorMessage(report.error)} /> : null}

      {report.data ? <ReportBody report={report.data} tab={tab} onTab={setTab} /> : null}
    </div>
  );
}

function ReportBody({
  report,
  tab,
  onTab,
}: {
  report: z.infer<typeof groupReportSchema>;
  tab: TabKey;
  onTab: (next: TabKey) => void;
}) {
  const { attendance, assessment, observations, surveys, children } = report;

  return (
    <div className="flex flex-col gap-4">
      {/*
        ★ Five figures, the client's own five. Each is a fact a teacher is asked
        for by name, and each names its denominator — "24 / 28" says what is
        left to do in a way "86%" does not.
      */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Нийт хүүхэд"
          value={String(children)}
          tone="sky"
          footer={report.group.name}
        />
        <StatCard
          label="Ирцийн хувь"
          value={attendance.percent === null ? "—" : `${attendance.percent}%`}
          tone="mint"
          footer={attendance.recorded === 0 ? "Бүртгэл алга" : `${attendance.recorded} бүртгэл`}
        />
        <StatCard
          label="Үнэлгээ хийсэн"
          value={`${assessment.assessed} / ${children}`}
          tone="sun"
          footer={
            children - assessment.assessed > 0
              ? `${children - assessment.assessed} хүүхдийн үнэлгээ дутуу`
              : "Бүгд хийгдсэн"
          }
        />
        <StatCard
          label="Судалгаанд оролцсон"
          value={`${surveys.responded} / ${children}`}
          tone="cornflower"
          footer={surveys.percent === null ? "—" : `${surveys.percent}%`}
        />
        <StatCard
          label="Ажиглалт нэмсэн"
          value={String(observations.total)}
          tone="peach"
          footer={`${observations.children} хүүхдэд`}
        />
      </div>

      <div role="tablist" aria-label="Тайлангийн хэсэг" className="flex flex-wrap gap-1.5">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => onTab(entry.key)}
            className={cn(
              "min-h-[44px] rounded-pill px-3.5 text-body font-medium transition-colors",
              tab === entry.key
                ? "bg-primary text-primary-ink"
                : "bg-surface text-muted hover:bg-canvas hover:text-ink",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={TABS.find((entry) => entry.key === tab)!.label}>
        {tab === "summary" || tab === "attendance" ? <AttendancePanel report={report} /> : null}
        {tab === "summary" || tab === "assessment" ? <AssessmentPanel report={report} /> : null}
        {tab === "summary" || tab === "observations" ? <ObservationPanel report={report} /> : null}
        {tab === "summary" || tab === "surveys" ? <SurveyPanel report={report} /> : null}
      </div>
    </div>
  );
}

function AttendancePanel({ report }: { report: z.infer<typeof groupReportSchema> }) {
  const { attendance } = report;
  const total = attendance.byStatus.reduce((sum, row) => sum + row.count, 0);

  return (
    <section className="mt-1 flex flex-col gap-3">
      <SectionHeader title="Ирц" as="h2" />

      {total === 0 ? (
        <EmptyState title="Энэ хугацаанд ирц бүртгээгүй байна" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card pad="roomy" className="flex flex-col gap-3">
            <p className="text-body font-medium text-ink">Ирцийн хандлага</p>
            {/*
              A column per recorded day. Days with no register draw an empty
              track rather than a flat bar — "nobody came" and "nobody marked
              it" must not look the same.
            */}
            <ColumnChart
              columns={attendance.byDay.map((day) => ({
                label: formatDayMonth(day.date),
                value: day.percent,
                accessibleLabel: formatDayMonth(day.date),
              }))}
              tilted
            />
          </Card>

          <Card pad="roomy" className="flex flex-col gap-3">
            <p className="text-body font-medium text-ink">Ирцийн тоон үзүүлэлт</p>
            <div className="flex flex-wrap items-center gap-4">
              <Donut
                size={120}
                label="Ирцийн бүртгэлийн хуваарилалт"
                centre={
                  <span className="text-center">
                    <span className="block text-lead font-semibold tabular-nums text-ink">
                      {total}
                    </span>
                    <span className="block text-caption text-muted">хүүхэд-өдөр</span>
                  </span>
                }
                segments={attendance.byStatus
                  .filter((row) => row.count > 0)
                  .map((row) => ({
                    label: ATTENDANCE_STATUS_LABEL[row.status] ?? row.status,
                    value: row.count,
                    tone: ATTENDANCE_STATUS_CHART_TONE[row.status],
                  }))}
              />

              <ul className="flex min-w-0 flex-1 flex-col gap-1">
                {attendance.byStatus.map((row) => (
                  <li key={row.status}>
                    <BarRow
                      label={ATTENDANCE_STATUS_LABEL[row.status] ?? row.status}
                      percent={total === 0 ? 0 : Math.round((row.count / total) * 100)}
                      value={`${row.count} (${total === 0 ? 0 : Math.round((row.count / total) * 100)}%)`}
                      tone={ATTENDANCE_STATUS_CHART_TONE[row.status]}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}

function AssessmentPanel({ report }: { report: z.infer<typeof groupReportSchema> }) {
  const { assessment, children } = report;
  const most = Math.max(1, ...assessment.byDomain.map((row) => row.count));

  return (
    <section className="mt-3 flex flex-col gap-3">
      <SectionHeader title="Явцын үнэлгээ" as="h2" />
      <Card pad="roomy" className="flex flex-col gap-3">
        <p className="text-body text-muted">
          {assessment.assessed} / {children} хүүхдэд үнэлгээ хийгдсэн
          {report.terms.length > 0
            ? ` · ${report.terms.map((term) => `${term.number}. ${term.name}`).join(", ")}`
            : ""}
        </p>

        {assessment.byDomain.every((row) => row.count === 0) ? (
          <EmptyState title="Энэ хугацаанд үнэлгээ хийгдээгүй байна" />
        ) : (
          <ColumnChart
            columns={assessment.byDomain.map((row) => ({
              label: row.name,
              value: Math.round((row.count / most) * 100),
              accessibleLabel: `${row.name}: ${row.count}`,
            }))}
            axisLabel={() => ""}
            tilted
          />
        )}
      </Card>
    </section>
  );
}

function ObservationPanel({ report }: { report: z.infer<typeof groupReportSchema> }) {
  const { observations } = report;
  const most = Math.max(1, ...observations.byType.map((row) => row.count));

  return (
    <section className="mt-3 flex flex-col gap-3">
      <SectionHeader title="Ажиглалт, ярилцлага, бүтээл" as="h2" />
      <Card pad="roomy" className="flex flex-col gap-2">
        <p className="text-body text-muted">
          Нийт {observations.total} тэмдэглэл · {observations.children} хүүхдэд
        </p>
        <ul className="flex flex-col gap-1">
          {observations.byType.map((row) => (
            <li key={row.id}>
              <BarRow
                label={row.name}
                percent={Math.round((row.count / most) * 100)}
                value={`${row.count}`}
                tone="sky"
              />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function SurveyPanel({ report }: { report: z.infer<typeof groupReportSchema> }) {
  const { surveys, children } = report;
  const kindLabel: Record<string, string> = { FORM: "Судалгаа", POLL: "Асуулга" };

  return (
    <section className="mt-3 flex flex-col gap-3">
      <SectionHeader title="Судалгаа, асуулга" as="h2" />
      <Card pad="roomy" className="flex flex-col gap-3">
        <p className="text-body text-muted">
          Нийт {surveys.total} удаа авсан · {surveys.responded} / {children} гэр бүл оролцсон
        </p>

        <BarRow
          label="Оролцоо"
          percent={surveys.percent ?? 0}
          value={surveys.percent === null ? "—" : `${surveys.percent}%`}
          tone="mint"
        />

        <ul className="flex flex-col gap-1 border-t border-border-soft pt-2">
          {surveys.byKind.map((row) => (
            <li
              key={row.kind}
              className="flex items-baseline justify-between gap-2 text-body text-ink"
            >
              <span>{kindLabel[row.kind] ?? row.kind}</span>
              <span className="tabular-nums font-semibold">{row.count}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
