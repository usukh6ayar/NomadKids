"use client";

import { useQuery } from "@tanstack/react-query";
import { Eye, MessageCircle, Palette, Search } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  MAX_PAGE_SIZE,
  childSummarySchema,
  groupObservationStatsSchema,
  groupSchema,
  paginated,
} from "@kinder/contracts";
import { useSession } from "@/lib/auth/session";
import { GoalDialog } from "./goal-dialog";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { TONE_VAR, type Tone } from "@/components/ui/tone";
import { formatAge, fullName, shortName } from "@/lib/format";
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
export const DAILY_ACTIVITIES = [
  "Өглөөний хүлээн авалт",
  "Өглөөний дасгал",
  "Тойргийн цаг",
  "Цай",
  "Чиглүүлэгтэй тоглоом, үйл ажиллагаа",
  "Чөлөөт тоглоом",
  "Хооллолт",
  "Зугаалгын цаг",
  "Унталтын цаг",
  "Номын цаг",
  "Төвийн цаг",
  "Хөгжөөн баясах ажил",
  "Өөртөө үйлчлэх ажил",
  "Ганцаарчилсан үйл ажиллагаа",
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

/**
 * The academic window when the group's own year has not resolved.
 *
 * ★ Exported since 2026-09-11, so the note strip's class figure is taken over
 * the same span the summary behind it uses. Two components computing "this
 * school year" independently is how one of them ends up a year out.
 */
export function defaultWindow(): { from: string; to: string } {
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
 * pressed. The reference lists — the client's seven strands and fourteen daily
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

  const annualData = stats.data;

  const monthStats = new Map((annualData?.byMonth ?? []).map((month) => [month.month, month]));
  const months = monthTemplate.map((month) => ({
    ...month,
    count: monthStats.get(month.key)?.count ?? 0,
    childrenCount: monthStats.get(month.key)?.childrenCount ?? 0,
  }));
  const selected = months.find((month) => month.key === selectedMonth) ?? months[0]!;

  /*
   * The cards below the goal describe the selected month, so their source must
   * change with that month too. The year query remains for the 9–5 trend; this
   * second query drives coverage, type, domain and activity percentages.
   */
  const [selectedYear, selectedMonthNumber] = selected.key.split("-").map(Number);
  const lastDay = new Date(selectedYear!, selectedMonthNumber!, 0).getDate();
  const selectedFrom = `${selected.key}-01`;
  const selectedTo = `${selected.key}-${String(lastDay).padStart(2, "0")}`;
  const selectedStats = useQuery({
    queryKey: qk.groupObservationStats(groupId, selectedFrom, selectedTo),
    queryFn: () =>
      get(
        `/groups/${groupId}/observation-stats?from=${selectedFrom}&to=${selectedTo}`,
        groupObservationStatsSchema,
      ),
  });
  const data = selectedStats.data;

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
    selectedStats,
    data,
    months,
    selected,
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
}: {
  groupId: string;
  startsOn?: string | null;
  endsOn?: string | null;
  /** The term the register behind this summary has open, carried into the links. */
  termId?: string;
}) {
  const { hasRole } = useSession();
  const rows = useCoverageRows({ groupId, startsOn, endsOn });
  const { stats, selectedStats, data, months, selected, setSelectedMonth } = rows;

  /*
    ★ The goal is the group's own — read off the group row, not a browser and
    not the kindergarten.

    It was `localStorage`, so the two teachers of one group could hold
    different targets, a director saw neither, and clearing site data lost it.
    It then spent a day on `Kindergarten`, which had the opposite fault: one
    teacher's decision would have moved every other group's number. On the
    group, set by whoever teaches it, it is the number the client asked for.
  */
  const group = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => get(`/groups/${groupId}`, groupSchema),
    enabled: Boolean(groupId),
  });

  if (stats.isPending || selectedStats.isPending) return <LoadingState rows={4} />;
  if (stats.isError) return <ErrorState description={errorMessage(stats.error)} />;
  if (selectedStats.isError) {
    return <ErrorState description={errorMessage(selectedStats.error)} />;
  }

  const target = group.data?.monthlyNoteGoal ?? null;
  const notesPerChildTarget = group.data?.monthlyNotesPerChildGoal ?? null;
  const completed = data?.childrenWithNotes ?? selected.childrenCount;
  const childrenMeetingNoteTarget = notesPerChildTarget
    ? (data?.byChild ?? []).filter((row) => row.count >= notesPerChildTarget).length
    : completed;
  const goalCompleted = notesPerChildTarget ? childrenMeetingNoteTarget : completed;
  const percent = target ? Math.min(100, Math.round((goalCompleted / target) * 100)) : 0;
  const enrolled = data?.enrolled ?? 0;
  /*
    ★ Any member of staff on this screen may set it, not only an administrator.

    `RequireRole` already gates the page to TEACHER and ADMIN, and the server
    checks that a teacher is actually assigned to the group — so the control is
    offered to everyone who can reach it and refused by the one place that can
    refuse it properly (§1.1).
  */
  const canSetGoal = hasRole("TEACHER") || hasRole("ADMIN");

  return (
    <section aria-label="Үнэлгээний сарын тойм" className="flex flex-col gap-4">
      <section aria-label="Энэ сарын зорилт">
        <h2 className="sr-only">Энэ сарын зорилт</h2>
        {/*
          ★ The ⋯ sits outside the scrolling strip — 2026-10-07, the client:
          on a phone the strip scrolls sideways and the edit control at its
          end was off screen.
        */}
        <Card pad="compact" className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            <div className="flex shrink-0 items-center gap-2">
              <div
                role="img"
                aria-label={`Сарын зорилгын биелэлт ${percent}%`}
                className="grid size-14 shrink-0 place-items-center rounded-pill"
                style={{
                  background: `conic-gradient(var(--color-primary) ${percent}%, var(--color-track) 0)`,
                }}
              >
                <div className="grid size-10 place-items-center rounded-pill bg-surface text-caption font-bold tabular-nums text-ink">
                  {percent}%
                </div>
              </div>
              <div className="whitespace-nowrap text-left">
                <strong className="block text-body font-bold tabular-nums text-ink">
                  {goalCompleted} / {target ?? enrolled}
                </strong>
                <span className="text-caption text-muted">хүүхэд</span>
              </div>
            </div>

            <div className="flex min-w-max flex-1 items-center gap-2">
              <label className="shrink-0">
                <span className="sr-only">Тайлант сар</span>
                <Select
                  aria-label="Тайлант сар сонгох"
                  value={selected.key}
                  onChange={(event) => setSelectedMonth(event.target.value)}
                  className="h-10 min-w-[108px] px-2 text-caption font-semibold"
                >
                  {months.map((month) => (
                    <option key={month.key} value={month.key}>
                      {month.label}
                    </option>
                  ))}
                </Select>
              </label>

              <div className="shrink-0 whitespace-nowrap rounded-control bg-sky px-3 py-2.5 text-caption text-sky-ink">
                <strong>{target ?? enrolled} хүүхэд</strong>
                <span className="mx-2 text-muted">·</span>
                тус бүр <strong>{notesPerChildTarget ?? "—"} тэмдэглэл</strong>
              </div>
            </div>
          </div>

          {canSetGoal ? (
            <div className="shrink-0">
              <GoalDialog
                groupId={groupId}
                current={target}
                currentNotesPerChild={notesPerChildTarget}
                maxChildren={enrolled}
              />
            </div>
          ) : null}
        </Card>
      </section>

      <ChildCoverage
        groupId={groupId}
        byChild={data?.byChild ?? []}
        notesPerChildTarget={notesPerChildTarget}
      />

      {/*
        ★ 2026-10-01, at the client's instruction: the monthly chart stays on
        the summary, with no Дэлгэрэнгүй link.
      */}
      <MonthlyCoverage months={months} />
    </section>
  );
}

