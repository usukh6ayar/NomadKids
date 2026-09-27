"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendingDown, TrendingUp } from "lucide-react";
import {
  surveyComparisonSchema,
  SURVEY_PERIOD_LABEL,
  type IndicatorComparison,
  type SurveyComparison as SurveyComparisonData,
} from "@kinder/contracts";
import { shortName } from "@/lib/format";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

/**
 * Begin-to-end progress — RFP Module 1.2.
 *
 * ★ The bars are drawn against the scale's maximum, matching how the
 * percentage is computed on the server. A bar scaled to the largest value in
 * the set would make a class that moved from 3.0 to 3.1 look transformed.
 *
 * ★★ An indicator nobody answered shows "—", never 0. A missing score and a
 * score of zero are different facts, and only one of them means the children
 * did badly.
 */
export function SurveyComparison({ surveyId }: { surveyId: string }) {
  const comparison = useQuery({
    queryKey: qk.surveyComparison(surveyId),
    queryFn: () => get(`/surveys/${surveyId}/comparison`, surveyComparisonSchema),
  });

  if (comparison.isPending) return <LoadingState rows={4} />;
  if (comparison.isError) return <ErrorState description={errorMessage(comparison.error)} />;

  const data = comparison.data;

  if (!data.baseline) {
    return (
      <EmptyState
        title="Харьцуулах өмнөх судалгаа алга"
        description='Дахин авахдаа дээрх "Хувилах" товчийг дарж, шинэ үнэлгээний үеийг сонгоно уу. Хувилсан судалгааг бөглөсний дараа тэнд энэ судалгаатай харьцуулсан ахиц харагдана.'
      />
    );
  }

  const scored = data.indicators.filter((row) => row.deltaPercent !== null);
  const best = scored[0];
  const worst = scored.length > 1 ? scored[scored.length - 1] : undefined;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="comparison-heading">
      <SectionHeader
        id="comparison-heading"
        title="Ахиц дэвшил"
        lede={`${data.baseline.title}${
          data.baseline.period ? ` · ${SURVEY_PERIOD_LABEL[data.baseline.period]}` : ""
        } — энэ судалгаатай харьцуулав`}
      />

      {/*
        The two facts Module 1.2 names — biggest gain and greatest need — are
        the ends of the server's already-sorted list, lifted out so a teacher
        reads them without scanning twenty rows.
      */}
      {best && worst ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Highlight
            tone="mint"
            icon={<TrendingUp size={18} aria-hidden="true" />}
            title="Хамгийн их ахисан"
            row={best}
          />
          <Highlight
            tone="sun"
            icon={<TrendingDown size={18} aria-hidden="true" />}
            title="Нэмэлт дэмжлэг шаардлагатай"
            row={worst}
          />
        </div>
      ) : null}

      {data.indicators.length === 0 ? (
        <EmptyState
          title="Оноогоор харьцуулах асуулт алга"
          description="Үнэлгээ (1–5), Тийм/Үгүй, тоон сонголт (жишээ нь 0 / 1), олон сонголт болон матриц асуулт харьцуулагдана."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.indicators.map((row) => (
            <li key={`${row.indicatorKey}-${row.rowKey ?? ""}`}>
              <IndicatorRow row={row} />
            </li>
          ))}
        </ul>
      )}

      <ChildProgress rows={data.children} />
    </section>
  );
}

type ChildRow = SurveyComparisonData["children"][number];

/**
 * Хүүхэд бүрийн ахиц — client, 2026-09-21.
 *
 * ★ One figure per child: the mean of their indicators as a share of each
 * indicator's maximum, before and after, over the indicators they have in
 * both waves. A row of every indicator per child would be the teacher's
 * sheet again; this answers "who moved, and who did not".
 */
function childTotals(row: ChildRow) {
  const both = row.indicators.filter(
    (indicator) =>
      indicator.baselineMean !== null &&
      indicator.baselineMean !== undefined &&
      indicator.endlineMean !== null &&
      indicator.endlineMean !== undefined &&
      (indicator.maxScore ?? 0) > 0,
  );
  if (both.length === 0) return null;
  const share = (pick: (i: IndicatorComparison) => number) =>
    (both.reduce((sum, i) => sum + pick(i) / i.maxScore!, 0) / both.length) * 100;
  const before = share((i) => i.baselineMean!);
  const after = share((i) => i.endlineMean!);
  return { before, after, delta: Math.round(after - before) };
}

