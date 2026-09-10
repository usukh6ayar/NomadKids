"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Eye, Lightbulb, MessageCircle, Palette, Target } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { assessmentConfigSchema, groupObservationStatsSchema } from "@kinder/contracts";
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
  const { hasRole } = useSession();
  const rows = useCoverageRows({ groupId, startsOn, endsOn });
  const {
    stats,
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
  const isAdmin = hasRole("ADMIN");

  /*
    ★ "Сайн байна" only when the recent months are genuinely even.

    Every month that has passed and has notes in it, with none of them at zero
    — a group that documented in September and stopped is not steady, and
    congratulating it would be the caption that stops being read.
  */
  const elapsed = months.filter((month) => month.key <= currentMonth);
  const steady = elapsed.length >= 2 && elapsed.every((month) => month.childrenCount > 0);

  /*
    ★ "Санал" names the strands that are running ahead, and only when one
    genuinely is.

    A strand carrying more than a third of every note is lopsided; an even
    spread gets no advice rather than hedged advice.
  */
  const domainTotal = domainRows.reduce((sum, row) => sum + row.count, 0);
  const lopsided =
    domainTotal >= 6
      ? domainRows
          .filter((row) => row.count / domainTotal >= 0.33)
          .map((row) => row.name)
          .join(", ")
      : "";
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
            {selectedMonthLocative} зорилтоо биелүүлэхэд {Math.max(target - completed, 0)} хүүхдэд
            тэмдэглэл хөтлөх үлдлээ.
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
      <Card tone="mint" pad="compact" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-body font-semibold text-ink">
            <Target size={16} aria-hidden="true" className="text-mint-ink" />
            Энэ сарын зорилт
          </span>
          <div className="flex items-center gap-2">
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
            {/*
              ★ Administrator only, and absent rather than disabled for a
              teacher — the rule the sidebar note states: a control that will
              never work for this account promises something it cannot give.
            */}
            {isAdmin ? <GoalDialog kindergartenId={kindergartenId} current={target} /> : null}
          </div>
        </div>

        {target === null ? (
          <p className="text-body text-ink">
            Сарын зорилт тохируулаагүй байна.
            {isAdmin ? "" : " Цэцэрлэгийн удирдлага тохируулна."}
          </p>
        ) : (
          <>
            <p className="flex items-baseline gap-2 text-body text-ink">
              <strong className="text-display font-semibold tabular-nums leading-none">
                {target}
              </strong>
              хүүхдийн хөгжлийн явцыг баримтжуулах
            </p>

            <div>
              <div className="flex items-baseline justify-between gap-4 text-body">
                <span className="text-ink">
                  Одоогоор{" "}
                  <strong className="tabular-nums">
                    {completed} / {target}
                  </strong>{" "}
                  хүүхэд
                </span>
                <span className="font-bold tabular-nums text-mint-ink">{percent}%</span>
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
              <p className="mt-2 text-caption text-muted">
                {targetMet
                  ? `${selectedMonthGenitive} зорилт биелсэн байна.`
                  : `${Math.max(target - completed, 0)} хүүхдийн явцыг баримтжуулах үлдсэн.`}
              </p>
            </div>
          </>
        )}
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
          <h3 className="text-body font-semibold text-ink">Ангийн хамрагдалт</h3>
        </div>

        <div className="flex items-center gap-5">
          <Donut
            size={120}
            segments={[
              { label: "Хамрагдсан", value: withNotes, tone: "mint" },
              {
                label: "Хараахан баримтгүй",
                value: Math.max(0, enrolled - withNotes),
                tone: "sun",
              },
            ]}
            label={`${enrolled} хүүхдээс ${withNotes} нь баримттай`}
            centre={
              <span className="text-lead font-semibold tabular-nums leading-none text-ink">
                {enrolled === 0 ? "—" : `${Math.round((withNotes / enrolled) * 100)}%`}
              </span>
            }
          />

          <dl className="min-w-0 flex-1 text-body">
            <dt className="text-caption text-muted">Нийт хүүхэд</dt>
            <dd className="mb-2 text-title font-semibold tabular-nums leading-none text-ink">
              {enrolled}
            </dd>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-pill bg-mint-ink" />
              <dt className="flex-1 text-muted">Хамрагдсан</dt>
              <dd className="font-semibold tabular-nums text-ink">{withNotes}</dd>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-pill bg-sun-ink" />
              <dt className="flex-1 text-muted">Хараахан баримтгүй</dt>
              <dd className="font-semibold tabular-nums text-ink">
                {Math.max(0, enrolled - withNotes)}
              </dd>
            </div>
          </dl>
        </div>
      </Card>

      {/*
        ★ Баримтжуулалтын хэлбэр — the three kinds as figures, not bars.

        Bars compare against a denominator; these three are compared against
        each other, and the question is whether one has been neglected. Three
        numbers side by side answer that at a glance, which is why the client's
        design draws them as tiles and the breakdown screen behind them as
        bars.
      */}
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

        <div className="grid grid-cols-3 gap-3">
          {typeRows.map((row) => (
            <Card key={row.id} pad="compact" className="flex flex-col gap-1.5 bg-sunken">
              <span aria-hidden="true" className="text-muted">
                {observationTypeIcon(row.name)}
              </span>
              <span className="text-caption leading-snug text-muted">{row.name}</span>
              <span className="text-title font-semibold tabular-nums leading-none text-ink">
                {row.count}
              </span>
            </Card>
          ))}
        </div>

        <p className="text-caption text-muted">
          Нийт {typeRows.reduce((sum, row) => sum + row.count, 0)} баримт
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
      />
      <InlineBars
        title="Үйл ажиллагааны үеийн хамралт"
        href={href("activities")}
        rows={activityRows}
        tone="sun"
      />

      <MonthBalance months={months} href={href("months")} />

      {/*
        ★ Both notes are computed, and each is absent when it has nothing to
        say.

        The client's mock prints a green "Сайн байна" and an amber "Санал". A
        fixed pair would keep congratulating a group that had stopped and keep
        advising one that was already even — which is worse than silence,
        because a caption that never changes stops being read.
      */}
      {steady ? (
        <Card pad="roomy" tone="mint" className="flex items-start gap-2.5">
          <CheckCircle2 size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-mint-ink" />
          <p className="text-body leading-snug text-ink">
            <strong className="block">Сайн байна</strong>
            Сүүлийн саруудад хүүхдүүдийг тогтмол хамруулж баримтжуулсан байна.
          </p>
        </Card>
      ) : null}

      {lopsided ? (
        <Card pad="roomy" tone="sun" className="flex items-start gap-2.5">
          <Lightbulb size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-sun-ink" />
          <p className="text-body leading-snug text-ink">
            <strong className="block">Санал</strong>
            Тэмдэглэл {lopsided} чиглэлээр түлхүү байна. Бусад чиглэлд нэмэгдүүлэх боломжтой.
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
}: {
  title: string;
  href: string;
  rows: CountRow[];
  tone: Tone;
}) {
  const peak = Math.max(...rows.map((row) => row.count), 1);

  return (
    <Card pad="roomy" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body font-semibold text-ink">{title}</h3>
        <Link href={href} className="text-caption font-medium text-primary hover:underline">
          Дэлгэрэнгүй
        </Link>
      </div>

      {rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[minmax(110px,1fr)_minmax(64px,1.3fr)_28px] items-center gap-2"
        >
          <span className="min-w-0 truncate text-caption leading-snug text-ink">{row.name}</span>
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
          <strong className="text-right text-caption tabular-nums text-ink">{row.count}</strong>
        </div>
      ))}
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
