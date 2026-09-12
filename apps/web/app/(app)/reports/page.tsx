"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, type ReactNode } from "react";
import { UsersRound } from "lucide-react";
import { z } from "zod";
import { groupReportSchema, termSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { RequireRole } from "@/components/shell/require-role";
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { GroupSwitcher, useSwitchableGroups } from "@/components/shell/group-switcher";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { BarRow } from "@/components/ui/chart/bar-row";
import { ColumnChart } from "@/components/ui/chart/columns";
import { Donut } from "@/components/ui/chart/donut";
import { Art, type ArtName } from "@/components/ui/art";
import { ATTENDANCE_STATUS_CHART_TONE, ATTENDANCE_STATUS_LABEL } from "@/lib/attendance-meta";
import { formatDayMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AdminReportsOverview } from "@/components/admin/admin-reports-overview";

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
        <ReportsForRole />
      </Suspense>
    </RequireRole>
  );
}

function ReportsForRole() {
  const { hasRole } = useSession();
  return hasRole("ADMIN") ? <AdminReportsOverview /> : <Reports />;
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

  const selectedGroupName =
    group?.name ?? items.find((item) => item.id === groupId)?.name ?? "Бүлгийн тайлан";
  const header = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 lg:mb-5">
      <h1 className="min-w-0 flex-1 text-display font-semibold leading-heading tracking-[-0.02em] text-ink">
        Судалгааны мэдээлэл
      </h1>
      <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-pill bg-sky px-3 text-caption font-semibold text-sky-ink sm:px-4 sm:text-body">
        <UsersRound aria-hidden="true" className="size-5" />
        {selectedGroupName}
      </span>
    </div>
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
      <div className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-3 shadow-sm">
        <div
          role="radiogroup"
          aria-label="Хугацаа"
          className="grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-control bg-canvas p-1 sm:max-w-md"
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
          <p className="pb-1 text-caption text-muted">
            {formatDayMonth(range.from)} – {formatDayMonth(range.to)}
          </p>
        ) : null}
      </div>

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

  const noteCounts = useMemo(() => {
    const countMatching = (words: string[]) =>
      observations.byType
        .filter((row) => {
          const searchable = `${row.code ?? ""} ${row.name}`.toLocaleLowerCase("mn");
          return words.some((word) => searchable.includes(word));
        })
        .reduce((sum, row) => sum + row.count, 0);

    const conversations = countMatching(["conversation", "interview", "ярилц"]);
    const artwork = countMatching(["artwork", "creation", "бүтээл"]);

    return {
      conversations,
      artwork,
    };
  }, [observations]);

  const missingAssessments = Math.max(0, children - assessment.assessed);

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Бүлгийн тайлангийн нэгтгэл" className="flex flex-col gap-3">
        <Card className="relative min-h-52 overflow-hidden border-sky bg-gradient-to-br from-white via-sky/25 to-sky/60 p-5 sm:min-h-64 sm:p-8">
          <div className="relative z-10 max-w-[55%]">
            <h2 className="text-lead font-semibold text-ink">Нийт хүүхэд</h2>
            <p className="mt-2 text-hero font-bold leading-none tracking-tight text-primary tabular-nums sm:text-hero-lg">
              {children}
            </p>
            <p className="mt-3 text-body font-medium text-ink sm:text-lead">{report.group.name}</p>
          </div>
          <div aria-hidden="true" className="absolute inset-y-0 right-0 w-[55%] overflow-hidden">
            <Art
              name="reportChildrenStar"
              size={360}
              className="absolute -bottom-8 right-0 h-auto w-full max-w-[360px] object-contain object-bottom sm:-bottom-12"
            />
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <ReportMetricCard
            label="Ирцийн хувь"
            value={attendance.percent === null ? "—" : `${attendance.percent}%`}
            footer={attendance.recorded === 0 ? "Бүртгэл алга" : `${attendance.recorded} бүртгэл`}
            tone="sky"
            art="attendance"
          >
            <Donut
              size={76}
              label={`Ирц ${attendance.percent ?? 0}%`}
              segments={[
                { label: "Ирсэн", value: attendance.percent ?? 0, tone: "sky" },
                {
                  label: "Үлдсэн",
                  value: 100 - (attendance.percent ?? 0),
                  color: "var(--color-track)",
                },
              ]}
              centre={
                <span className="text-body font-bold text-ink">{attendance.percent ?? 0}</span>
              }
              className="hidden sm:grid"
            />
          </ReportMetricCard>

          <ReportMetricCard
            label="Үнэлгээ хийсэн"
            value={`${assessment.assessed} / ${children}`}
            footer={
              missingAssessments > 0
                ? `${missingAssessments} хүүхдийн үнэлгээ дутуу`
                : "Бүгд хийсэн"
            }
            tone="mint"
            art="progress"
          />

          <ReportMetricCard
            label="Судалгаанд оролцсон"
            value={`${surveys.responded} / ${children}`}
            footer={surveys.percent === null ? "—" : `${surveys.percent}%`}
            tone="cornflower"
            art="survey"
          >
            <div
              aria-hidden="true"
              className="hidden h-2 w-full overflow-hidden rounded-pill bg-track sm:block"
            >
              <span
                className="block h-full rounded-pill bg-cornflower-ink"
                style={{ width: `${surveys.percent ?? 0}%` }}
              />
            </div>
          </ReportMetricCard>

          <ReportMetricCard
            label="Ажиглалт нэмсэн"
            value={String(observations.total)}
            footer={`${observations.children} хүүхдэд`}
            tone="sun"
            art="observation"
          />

          <ReportMetricCard
            label="Ярилцлага"
            value={String(noteCounts.conversations)}
            footer="ярилцлага"
            tone="pink"
            art="conversation"
          />

          <ReportMetricCard
            label="Бүтээлд дүн шинжилгээ"
            value={String(noteCounts.artwork)}
            footer="шинжилгээ"
            tone="sky"
            art="reportArtworkAnalysis"
          />
        </div>
      </section>

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

function ReportMetricCard({
  label,
  value,
  footer,
  tone,
  art,
  children,
}: {
  label: string;
  value: string;
  footer: string;
  tone: "sky" | "mint" | "sun" | "cornflower" | "pink";
  art: ArtName;
  children?: ReactNode;
}) {
  const backgrounds = {
    sky: "border-sky bg-gradient-to-br from-white to-sky/60",
    mint: "border-mint bg-gradient-to-br from-white to-mint/60",
    sun: "border-sun bg-gradient-to-br from-white to-sun/60",
    cornflower: "border-cornflower bg-gradient-to-br from-white to-cornflower/60",
    pink: "border-pink bg-gradient-to-br from-white to-pink/60",
  } as const;

  return (
    <Card
      className={cn("relative min-h-40 overflow-hidden p-4 sm:min-h-52 sm:p-6", backgrounds[tone])}
    >
      <div className="relative z-10 flex h-full flex-col">
        <h3 className="max-w-[78%] text-body font-semibold leading-snug text-ink sm:text-lead">
          {label}
        </h3>
        <p className="mt-3 text-figure font-bold leading-none tracking-tight text-primary tabular-nums sm:text-figure-lg">
          {value}
        </p>
        <div className="mt-auto pt-3">
          {children}
          <p className="mt-2 text-caption font-medium text-ink sm:text-body">{footer}</p>
        </div>
      </div>
      <Art
        name={art}
        size={128}
        className="pointer-events-none absolute -bottom-3 -right-4 h-auto w-[48%] max-w-36 object-contain sm:bottom-2 sm:right-3"
      />
    </Card>
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