function ChildProgress({ rows }: { rows: ChildRow[] }) {
  const measured = rows
    .map((row) => ({ row, totals: childTotals(row) }))
    .filter(
      (entry): entry is { row: ChildRow; totals: NonNullable<ReturnType<typeof childTotals>> } =>
        Boolean(entry.totals && entry.row.child),
    )
    .sort((a, b) => b.totals.delta - a.totals.delta);

  if (measured.length === 0) return null;

  return (
    <Card pad="compact" className="flex flex-col gap-2" aria-labelledby="child-progress-heading">
      <h3 id="child-progress-heading" className="font-semibold text-ink">
        Хүүхэд бүрийн ахиц
      </h3>
      <ul className="flex flex-col divide-y divide-border-soft">
        {measured.map(({ row, totals }) => (
          <li key={row.childId} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1 truncate text-body text-ink">
              {shortName(row.child)}
            </span>
            <span className="text-caption tabular-nums text-muted">
              {Math.round(totals.before)}% → {Math.round(totals.after)}%
            </span>
            <span
              className={`w-14 text-right text-body font-semibold tabular-nums ${
                totals.delta > 0 ? "text-mint-ink" : totals.delta < 0 ? "text-danger" : "text-muted"
              }`}
            >
              {signed(totals.delta)}%
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Highlight({
  tone,
  icon,
  title,
  row,
}: {
  tone: "mint" | "sun";
  icon: React.ReactNode;
  title: string;
  row: IndicatorComparison;
}) {
  return (
    <Card pad="roomy" className="flex flex-col gap-1.5">
      <div
        className={`flex items-center gap-2 text-caption font-medium ${
          tone === "mint" ? "text-mint-ink" : "text-sun-ink"
        }`}
      >
        {icon}
        {title}
      </div>
      <p className="text-body font-medium text-ink">{row.label}</p>
      <p className="text-caption text-muted">
        {formatScore(row.baselineMean)} → {formatScore(row.endlineMean)} ({signed(row.deltaPercent)}
        %)
      </p>
    </Card>
  );
}

function IndicatorRow({ row }: { row: IndicatorComparison }) {
  const max = row.maxScore ?? 0;
  const toPercent = (value: number | null | undefined) =>
    value !== null && value !== undefined && max > 0 ? (value / max) * 100 : 0;

  const improved = (row.delta ?? 0) > 0;

  return (
    <Card pad="compact" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-body font-medium text-ink">{row.label}</span>
        <span
          className={`text-body font-medium ${
            row.deltaPercent === null || row.deltaPercent === undefined
              ? "text-muted"
              : improved
                ? "text-mint-ink"
                : row.deltaPercent < 0
                  ? "text-danger"
                  : "text-muted"
          }`}
        >
          {signed(row.deltaPercent)}%
        </span>
      </div>

      {/*
        Two bars rather than one: "before" and "after" side by side is what
        makes the movement legible. A single bar showing only the delta hides
        where the children started, which is the context a teacher reads this
        for.
      */}
      <div className="flex flex-col gap-1">
        <Bar label="Эхний" value={row.baselineMean} percent={toPercent(row.baselineMean)} muted />
        <Bar label="Эцсийн" value={row.endlineMean} percent={toPercent(row.endlineMean)} />
      </div>

      <p className="text-caption text-muted">
        {row.baselineCount} → {row.endlineCount} хариулт
      </p>
    </Card>
  );
}

function Bar({
  label,
  value,
  percent,
  muted = false,
}: {
  label: string;
  value: number | null | undefined;
  percent: number;
  muted?: boolean;
}) {
  const measured = value !== null && value !== undefined;

  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-caption text-muted">{label}</span>
      <div
        className="h-2 flex-1 overflow-hidden rounded-pill bg-canvas"
        role="progressbar"
        aria-label={`${label} дундаж`}
        aria-valuenow={measured ? Math.round(percent) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-pill ${muted ? "bg-line" : "bg-primary"}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-caption text-ink">{formatScore(value)}</span>
    </div>
  );
}

/** One decimal is as much precision as a mean of a 1–5 scale can carry. */
function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(1);
}

function signed(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value > 0 ? `+${value}` : String(value);
}
