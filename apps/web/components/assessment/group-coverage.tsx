"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, CheckCircle2, Eye, Lightbulb, MessageCircle, Palette, Target } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { groupObservationStatsSchema, groupSchema } from "@kinder/contracts";
import { useSession } from "@/lib/auth/session";
import { Donut } from "@/components/ui/chart/donut";
import { GoalDialog } from "./goal-dialog";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { TONE_VAR, type Tone } from "@/components/ui/tone";

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
    selectedStats,
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
  termId,
  recordComposer,
}: {
  groupId: string;
  startsOn?: string | null;
  endsOn?: string | null;
  /** The term the register behind this summary has open, carried into the links. */
  termId?: string;
  /** Child picker and note shortcuts, placed inside the monthly goal card. */
  recordComposer?: ReactNode;
}) {
  const { hasRole } = useSession();
  const rows = useCoverageRows({ groupId, startsOn, endsOn });
  const {
    stats,
    selectedStats,
    data,
    months,
    selected,
    currentMonth,
    setSelectedMonth,
    typeRows,
    domainRows,
    activityRows,
  } = rows;

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
  const targetMet = target !== null && goalCompleted >= target;
  const totalNoteTarget = target && notesPerChildTarget ? target * notesPerChildTarget : null;
  const totalNotePercent = totalNoteTarget
    ? Math.min(100, Math.round(((data?.total ?? 0) / totalNoteTarget) * 100))
    : null;
  const selectedMonthLocative = selected.label.replace(" сар", " сард");
  const selectedMonthGenitive = selected.label.replace(" сар", " сарын");
  const shouldRemind =
    target !== null &&
    selected.key === currentMonth &&
    new Date().getDate() >= 21 &&
    !targetMet &&
    (data?.enrolled ?? 0) > 0;

  const enrolled = data?.enrolled ?? 0;
  const coverageBase = target && target > 0 ? target : enrolled;
  const coverageCompleted = Math.min(completed, coverageBase);
  const coveragePercent =
    coverageBase === 0 ? 0 : Math.min(100, Math.round((completed / coverageBase) * 100));
  /*
    ★ Any member of staff on this screen may set it, not only an administrator.

    `RequireRole` already gates the page to TEACHER and ADMIN, and the server
    checks that a teacher is actually assigned to the group — so the control is
    offered to everyone who can reach it and refused by the one place that can
    refuse it properly (§1.1).
  */
  const canSetGoal = hasRole("TEACHER") || hasRole("ADMIN");

  /*
    ★ "Сайн байна" only when the recent months are genuinely even.

    Every month that has passed and has notes in it, with none of them at zero
    — a group that documented in September and stopped is not steady, and
    congratulating it would be the caption that stops being read.
  */
  const elapsed = months.filter((month) => month.key <= currentMonth);
  const steady = elapsed.length >= 2 && elapsed.every((month) => month.childrenCount > 0);

  const domainTotal = domainRows.reduce((sum, row) => sum + row.count, 0);
  const highestDomainCount = Math.max(...domainRows.map((row) => row.count), 0);
  const leadingDomains = domainRows.filter(
    (row) => highestDomainCount > 0 && row.count === highestDomainCount,
  );
  const emptyDomains = domainRows.filter((row) => row.count === 0);
  const lowestPositiveCount = Math.min(
    ...domainRows.filter((row) => row.count > 0).map((row) => row.count),
    Number.POSITIVE_INFINITY,
  );
  const trailingDomains = domainRows.filter(
    (row) => row.count > 0 && row.count === lowestPositiveCount,
  );
  const typeTotal = typeRows.reduce((sum, row) => sum + row.count, 0);
  const typeScale =
    target && target > 0 ? target : Math.max(...typeRows.map((row) => row.count), 1);
  /*
    ★ The term rides along, so Буцах returns to the one the teacher had open.

    The breakdowns are taken over the school year rather than the term, so
    `termId` changes nothing about what they show — but it is what the register
    behind them is keyed on, and dropping it would land a returning teacher on
    the default term with their selection lost.
  */
  const href = (kind: string) =>
    `/groups/${groupId}/assessment/${kind}${termId ? `?termId=${termId}` : ""}`;

  return (
    <section aria-label="Үнэлгээний сарын тойм" className="flex flex-col gap-4">
      {shouldRemind ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-row border border-sun bg-sun/40 px-4 py-3 text-body text-ink"
        >
          <span aria-hidden="true" className="mt-0.5 size-2.5 shrink-0 rounded-pill bg-sun-ink" />
          <p>
            {selectedMonthLocative} зорилтоо биелүүлэхэд {Math.max(target - goalCompleted, 0)}
            хүүхдийн тэмдэглэлийг гүйцээх үлдлээ.
          </p>
        </div>
      ) : null}

      {/*
        ★ Энэ сарын зорилт — children documented this month, not notes written.

        A goal counted in notes is met by writing twenty about one child; this
        one is only met by reaching twenty different children, which is what
        "хүүхэд бүрийн хөгжлийн явц" asks for.

        Drawn only when the kindergarten has set one: a target nobody agreed to
        would be a bar failing against a number the product invented — and the
        number used to be exactly that, whatever each teacher had typed into
        their own browser.
      */}
      <Card tone="mint" pad="compact" className="flex flex-col gap-4">
        <div className="flex items-center gap-1.5 text-body font-semibold text-ink">
          <Target size={16} aria-hidden="true" className="text-mint-ink" />
          Энэ сарын зорилт
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-caption font-medium text-muted">Сар</span>
            <select
              aria-label="Тайлант сар сонгох"
              value={selected.key}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="h-10 w-full rounded-control border border-mint bg-surface px-3 text-body font-semibold text-ink"
            >
              {months.map((month) => (
                <option key={month.key} value={month.key}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>
          {canSetGoal ? (
            <GoalDialog
              groupId={groupId}
              current={target}
              currentNotesPerChild={notesPerChildTarget}
              maxChildren={enrolled}
            />
          ) : null}
        </div>

        <p className="text-caption text-muted">
          Сараа сонгоход доорх бүх үзүүлэлт тухайн сарын мэдээллээр шинэчлэгдэнэ.
        </p>

        {recordComposer ? (
          <div className="border-t border-mint/70 pt-3">{recordComposer}</div>
        ) : null}

        <div className="rounded-row border border-mint/70 bg-surface/80 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-body font-semibold text-ink">Зорилтын биелэлт</p>
              <p className="text-caption text-muted">
                {target && notesPerChildTarget
                  ? `${target} хүүхэд · хүүхэд бүрт ${notesPerChildTarget} тэмдэглэл`
                  : "Хүүхэд болон тэмдэглэлийн зорилтоо сонгоно уу."}
              </p>
            </div>
            <strong className="text-title tabular-nums text-mint-ink">
              {target ? `${percent}%` : "—"}
            </strong>
          </div>

          {target ? (
            <div className="mt-3 flex flex-col gap-3">
              <GoalProgressRow
                label="Тэмдэглэлтэй хүүхэд"
                value={completed}
                total={target}
                tone="sky"
              />
              {notesPerChildTarget ? (
                <GoalProgressRow
                  label={`${notesPerChildTarget} тэмдэглэлтэй болсон`}
                  value={childrenMeetingNoteTarget}
                  total={target}
                  tone="mint"
                />
              ) : null}
              {totalNoteTarget && totalNotePercent !== null ? (
                <GoalProgressRow
                  label="Нийт тэмдэглэл"
                  value={data?.total ?? 0}
                  total={totalNoteTarget}
                  tone="sun"
                />
              ) : null}
              <p className="text-caption text-muted">
                {targetMet
                  ? `${selectedMonthGenitive} зорилт биелсэн байна.`
                  : `${Math.max(target - goalCompleted, 0)} хүүхдийн тэмдэглэлийг гүйцээх үлдсэн.`}
              </p>
            </div>
          ) : null}
        </div>
      </Card>

      {/*
        ★ Ангийн хамрагдалт — the ring is the headline and the parts are named.

        "80%" alone does not say of what; the three lines under it add up to the
        roster, so a reader can check the ring against the numbers rather than
        trusting it.

        ★★ The client's design has a third slice, "Шинэ хүүхэд". Nothing in the
        product distinguishes a newly enrolled child from any other child with
        no note yet, and inventing the distinction here would put a number on
        screen that no query stands behind. Two slices, honestly.
      */}
      <Card pad="roomy" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-body font-semibold text-ink">Нийт ангийн хамрагдалт</h3>
        </div>

        <div className="flex items-center gap-5">
          <Donut
            size={120}
            segments={[
              { label: "Хамрагдсан", value: coverageCompleted, tone: "mint" },
              {
                label: "Хараахан баримтгүй",
                value: Math.max(0, coverageBase - coverageCompleted),
                tone: "sun",
              },
            ]}
            label={
              target
                ? `${target} хүүхдийн зорилтоос ${completed} нь хамрагдсан`
                : `${enrolled} хүүхдээс ${completed} нь баримттай`
            }
            centre={
              <span className="text-lead font-semibold tabular-nums leading-none text-ink">
                {coverageBase === 0 ? "—" : `${coveragePercent}%`}
              </span>
            }
          />

          <dl className="min-w-0 flex-1 text-body">
            <dt className="text-caption text-muted">
              {target ? "Зорилтот хүүхэд" : "Нийт хүүхэд"}
            </dt>
            <dd className="mb-2 text-title font-semibold tabular-nums leading-none text-ink">
              {coverageBase}
            </dd>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-pill bg-mint-ink" />
              <dt className="flex-1 text-muted">Хамрагдсан</dt>
              <dd className="font-semibold tabular-nums text-ink">{completed}</dd>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-pill bg-sun-ink" />
              <dt className="flex-1 text-muted">Үлдсэн</dt>
              <dd className="font-semibold tabular-nums text-ink">
                {Math.max(0, coverageBase - completed)}
              </dd>
            </div>
          </dl>
        </div>
      </Card>

      <section aria-labelledby="record-kinds" className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 id="record-kinds" className="text-body font-semibold text-ink">
            Баримтжуулалтын хэлбэр
          </h3>
          <Link
            href={href("types")}
            className="text-caption font-medium text-primary hover:underline"
          >
            Дэлгэрэнгүй
          </Link>
        </div>

        <Card pad="compact" className="flex flex-col gap-3">
          {typeRows.map((row) => {
            const rowPercent =
              target && target > 0
                ? Math.min(100, Math.round((row.count / target) * 100))
                : typeTotal > 0
                  ? Math.round((row.count / typeTotal) * 100)
                  : 0;
            const barWidth = Math.min(100, (row.count / typeScale) * 100);

            return (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(92px,1fr)_minmax(72px,1.4fr)_64px] items-center gap-2.5"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-caption font-medium text-ink">
                  <span aria-hidden="true" className="shrink-0 text-muted">
                    {observationTypeIcon(row.name)}
                  </span>
                  <span className="truncate">{row.name}</span>
                </span>
                <span
                  role="img"
                  aria-label={`${row.name}: ${row.count} тэмдэглэл, ${rowPercent}%`}
                  className="h-2.5 overflow-hidden rounded-pill bg-track"
                >
                  <span
                    className="block h-full rounded-pill bg-sky-ink transition-[width]"
                    style={{ width: `${barWidth}%` }}
                  />
                </span>
                <span className="text-right text-caption tabular-nums text-muted">
                  <strong className="text-ink">{row.count}</strong> · {rowPercent}%
                </span>
              </div>
            );
          })}
        </Card>

        <p className="text-caption text-muted">
          {target
            ? `Зорилт ${target} хүүхэдтэй харьцуулсан хувь`
            : `Нийт ${typeRows.reduce((sum, row) => sum + row.count, 0)} баримт`}
        </p>
      </section>

      {/*
        ★ The two breakdowns inline, each with a way into its own screen.

        The client's design shows the bars on the summary *and* a Дэлгэрэнгүй
        link beside them — which is right: the shape is what a teacher reads
        here, and the screen behind it is where they filter and act. Rows that
        only navigated made them press to learn whether it was worth pressing.
      */}
      <InlineBars
        title="Сургалтын чиглэлийн хамралт"
        href={href("domains")}
        rows={domainRows}
        tone="sky"
        goal={target}
      />
      <InlineBars
        title="Үйл ажиллагааны үеийн хамралт"
        href={href("activities")}
        rows={activityRows}
        tone="sun"
        goal={target}
      />

      <MonthBalance months={months} href={href("months")} />

      {steady ? (
        <Card pad="roomy" tone="mint" className="flex items-start gap-2.5">
          <CheckCircle2 size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-mint-ink" />
          <p className="text-body leading-snug text-ink">
            <strong className="block">Сайн байна</strong>
            Сүүлийн саруудад хүүхдүүдийг тогтмол хамруулж баримтжуулсан байна.
          </p>
        </Card>
      ) : null}

      {domainTotal > 0 && leadingDomains.length > 0 ? (
        <Card pad="roomy" tone="sun" className="flex items-start gap-2.5">
          <Lightbulb size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-sun-ink" />
          <p className="text-body leading-snug text-ink">
            <strong className="block">Чиглэлийн зөвлөмж</strong>
            Энэ сард {leadingDomains.map((row) => row.name).join(", ")} чиглэлд хамгийн олон буюу{" "}
            {highestDomainCount} тэмдэглэл ({Math.round((highestDomainCount / domainTotal) * 100)}%)
            бүртгэгдсэн.{" "}
            {emptyDomains.length > 0
              ? `${emptyDomains.length} чиглэлд тэмдэглэл ороогүй байна. Дараагийн тэмдэглэлээ ${emptyDomains
                  .slice(0, 2)
                  .map((row) => row.name)
                  .join(", ")} чиглэлээс эхлүүлбэл хамралт жигдэрнэ.`
              : trailingDomains.length > 0 && trailingDomains[0]!.count < highestDomainCount
                ? `${trailingDomains.map((row) => row.name).join(", ")} чиглэл хамгийн бага (${trailingDomains[0]!.count}) байгаа тул дараагийн тэмдэглэлдээ түлхүү сонгоорой.`
                : "Чиглэлүүд жигд хамрагдсан байна."}
          </p>
        </Card>
      ) : null}
    </section>
  );
}

export function observationTypeIcon(name: string): ReactNode {
  const value = normalized(name);
  if (value.includes("ярилц")) return <MessageCircle size={14} aria-hidden="true" />;
  if (value.includes("бүтээл")) return <Palette size={14} aria-hidden="true" />;
  return <Eye size={14} aria-hidden="true" />;
}

function GoalProgressRow({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: Tone;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-caption">
        <span className="text-muted">{label}</span>
        <strong className="tabular-nums text-ink">
          {value} / {total}
        </strong>
      </div>
      <div
        role="progressbar"
        aria-label={`${label}: ${value} / ${total}`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(value, total)}
        className="h-2.5 overflow-hidden rounded-pill bg-track"
      >
        <div
          className="h-full rounded-pill transition-[width]"
          style={{ width: `${percent}%`, background: TONE_VAR[tone] }}
        />
      </div>
    </div>
  );
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
 * A breakdown on the summary, with a way into its own screen.
 *
 * ★ The bars *and* the link, not one or the other.
 *
 * Rows that only navigated made a teacher press to find out whether it was
 * worth pressing. The shape is what they read here; the screen behind it is
 * where they filter and act.
 *
 * ★★ Scaled to the busiest row rather than to the roster, because these count
 * notes and a strand can carry more notes than there are children. The
 * question on the summary is which strand is ahead of which, and that is a
 * comparison between the bars themselves.
 */
function InlineBars({
  title,
  href,
  rows,
  tone,
  goal,
}: {
  title: string;
  href: string;
  rows: CountRow[];
  tone: Tone;
  /** The month's target, when the group has set one. */
  goal: number | null;
}) {
  /*
    ★ Scaled to the goal when there is one, to the busiest row when there is
    not — 2026-09-10, at the client's request that these show whether they
    reach the month's figure.

    A bar scaled to the peak answers "which strand is ahead of which", which is
    useful but is not the question they asked. Scaled to the target, a full bar
    means the target is met and a short one says how far off it is — and the
    two readings cannot be confused because the scale itself changes.

    ★★ The counts are notes and the target counts children, so a row at the
    line has *as many notes as the month's child target*, not that many
    children. The caption says so rather than leaving the two units to be
    assumed equal.
  */
  const scale = goal && goal > 0 ? goal : Math.max(...rows.map((row) => row.count), 1);

  return (
    <Card pad="roomy" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body font-semibold text-ink">{title}</h3>
        <Link href={href} className="text-caption font-medium text-primary hover:underline">
          Дэлгэрэнгүй
        </Link>
      </div>

      {rows.map((row) => {
        const reached = goal !== null && goal > 0 && row.count >= goal;

        return (
          <div
            key={row.id}
            className="grid grid-cols-[minmax(110px,1fr)_minmax(64px,1.3fr)_44px] items-center gap-2"
          >
            <span className="min-w-0 truncate text-caption leading-snug text-ink">{row.name}</span>
            <span
              role="img"
              aria-label={
                goal
                  ? `${row.name}: ${row.count} тэмдэглэл, зорилт ${goal}${reached ? " — хүрсэн" : ""}`
                  : `${row.name}: ${row.count} тэмдэглэл`
              }
              className="relative h-2 overflow-hidden rounded-pill bg-track"
            >
              <span
                className="block h-full rounded-pill"
                style={{
                  width: `${Math.min(100, (row.count / scale) * 100)}%`,
                  background: reached ? TONE_VAR.mint : TONE_VAR[tone],
                }}
              />
            </span>
            <strong className="flex items-center justify-end gap-1 text-caption tabular-nums text-ink">
              {goal ? `${Math.min(100, Math.round((row.count / goal) * 100))}%` : row.count}
              {reached ? (
                <Check size={13} strokeWidth={3} aria-hidden="true" className="text-mint-ink" />
              ) : null}
            </strong>
          </div>
        );
      })}

      {goal ? (
        <p className="text-caption text-muted">
          Зорилт {goal} — {rows.filter((row) => row.count >= goal).length} / {rows.length} хүрсэн.
        </p>
      ) : null}
    </Card>
  );
}

/**
 * 9–5 сарын тэнцвэртэй байдал — children reached against notes written.
 *
 * ★ Two series, and they are not the same question.
 *
 * The columns are how many *children* were documented; the dots are how many
 * notes were written. A month where the two diverge is one where a lot was
 * written about a few — which is exactly what a balance chart is for and what
 * either series alone cannot show.
 *
 * ★★ Columns and a line rather than two sets of columns: the eye reads a line
 * as a trend and a column as a quantity, which is what each of these is.
 */
function MonthBalance({ months, href }: { months: MonthPoint[]; href: string }) {
  const peakChildren = Math.max(...months.map((month) => month.childrenCount), 1);
  const peakNotes = Math.max(...months.map((month) => month.count), 1);

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body font-semibold text-ink">9–5 сарын тэнцвэртэй байдал</h3>
        <Link href={href} className="text-caption font-medium text-primary hover:underline">
          Дэлгэрэнгүй
        </Link>
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-pill bg-primary" />
          Хамрагдсан хүүхэд
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-pill bg-mint-ink" />
          Баримтын тоо
        </span>
      </p>

      <ul className="grid h-[110px] grid-cols-9 items-end gap-1 border-b border-border-soft">
        {months.map((month) => (
          <li
            key={month.key}
            aria-label={`${month.label}: ${month.childrenCount} хүүхэд, ${month.count} баримт`}
            className="relative flex h-full min-w-0 flex-col items-center justify-end"
          >
            <span
              aria-hidden="true"
              className="w-full max-w-4 rounded-t-control bg-primary"
              style={{ height: Math.max(2, (month.childrenCount / peakChildren) * 78) }}
            />
            {/*
              The note count as a dot at its own height — a line drawn in SVG
              would need a viewBox and a scale for two numbers a dot already
              places.
            */}
            <span
              aria-hidden="true"
              className="absolute left-1/2 size-2.5 -translate-x-1/2 rounded-pill border-2 border-surface bg-mint-ink"
              style={{ bottom: Math.max(2, (month.count / peakNotes) * 78) + 14 }}
            />
          </li>
        ))}
      </ul>

      <ul aria-hidden="true" className="grid grid-cols-9 gap-1 text-center">
        {months.map((month) => (
          <li key={month.key} className="text-caption tabular-nums text-muted">
            {Number(month.key.slice(5))}
          </li>
        ))}
      </ul>
    </Card>
  );
}
