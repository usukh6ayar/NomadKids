"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  Clock,
  Eye,
  ListChecks,
  MessageCircle,
  Palette,
  Target,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { assessmentConfigSchema, groupObservationStatsSchema } from "@kinder/contracts";
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
 * Everything the coverage screens count, derived once.
 *
 * ★ A hook rather than a component, because the same numbers are now read by
 * five screens — the summary and its four breakdowns (2026-09-10, at the
 * client's request that each breakdown be a page of its own).
 *
 * They share one query key, so opening a breakdown is a render rather than a
 * request and a count on it cannot disagree with the one the teacher just
 * pressed. The reference lists — the client's seven strands and thirteen daily
 * activities — are applied here, so a row sitting at zero appears on every
 * screen that shows it.
 */
export function useCoverageRows({
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

  const data = stats.data;

  const monthStats = new Map((data?.byMonth ?? []).map((month) => [month.month, month]));
  const months = monthTemplate.map((month) => ({
    ...month,
    count: monthStats.get(month.key)?.count ?? 0,
    childrenCount: monthStats.get(month.key)?.childrenCount ?? 0,
  }));
  const selected = months.find((month) => month.key === selectedMonth) ?? months[0]!;

  /*
    ★ "Гэр бүлээс ирсэн" is dropped from the type breakdown.

    The panel asks whether the *teacher* is keeping the three kinds of note in
    balance. A note a parent submitted is not the teacher's work and would make
    a quiet month look covered.
  */
  const teacherTypes = (data?.byType ?? []).filter(
    (row) => !normalized(row.name).includes("гэр бүлээс"),
  );
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
  const domainRows = fixedRows(DEVELOPMENT_DOMAINS, data?.byDomain ?? [], DOMAIN_ALIASES);
  const activityRows = fixedRows(
    DAILY_ACTIVITIES,
    (data?.byActivity ?? []).map((row, index) => ({
      id: `activity-${index}-${row.name}`,
      ...row,
    })),
  );

  return {
    stats,
    data,
    months,
    selected,
    currentMonth,
    setSelectedMonth,
    typeRows,
    domainRows,
    activityRows,
    activityNamesUsed: (data?.byActivity ?? []).length,
  };
}

/**
 * The assessment summary — Зорилт, Үндсэн тойм, and the way into the four
 * breakdowns.
 *
 * ★ Rows that navigate, not three panels side by side — 2026-09-10, at the
 * client's request that each breakdown be a screen of its own.
 *
 * On a phone the three panels were most of a scroll before the register
 * underneath them, and the two a teacher was not looking at cost as much
 * height as the one they were.
 */
export function GroupCoverage({
  groupId,
  startsOn,
  endsOn,
  kindergartenId,
  termId,
}: {
  groupId: string;
  startsOn?: string | null;
  endsOn?: string | null;
  kindergartenId: string;
  /** The term the register behind this summary has open, carried into the links. */
  termId?: string;
}) {
  const rows = useCoverageRows({ groupId, startsOn, endsOn });
  const { stats, data, months, selected, currentMonth, setSelectedMonth } = rows;

  /*
    ★ The goal comes from the kindergarten, not from this browser.

    It was `localStorage`, so the two teachers of one group could hold
    different targets, a director saw neither, and clearing site data lost it.
    A shared commitment stored per browser is not a shared commitment — it now
    rides with the domains and levels on `assessment-config`.
  */
  const config = useQuery({
    queryKey: qk.assessmentConfig(kindergartenId),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/assessment-config`, assessmentConfigSchema),
    enabled: Boolean(kindergartenId),
    staleTime: 5 * 60_000,
  });

  if (stats.isPending) return <LoadingState rows={4} />;
  if (stats.isError) return <ErrorState description={errorMessage(stats.error)} />;

  const target = config.data?.monthlyNoteGoal ?? null;
  const completed = selected.childrenCount;
  const percent = target ? Math.min(100, Math.round((completed / target) * 100)) : 0;
  const targetMet = target !== null && completed >= target;
  const selectedMonthLocative = selected.label.replace(" сар", " сард");
  const selectedMonthGenitive = selected.label.replace(" сар", " сарын");
  const shouldRemind =
    target !== null &&
    selected.key === currentMonth &&
    new Date().getDate() >= 21 &&
    !targetMet &&
    (data?.enrolled ?? 0) > 0;

  const enrolled = data?.enrolled ?? 0;
  const withNotes = data?.childrenWithNotes ?? 0;
  /*
    ★ The term rides along, so Буцах returns to the one the teacher had open.

    The breakdowns are taken over the school year rather than the term, so
    `termId` changes nothing about what they show — but it is what the register
    behind them is keyed on, and dropping it would land a returning teacher on
    the default term with their selection lost.
  */
  const href = (kind: string) =>
    `/groups/${groupId}/assessment/${kind}${termId ? `?termId=${termId}` : ""}`;

  const LINKS = [
    {
      kind: "types",
      Icon: ClipboardList,
      title: "Тэмдэглэлийн төрлийн бүрдэлт",
      hint: `${OBSERVATION_TYPES.length} төрлийн тэмдэглэлийн төлөв`,
    },
    {
      kind: "domains",
      Icon: BarChart3,
      title: "Сургалтын чиглэлийн хамралт",
      hint: `${DEVELOPMENT_DOMAINS.length} чиглэл`,
    },
    {
      kind: "activities",
      Icon: ListChecks,
      title: "Үйл ажиллагааны явц",
      hint: `${DAILY_ACTIVITIES.length} үйл ажиллагаа`,
    },
    {
      kind: "months",
      Icon: CalendarDays,
      title: "Сарын тэмдэглэлийн хамралт",
      hint: "9–5 сар",
    },
  ];

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

      {/*
        ★ Drawn only when the kindergarten has set a goal.

        A target nobody agreed to would be a bar failing against a number the
        product invented — and the number used to be exactly that: whatever
        each teacher had typed into their own browser.
      */}
      {target !== null ? (
        <Card tone="mint" pad="compact" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-caption font-bold uppercase text-mint-ink">
              <Target size={14} aria-hidden="true" />
              Зорилт
            </span>
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

          <div>
            <h2 className="text-lead font-semibold text-ink">Хүүхэд бүрийн үнэлгээний хамралт</h2>
            <p className="mt-0.5 text-caption text-mint-ink">
              {selectedMonthLocative} {target} өөр хүүхдэд тэмдэглэл хөтлөх.
            </p>
          </div>

          <div>
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
      ) : null}

      {/*
        ★ Үндсэн тойм — the four figures the client's design leads with.

        Every one of them comes from the same aggregate: enrolled children,
        those with at least one note, the difference, and the notes themselves.
        "Нийт үзүүлэлт" is notes and "Үнэлгээтэй" is children — labelled so the
        two cannot be read as one figure disagreeing with itself.
      */}
      <dl className="grid grid-cols-2 gap-3">
        <SummaryTile label="Нийт хүүхэд" value={enrolled} Icon={Users} />
        <SummaryTile
          label="Үнэлгээтэй"
          value={withNotes}
          hint={enrolled === 0 ? undefined : `${Math.round((withNotes / enrolled) * 100)}%`}
          tone="mint"
          Icon={CheckCheck}
        />
        <SummaryTile
          label="Үлдсэн"
          value={Math.max(0, enrolled - withNotes)}
          hint={enrolled === 0 ? undefined : `${100 - Math.round((withNotes / enrolled) * 100)}%`}
          tone="peach"
          Icon={Clock}
        />
        <SummaryTile label="Нийт үзүүлэлт" value={data?.total ?? 0} tone="sky" Icon={BarChart3} />
      </dl>

      {/*
        ★ Rows that navigate — 2026-09-10, at the client's request.

        They were three panels side by side and a chart under them, which on a
        phone is most of a scroll before the register itself, with the two
        breakdowns a teacher is not reading costing as much height as the one
        they are. The four screens share this screen's query key, so opening
        one is a render rather than a request.
      */}
      <nav aria-label="Дэлгэрэнгүй" className="flex flex-col gap-2">
        {LINKS.map((link) => (
          <Link
            key={link.kind}
            href={href(link.kind)}
            className="group flex items-center gap-3 rounded-card border border-border bg-surface px-3.5 py-3 transition-colors hover:border-primary hover:bg-canvas"
          >
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-control bg-primary-soft text-primary"
            >
              <link.Icon size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium leading-snug text-ink transition-colors group-hover:text-primary">
                {link.title}
              </span>
              <span className="block text-caption text-muted">{link.hint}</span>
            </span>
            <ChevronRight
              size={18}
              aria-hidden="true"
              className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
            />
          </Link>
        ))}
      </nav>
    </section>
  );
}

export function observationTypeIcon(name: string): ReactNode {
  const value = normalized(name);
  if (value.includes("ярилц")) return <MessageCircle size={14} aria-hidden="true" />;
  if (value.includes("бүтээл")) return <Palette size={14} aria-hidden="true" />;
  return <Eye size={14} aria-hidden="true" />;
}

export function CoveragePanel({
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

export function MonthlyCoverage({ months }: { months: MonthPoint[] }) {
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

/**
 * One figure of Үндсэн тойм.
 *
 * ★ Icon, label, number — in that order down the tile.
 *
 * The client's design puts the glyph above the words, which on a two-column
 * phone grid is what lets four tiles read as four things rather than as a
 * block of digits.
 */
function SummaryTile({
  label,
  value,
  hint,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: Tone;
  Icon: typeof Users;
}) {
  return (
    <Card
      pad="compact"
      tone={tone}
      className={cn("flex flex-col gap-1.5", tone ? undefined : "bg-sunken")}
    >
      <Icon size={18} aria-hidden="true" className="text-muted" />
      <dt className="text-caption leading-snug text-muted">{label}</dt>
      <dd className="flex items-baseline gap-1.5">
        <span className="text-title font-semibold tabular-nums leading-none text-ink">{value}</span>
        {hint ? <span className="text-caption tabular-nums text-muted">{hint}</span> : null}
      </dd>
    </Card>
  );
}
