"use client";

import { useQuery } from "@tanstack/react-query";
import { Eye, MessageCircle, Palette } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { groupObservationStatsSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { TONE_VAR, type Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";

const ACADEMIC_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5] as const;
const OBSERVATION_TYPES = ["Ажиглалт", "Ярилцлага", "Бүтээл"] as const;
const DEVELOPMENT_DOMAINS = [
  "Нийгэм-сэтгэл хөдлөл",
  "Хөдөлгөөн, эрүүл мэнд",
  "Хэл яриа",
  "Байгаль, нийгмийн орчин",
  "Математик",
  "Зураг, урлал",
  "Хөгжим",
] as const;
const DAILY_ACTIVITIES = [
  "Өглөөний хүлээн авалт",
  "Тоглоомын цаг",
  "Өглөөний дасгал",
  "Өглөөний цай",
  "Сургалт, үйл ажиллагаа",
  "Ариун цэвэр, дадал хэвшил",
  "Зугаалгын цаг",
  "Өдрийн хоол",
  "Өдрийн унтлага",
  "Үдийн цай",
  "Ганцаарчилсан сургалт",
  "Хөгжөөн баясгах үйл ажиллагаа",
  "Таралт",
] as const;

const DOMAIN_ALIASES: Record<string, readonly string[]> = {
  "Нийгэм-сэтгэл хөдлөл": ["Нийгэмшихүй, сэтгэл хөдлөл"],
  "Хөдөлгөөн, эрүүл мэнд": ["Бие бялдрын хөгжил", "Бие бялдар, хөдөлгөөн"],
  "Хэл яриа": ["Хэл яриа, харилцаа"],
  Математик: ["Танин мэдэхүй"],
  "Зураг, урлал": ["Урлаг, гоо зүйн хүмүүжил", "Бүтээлч сэтгэлгээ"],
};

interface CountRow {
  id: string;
  name: string;
  count: number;
}

interface MonthPoint {
  key: string;
  label: string;
  count: number;
  childrenCount: number;
}

/** September through May for the school year containing `from`. */
function academicMonthList(from: string): MonthPoint[] {
  const parsedYear = Number(from.slice(0, 4));
  const today = new Date();
  const fallbackYear = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
  const startYear = Number.isFinite(parsedYear) ? parsedYear : fallbackYear;

  return ACADEMIC_MONTHS.map((month) => {
    const year = month >= 9 ? startYear : startYear + 1;
    return {
      key: `${year}-${String(month).padStart(2, "0")}`,
      label: `${month}-р сар`,
      count: 0,
      childrenCount: 0,
    };
  });
}

function defaultWindow(): { from: string; to: string } {
  const today = new Date();
  const year = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
  return { from: `${year}-09-01`, to: `${year + 1}-05-31` };
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("mn-MN");
}

/** Keep the source screen's fixed order while accepting legacy catalogue names. */
function fixedRows(
  reference: readonly string[],
  rows: CountRow[],
  aliases: Record<string, readonly string[]> = {},
): CountRow[] {
  return reference.map((name, index) => {
    const accepted = new Set([name, ...(aliases[name] ?? [])].map(normalized));
    const matches = rows.filter((row) => accepted.has(normalized(row.name)));
    return {
      id: matches.map((row) => row.id).join("-") || `reference-${index}-${name}`,
      name,
      count: matches.reduce((sum, row) => sum + row.count, 0),
    };
  });
}

/**
 * The assessment page's observation coverage overview.
 *
 * Counts come from one group-scoped aggregate endpoint. The browser never
 * downloads every child's notes to calculate these panels.
 */
export function GroupCoverage({
  groupId,
  startsOn,
  endsOn,
}: {
  groupId: string;
  startsOn?: string | null;
  endsOn?: string | null;
}) {
  const fallback = defaultWindow();
  const from = startsOn ? `${startsOn.slice(0, 4)}-09-01` : fallback.from;
  const to = endsOn ? `${endsOn.slice(0, 4)}-05-31` : fallback.to;
  const stats = useQuery({
    queryKey: qk.groupObservationStats(groupId, from, to),
    queryFn: () =>
      get(
        `/groups/${groupId}/observation-stats?from=${from}&to=${to}`,
        groupObservationStatsSchema,
      ),
  });

  const monthTemplate = academicMonthList(from);
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const initialMonth = monthTemplate.some((month) => month.key === currentMonth)
    ? currentMonth
    : monthTemplate[0]!.key;
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [target, setTarget] = useState(2);
  const targetKey = `assessment-monthly-target:${groupId}:${from}`;

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(targetKey));
    if (Number.isInteger(stored) && stored >= 1 && stored <= 20) setTarget(stored);
  }, [targetKey]);

  if (stats.isPending) return <LoadingState rows={4} />;
  if (stats.isError) return <ErrorState description={errorMessage(stats.error)} />;

  const data = stats.data;
  const monthStats = new Map(data.byMonth.map((month) => [month.month, month]));
  const months = monthTemplate.map((month) => ({
    ...month,
    count: monthStats.get(month.key)?.count ?? 0,
    childrenCount: monthStats.get(month.key)?.childrenCount ?? 0,
  }));
  const selected = months.find((month) => month.key === selectedMonth) ?? months[0]!;
  const completed = selected.childrenCount;
  const percent = Math.min(100, Math.round((completed / target) * 100));
  const targetMet = completed >= target;
  const selectedMonthLocative = selected.label.replace(" сар", " сард");
  const selectedMonthGenitive = selected.label.replace(" сар", " сарын");
  const shouldRemind =
    selected.key === currentMonth && new Date().getDate() >= 21 && !targetMet && data.enrolled > 0;
  const teacherTypes = data.byType.filter((row) => !normalized(row.name).includes("гэр бүлээс"));
  const typeRows = OBSERVATION_TYPES.map((name, index) => ({
    id: `type-${index}-${name}`,
    name,
    count: teacherTypes
      .filter((row) => {
        const value = normalized(row.name);
        if (name === "Ярилцлага") return value.includes("ярилц");
        if (name === "Бүтээл") return value.includes("бүтээл");
        return !value.includes("ярилц") && !value.includes("бүтээл");
      })
      .reduce((sum, row) => sum + row.count, 0),
  }));
  const domainRows = fixedRows(DEVELOPMENT_DOMAINS, data.byDomain, DOMAIN_ALIASES);
  const activityRows = fixedRows(
    DAILY_ACTIVITIES,
    data.byActivity.map((row, index) => ({ id: `activity-${index}-${row.name}`, ...row })),
  );

  function updateTarget(value: number) {
    const next = Math.min(20, Math.max(1, Number.isFinite(value) ? value : 1));
    setTarget(next);
    window.localStorage.setItem(targetKey, String(next));
  }

  return (
    <section aria-label="Үнэлгээний сарын тойм" className="flex flex-col gap-4">
      {shouldRemind ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-row border border-sun bg-sun/40 px-4 py-3 text-body text-ink"
        >
          <span aria-hidden="true" className="mt-0.5 size-2.5 shrink-0 rounded-pill bg-sun-ink" />
          <p>
            {selectedMonthLocative} зорилтоо биелүүлэхэд {Math.max(target - completed, 0)} хүүхдэд
            тэмдэглэл хөтлөх үлдлээ.
          </p>
        </div>
      ) : null}

      <Card
        tone="mint"
        pad="compact"
        className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-center"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-caption font-bold uppercase text-mint-ink">Зорилт</span>
            <label>
              <span className="sr-only">Тайлант сар сонгох</span>
              <select
                value={selected.key}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="h-9 rounded-control border border-mint bg-surface px-3 text-body font-semibold text-mint-ink"
              >
                {months.map((month) => (
                  <option key={month.key} value={month.key}>
                    {month.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h2 className="mt-2 text-lead font-semibold text-ink">
            Хүүхэд бүрийн үнэлгээний хамралт
          </h2>
          <label className="mt-4 flex flex-wrap items-center gap-2 text-body font-semibold text-ink">
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              inputMode="numeric"
              value={target}
              onChange={(event) => updateTarget(event.currentTarget.valueAsNumber)}
              className="h-11 w-16 rounded-control border border-mint bg-surface px-2 text-center font-semibold tabular-nums text-ink"
            />
            <span>хүүхдэд тэмдэглэл хөтлөх</span>
          </label>
          <p className="mt-3 text-caption font-medium text-mint-ink">
            Зорилт: {selectedMonthLocative} {target} өөр хүүхдэд тэмдэглэл хөтлөх.
          </p>
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-4">
            <strong className="text-display font-semibold tabular-nums text-ink">
              {completed} / {target}
            </strong>
            <span className="text-lead font-bold tabular-nums text-mint-ink">{percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label={`${selected.label}: ${target} хүүхдийн зорилтоос ${completed} хүүхэд`}
            aria-valuemin={0}
            aria-valuemax={target}
            aria-valuenow={Math.min(completed, target)}
            className="mt-2 h-2.5 overflow-hidden rounded-pill bg-surface"
          >
            <div
              className="h-full rounded-pill bg-mint-ink transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-3 flex items-start gap-2 text-caption text-muted">
            <span
              aria-hidden="true"
              className={cn(
                "mt-1 size-2.5 shrink-0 rounded-pill",
                targetMet ? "bg-mint-ink" : "bg-sun-ink",
              )}
            />
            {targetMet
              ? `${selectedMonthGenitive} зорилт биелсэн байна.`
              : `${selectedMonthLocative} одоогоор ${completed}/${target} хүүхэд — ${percent}% биелэлттэй байна.`}
          </p>
        </div>
      </Card>

      <div className="grid items-stretch gap-4 xl:grid-cols-3">
        <CoveragePanel
          title="Ажиглалтын төрлийн бүрдэлт"
          rows={typeRows}
          tone="mint"
          iconFor={observationTypeIcon}
          footer="3 төрлийн тэмдэглэлийг тэнцвэртэй хөтөлж буй эсэх."
        />
        <CoveragePanel
          title="Сургалтын чиглэлийн хамралт"
          rows={domainRows}
          tone="sky"
          footer="СӨБ-ын 7 чиглэл орхигдоогүй эсэхийг харуулна."
        />
        <CoveragePanel
          title="Үйл ажиллагааны явц"
          rows={activityRows}
          tone="sun"
          dashWhenZero
          footer={
            data.byActivity.length > 0
              ? "Үйл ажиллагааны үе шат бүрийн тэмдэглэлийн хамралтыг харуулна."
              : "Үйл ажиллагааны үе шат одоогийн тэмдэглэлд сонгогдоогүй байна."
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <MonthlyCoverage months={months} />
      </div>
    </section>
  );
}

function observationTypeIcon(name: string): ReactNode {
  const value = normalized(name);
  if (value.includes("ярилц")) return <MessageCircle size={14} aria-hidden="true" />;
  if (value.includes("бүтээл")) return <Palette size={14} aria-hidden="true" />;
  return <Eye size={14} aria-hidden="true" />;
}

function CoveragePanel({
  title,
  rows,
  footer,
  tone,
  iconFor,
  dashWhenZero = false,
}: {
  title: string;
  rows: CountRow[];
  footer: string;
  tone: Tone;
  iconFor?: (name: string) => ReactNode;
  dashWhenZero?: boolean;
}) {
  const peak = Math.max(...rows.map((row) => row.count), 1);

  return (
    <Card pad="compact" className="flex h-full flex-col">
      <h3 className="text-body font-semibold text-ink">{title}</h3>
      <div className="mt-4 flex flex-col gap-2.5">
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[minmax(120px,1fr)_minmax(64px,1.15fr)_24px] items-center gap-2"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-caption leading-snug text-ink">
              {iconFor ? <span className="shrink-0 text-muted">{iconFor(row.name)}</span> : null}
              <span>{row.name}</span>
            </span>
            <span
              role="img"
              aria-label={`${row.name}: ${row.count} тэмдэглэл`}
              className="h-2 overflow-hidden rounded-pill bg-track"
            >
              <span
                className="block h-full rounded-pill"
                style={{ width: `${(row.count / peak) * 100}%`, background: TONE_VAR[tone] }}
              />
            </span>
            <strong className="text-right text-caption tabular-nums text-ink">
              {dashWhenZero && row.count === 0 ? "—" : row.count}
            </strong>
          </div>
        ))}
      </div>
      <p className="mt-auto pt-4 text-caption text-muted">{footer}</p>
    </Card>
  );
}

function MonthlyCoverage({ months }: { months: MonthPoint[] }) {
  const peak = Math.max(...months.map((month) => month.childrenCount), 1);

  return (
    <Card pad="compact">
      <h3 className="text-body font-semibold text-ink">Сарын тэмдэглэлийн хамралт</h3>
      <ul className="mt-4 grid h-[82px] grid-cols-9 items-end gap-1 border-b border-border-soft">
        {months.map((month) => {
          const height = month.childrenCount === 0 ? 2 : (month.childrenCount / peak) * 42;
          return (
            <li
              key={month.key}
              aria-label={`${month.label}: ${month.childrenCount} хүүхэд, ${month.count} тэмдэглэл`}
              className="flex h-full min-w-0 flex-col items-center justify-end gap-1"
            >
              <strong className="text-caption tabular-nums text-ink">{month.childrenCount}</strong>
              <span
                aria-hidden="true"
                className="w-full max-w-3 rounded-t-control bg-sky-ink/80"
                style={{ height }}
              />
              <span className="text-caption tabular-nums text-muted">
                {Number(month.key.slice(5))}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-caption text-muted">
        Сар бүр хичнээн хүүхдэд тэмдэглэл хөтөлснийг харуулна (9-5 сар).
      </p>
    </Card>
  );
}