/**
 * Who has notes this month and who has not — the drawing's own table.
 *
 * ★ Sorted by how far behind each child is, not alphabetically.
 *
 * The screen is read to answer "who still needs writing about", so the answer
 * is the first row. A register sorted by name makes a teacher scan twenty rows
 * for the two that matter — and on the last week of the month those two are
 * the whole reason the screen is open.
 *
 * ★★ The bar is per child, against the per-child goal rather than the group's.
 * Without a goal set there is nothing to be behind, so the column shows the
 * count alone and no state.
 */
function ChildCoverage({
  groupId,
  byChild,
  notesPerChildTarget,
}: {
  groupId: string;
  byChild: { childId: string; count: number }[];
  notesPerChildTarget: number | null;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "incomplete" | "complete">("all");
  const roster = useQuery({
    queryKey: qk.children({ groupId, page: 1, pageSize: MAX_PAGE_SIZE }),
    queryFn: () =>
      get(
        `/children?groupId=${groupId}&page=1&pageSize=${MAX_PAGE_SIZE}`,
        paginated(childSummarySchema),
      ),
    enabled: Boolean(groupId),
    staleTime: 60_000,
  });

  if (roster.isPending) return <LoadingState rows={3} />;
  /* A roster this reader may not have is not worth a red panel over a summary
     that renders perfectly well without it. */
  if (roster.isError) return null;

  const counts = new Map(byChild.map((row) => [row.childId, row.count]));
  const target = notesPerChildTarget ?? 0;

  const allRows = (roster.data?.items ?? [])
    .map((child) => {
      const count = counts.get(child.id) ?? 0;
      return {
        child,
        count,
        met: target > 0 ? count >= target : count > 0,
        percent:
          target > 0 ? Math.min(100, Math.round((count / target) * 100)) : count > 0 ? 100 : 0,
      };
    })
    /* Furthest behind first; ties keep the roster's own order. */
    .sort((x, y) => x.percent - y.percent || x.count - y.count);

  if (allRows.length === 0) return null;

  const normalizedQuery = query.trim().toLocaleLowerCase("mn-MN");
  const rows = allRows.filter(({ child, met: isMet }) => {
    const matchesName =
      !normalizedQuery || fullName(child).toLocaleLowerCase("mn-MN").includes(normalizedQuery);
    const matchesFilter = filter === "all" || (filter === "complete" ? isMet : !isMet);
    return matchesName && matchesFilter;
  });

  return (
    <Card pad="none" className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-title font-semibold text-ink">
          Хүүхдийн хамрагдалт ({allRows.length})
        </h2>
        <div className="grid grid-cols-3 gap-1 rounded-control bg-canvas p-1">
          {(
            [
              ["all", "Бүгд"],
              ["incomplete", "Дутуу"],
              ["complete", "Биелсэн"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "min-h-8 rounded-control px-3 text-caption font-semibold",
                filter === value ? "bg-surface text-primary shadow-sm" : "text-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative border-b border-border-soft px-4 py-3">
        <Search
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Хүүхдийн нэрээр хайх…"
          aria-label="Хүүхдийн нэрээр хайх"
          className="h-10 w-full rounded-control border border-border-soft bg-canvas pl-11 pr-3 text-body text-ink outline-none focus:border-primary focus:bg-surface"
        />
      </div>

      {/*
        ★ Fits a phone without sideways scrolling — 2026-10-07, the client:
        "утсан дээр бүрэн харагддаг болгоод шах". The 560px floor and the
        16px cell padding apply from `sm` up only.
      */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-compact sm:min-w-[560px] sm:text-body">
          <caption className="sr-only">Хүүхдийн хамрагдалт</caption>
          <thead className="bg-sunken">
            <tr>
              <th className="w-8 px-2 py-2 sm:w-14 sm:px-4 sm:py-3 text-left text-caption font-semibold text-muted">
                №
              </th>
              <th className="px-2 py-2 sm:px-4 sm:py-3 text-left text-caption font-semibold text-muted">
                Овог, нэр
              </th>
              <th className="px-2 py-2 sm:px-4 sm:py-3 text-left text-caption font-semibold text-muted">
                Нас
              </th>
              <th className="px-2 py-2 sm:px-4 sm:py-3 text-right text-caption font-semibold text-muted">
                Тэмдэглэл
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ child, count, met: isMet }, index) => (
              <tr key={child.id} className="border-t border-border-soft hover:bg-canvas">
                <td className="px-2 py-2 sm:px-4 sm:py-3 tabular-nums text-muted">{index + 1}</td>
                <td className="px-2 py-2 sm:px-4 sm:py-3">
                  <Link
                    href={`/children/${child.id}/observations?type=daily`}
                    className="flex items-center gap-2.5 font-semibold leading-snug text-ink hover:text-primary"
                  >
                    {shortName(child)}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-2 py-2 sm:px-4 sm:py-3 text-muted">
                  {formatAge(child.dateOfBirth)}
                </td>
                <td
                  className={cn(
                    "whitespace-nowrap px-2 py-2 sm:px-4 sm:py-3 text-right font-semibold tabular-nums",
                    isMet ? "text-mint-ink" : count > 0 ? "text-sun-ink" : "text-muted",
                  )}
                >
                  {target > 0 ? `${count}/${target}` : count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-body text-muted">Тохирох хүүхэд олдсонгүй.</p>
      ) : null}
    </Card>
  );
}

export function observationTypeIcon(name: string): ReactNode {
  const value = normalized(name);
  if (value.includes("ярилц")) return <MessageCircle size={14} aria-hidden="true" />;
  if (value.includes("бүтээл")) return <Palette size={14} aria-hidden="true" />;
  return <Eye size={14} aria-hidden="true" />;
}

/**
 * One of the month's four figures — the client's 2026-09-17 drawing.
 *
 * ★ A white card with the tone kept to the bar under the figure. The drawing
 * tints each box; a row of four pastel panels is a band of paint across the
 * top of a screen whose job is the table below it, and the colour carries
 * nothing the bar does not.
 */
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
