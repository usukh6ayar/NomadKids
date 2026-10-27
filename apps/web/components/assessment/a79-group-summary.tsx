"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Ring } from "@/components/ui/chart/ring";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";
import { get } from "@/lib/api/browser";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import type { A79Domain } from "@/lib/a79-assessment";
import {
  A79_BAND_LABEL,
  A79_DOMAIN_FILL,
  a79Band,
  a79GroupSummarySchema,
  a79MeanShare,
  a79Percent,
  type A79Band,
  type A79GroupSummary,
} from "@/lib/a79-progress";
import { shortName } from "@/lib/format";
import { cn } from "@/lib/utils";

const DOMAINS: A79Domain[] = ["Мэдлэг", "Чадвар", "Төлөвшил"];
const BAND_TONE: Record<A79Band, "mint" | "sun" | "peach"> = {
  MASTERED: "mint",
  PROGRESSING: "sun",
  DEVELOPING: "peach",
};

const pct = a79Percent;

/**
 * «Үр дүнгийн үнэлгээ» on Тайлан — the group's А/79 result in one place
 * (client, 2026-10-08): the group's share of criteria met, how many children
 * sit in each band, each part's average, and a row per child that opens their
 * own result. `GET /groups/:id/a79-summary` (`lib/a79-progress.ts`).
 */
/**
 * The group's А/79 result. Shared by Тайлан's tab and the «Үр дүнгийн үнэлгээ»
 * list, so the two cannot disagree. No range means the server's default (the
 * current school year).
 *
 * ★ A 404 is `notReady`, and draws `A79NotReady` — never sample figures.
 * Until 2026-10-08 it drew invented percentages beside the group's real
 * children under a yellow "sample" banner; the client asked for the banner to
 * go, and the figures could not stay without it — a director reading «А.Төгс
 * 63%» has no way to know nobody ever assessed А.Төгс.
 */
export function useA79GroupSummary(groupId: string, range?: { from: string; to: string }) {
  const query = range ? `?from=${range.from}&to=${range.to}` : "";
  const summary = useQuery({
    queryKey: ["group", groupId, "a79-summary", range?.from ?? null, range?.to ?? null],
    queryFn: () => get(`/groups/${groupId}/a79-summary${query}`, a79GroupSummarySchema),
    enabled: Boolean(groupId),
    retry: false,
  });
  const notReady = summary.isError && isNotFound(summary.error);

  return {
    data: summary.data,
    notReady,
    isLoading: summary.isLoading,
    error: summary.isError && !notReady ? summary.error : null,
  };
}

/** What a group, a child or the kindergarten shows while there is no result. */
export function A79NotReady() {
  return (
    <EmptyState
      title="Үр дүн хараахан гараагүй байна"
      description="Ажиглалтыг А/79-ийн шалгуурт холбосны дараа хүүхдийн үр дүн энд харагдана."
    />
  );
}

export type A79ChildRow = A79GroupSummary["children"][number] & {
  percent: number;
  domain: Partial<Record<A79Domain, number>>;
};

export function a79ChildRows(data: A79GroupSummary): A79ChildRow[] {
  return data.children.map((child) => ({
    ...child,
    percent: pct(child.achieved, child.total),
    domain: Object.fromEntries(
      child.byDomain.map((row) => [row.domain, pct(row.achieved, row.total)]),
    ) as Partial<Record<A79Domain, number>>,
  }));
}

/**
 * ★ A child no note is linked to (2026-10-27, the user's director report:
 * eighteen children «0% · Хөгжиж байна»). Not assessed is not «Хөгжиж байна»
 * — the regulation's band is a judgement made from evidence (А/79 §2.9).
 * `assessed` is absent from an older server, which leaves the row as it was.
 */
function unassessed(row: A79ChildRow): boolean {
  return row.assessed === 0;
}

/**
 * The rows with figures — an unpaid solo child (`feeDue`) and a child with no
 * note linked are named on the table and counted in no average: their 0 is a
 * withheld or a missing figure, not a result.
 */
function scored(rows: A79ChildRow[]): A79ChildRow[] {
  return rows.filter((row) => !row.feeDue && !unassessed(row));
}

/**
 * A group's averages — each part and the whole, over its children's own
 * percentages, as the group's result page shows them. `null` with no children.
 */
export function a79GroupAverages(
  all: A79ChildRow[],
): { total: number; byDomain: Record<A79Domain, number> } | null {
  const rows = scored(all);
  if (rows.length === 0) return null;
  return {
    total: a79MeanShare(rows),
    byDomain: {
      Мэдлэг: domainAverage(rows, "Мэдлэг"),
      Чадвар: domainAverage(rows, "Чадвар"),
      Төлөвшил: domainAverage(rows, "Төлөвшил"),
    },
  };
}

export function A79GroupSummaryPanel({
  groupId,
  from,
  to,
}: {
  groupId: string;
  from: string;
  to: string;
}) {
  const { data, notReady, isLoading, error } = useA79GroupSummary(groupId, { from, to });

  return (
    <section className="mt-3 flex flex-col gap-3">
      <SectionHeader title="Үр дүнгийн үнэлгээ" as="h2" />
      {notReady ? <A79NotReady /> : null}
      {isLoading ? <LoadingState rows={3} /> : null}
      {error ? <ErrorState description={errorMessage(error)} /> : null}
      {data ? <SummaryBody groupId={groupId} data={data} /> : null}
    </section>
  );
}

function SummaryBody({ groupId, data }: { groupId: string; data: A79GroupSummary }) {
  if (data.children.length === 0) {
    return (
      <EmptyState
        title="Бүлэгт хүүхэд алга"
        description="Хүүхэд бүлэгт бүртгэгдсэний дараа үр дүн энд харагдана."
      />
    );
  }

  const rows = a79ChildRows(data);
  const withFigures = scored(rows);
  return (
    <>
      {withFigures.length > 0 ? (
        <A79SummaryChart
          rows={withFigures}
          averageLabel="Бүлгийн дундаж"
          description={`Бүлгийн дундаж, ${withFigures.length} хүүхэд. Хүүхдийн хувь бол өөрийн түвшний шалгуурын хэдийг хангалттай эзэмшсэн нь.`}
        />
      ) : null}
      {rows.some(unassessed) ? (
        <p className="text-caption text-muted">
          {rows.filter(unassessed).length} хүүхдэд тэмдэглэл холбогдоогүй тул дунджид ороогүй. Явцын
          үнэлгээний тэмдэглэлийг А/79 шалгуурт холбоход энд гарна.
        </p>
      ) : null}

      <A79ChildrenTable groupId={groupId} rows={rows} />
    </>
  );
}

function domainAverage(rows: A79ChildRow[], domain: A79Domain): number {
  return a79MeanShare(
    rows.map((row) => row.byDomain.find((d) => d.domain === domain) ?? { achieved: 0, total: 0 }),
  );
}

/**
 * The figure in an А/79 ring, to its one decimal — the shared `Ring` rounds to
 * a whole percent, and 79.5% must not read 80% beside «Ахиж байна» (А/79
 * §2.10, 2026-10-22). A decimal takes a size down to fit the hole.
 */
export function A79RingFigure({ percent }: { percent: number }) {
  return (
    <span
      className={cn(
        "font-semibold tabular-nums text-ink",
        Number.isInteger(percent) ? "text-title" : "text-lead",
      )}
    >
      {percent}%
    </span>
  );
}

export function A79SummaryChart({
  rows,
  averageLabel,
  description,
  title,
}: {
  rows: A79ChildRow[];
  averageLabel: string;
  description: string;
  title?: string;
}) {
  const average = a79MeanShare(rows);
  const bands = (["MASTERED", "PROGRESSING", "DEVELOPING"] as const).map((band) => ({
    band,
    count: rows.filter((row) => a79Band(row.percent) === band).length,
  }));

  return (
    <Card pad="roomy" className="flex flex-col gap-4">
      {title ? <h3 className="text-lead font-semibold text-ink">{title}</h3> : null}
      <div className="flex flex-wrap items-center gap-4">
        <Ring
          percent={average}
          size="lg"
          fadeTo="var(--color-violet-chart)"
          label={`${averageLabel}: ${average}%`}
        >
          <A79RingFigure percent={average} />
        </Ring>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-body text-ink">{description}</p>
          <ul aria-label="Хүүхдийн тоо, бүсээр" className="flex flex-wrap gap-2">
            {bands.map(({ band, count }) => (
              <li key={band}>
                <Badge tone={BAND_TONE[band]}>
                  {A79_BAND_LABEL[band]} · {count}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <ul aria-label="Хэсгийн дундаж" className="flex flex-col gap-2">
        {DOMAINS.map((domain) => {
          const value = domainAverage(rows, domain);
          return (
            <li key={domain} className="grid grid-cols-[6rem_1fr_3rem] items-center gap-3">
              <span className="text-body text-ink">{domain}</span>
              <span
                role="progressbar"
                aria-label={`${domain}: ${value}%`}
                aria-valuenow={value}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 overflow-hidden rounded-pill bg-track"
              >
                <span
                  className="block h-full rounded-pill"
                  style={{ width: `${value}%`, background: A79_DOMAIN_FILL[domain] }}
                />
              </span>
              <span className="text-right text-caption font-semibold tabular-nums text-ink">
                {value}%
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export interface A79ReportGroup {
  id: string;
  name: string;
}

/**
 * The director's А/79 view — one kindergarten chart, then one comparable row
 * per group. The aggregate is weighted by children rather than averaging the
 * groups, so a five-child group does not count as much as a twenty-child one.
 */
export function A79KindergartenSummaryPanel({
  groups,
  from,
  to,
}: {
  groups: A79ReportGroup[];
  from: string;
  to: string;
}) {
  const summaries = useQueries({
    queries: groups.map((group) => ({
      queryKey: ["group", group.id, "a79-summary", from, to],
      queryFn: () =>
        get(`/groups/${group.id}/a79-summary?from=${from}&to=${to}`, a79GroupSummarySchema),
      retry: false,
    })),
  });
  // One group without a result leaves the kindergarten's figure without it
  // too, so any 404 draws the not-ready state for the whole panel.
  const notReady = summaries.some((query) => query.isError && isNotFound(query.error));
  const error = summaries.find((query) => query.isError && !isNotFound(query.error))?.error;
  const isLoading = summaries.some((query) => query.isLoading);
  const data = groups.flatMap((group, index) => {
    const summary = summaries[index]?.data;
    return summary ? [{ group, summary }] : [];
  });

  return (
    <section className="mt-3 flex flex-col gap-3">
      <SectionHeader title="Үр дүнгийн үнэлгээ" as="h2" />
      {isLoading ? <LoadingState rows={3} /> : null}
      {error ? <ErrorState description={errorMessage(error)} /> : null}
      {!isLoading && !error && notReady ? <A79NotReady /> : null}
      {!isLoading && !error && groups.length === 0 ? (
        <EmptyState title="Бүлэг бүртгэгдээгүй байна" />
      ) : null}
      {!isLoading && !error && data.length === groups.length && data.length > 0 ? (
        <KindergartenSummaryBody groups={data} />
      ) : null}
    </section>
  );
}

/**
 * The kindergarten chart and one row per group. Exported for «Гарааны
 * үнэлгээ» (2026-10-21), which draws the same table from the baseline
 * surveys; every option defaults to the result screen's own wording.
 */
export function KindergartenSummaryBody({
  groups,
  hrefFor = (groupId) => `/groups/${groupId}/results`,
  countFor,
  noDataLabel = "Мэдээлэл алга",
  emptyTitle = "Цэцэрлэгт хүүхдийн үр дүн алга",
  emptyDescription = "Хүүхдийн үнэлгээ бүртгэгдсэний дараа бүлгийн үзүүлэлтүүд энд харагдана.",
}: {
  groups: { group: A79ReportGroup; summary: A79GroupSummary }[];
  hrefFor?: (groupId: string) => string;
  /** The «Хүүхэд» cell — the scored count unless given. */
  countFor?: (groupId: string, scored: number) => string;
  noDataLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const groupRows = groups.map(({ group, summary }) => {
    const children = scored(a79ChildRows(summary));
    const percent = children.length ? a79MeanShare(children) : null;
    return { group, children, percent };
  });
  const children = groupRows.flatMap((row) => row.children);

  if (children.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      <A79SummaryChart
        rows={children}
        averageLabel="Цэцэрлэгийн дундаж"
        title="Цэцэрлэгийн нэгтгэл график"
        description={`Цэцэрлэгийн дундаж, ${children.length} хүүхэд · ${groups.length} бүлэг. Бүлгийн хэмжээнээс үл хамааран хүүхэд бүр ижил жинтэй тооцогдоно.`}
      />

      <TableShell caption="Бүлэг бүрийн үзүүлэлт" minWidth="min-w-[720px]">
        <thead>
          <tr>
            <Th className="w-10">№</Th>
            <Th>Бүлэг</Th>
            <Th numeric>Хүүхэд</Th>
            {DOMAINS.map((domain) => (
              <Th key={domain} numeric>
                {domain}
              </Th>
            ))}
            <Th numeric>Нийт</Th>
            <Th>Үр дүн</Th>
          </tr>
        </thead>
        <tbody>
          {groupRows.map((row, index) => {
            const band = row.percent === null ? null : a79Band(row.percent);
            return (
              <tr key={row.group.id}>
                <Td className="tabular-nums text-muted">{index + 1}</Td>
                <Td>
                  <Link
                    href={hrefFor(row.group.id)}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.group.name}
                  </Link>
                </Td>
                <Td numeric>
                  {countFor ? countFor(row.group.id, row.children.length) : row.children.length}
                </Td>
                {DOMAINS.map((domain) => (
                  <Td key={domain} numeric>
                    {row.children.length ? `${domainAverage(row.children, domain)}%` : "—"}
                  </Td>
                ))}
                <Td numeric className="font-semibold text-ink">
                  {row.percent === null ? "—" : `${row.percent}%`}
                </Td>
                <Td>
                  {band ? (
                    <Badge tone={BAND_TONE[band]}>{A79_BAND_LABEL[band]}</Badge>
                  ) : (
                    <Badge tone="neutral">{noDataLabel}</Badge>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>
    </>
  );
}

/**
 * A row per child — Нэр · Түвшин · Мэдлэг · Чадвар · Төлөвшил · Нийт · Үр дүн
 * — on Тайлан and on «Үр дүнгийн үнэлгээ» alike (client, 2026-10-08). The
 * name opens the child's own result.
 */
export function A79ChildrenTable({
  groupId,
  rows,
  linkChildren = true,
  childHref = (childId) => `/groups/${groupId}/results/${childId}`,
}: {
  groupId: string;
  rows: A79ChildRow[];
  /**
   * Off on «Гарааны үнэлгээ» (2026-10-21): a child's page is their result,
   * built from observations, not the baseline survey this row was read from.
   */
  linkChildren?: boolean;
  /** Where a name leads — the group's «Гарааны үнэлгээ» page opens the child's baseline. */
  childHref?: (childId: string) => string;
}) {
  return (
    <TableShell caption="Хүүхэд бүрийн үр дүн" minWidth="min-w-[560px]">
      <thead>
        <tr>
          <Th className="w-10">№</Th>
          <Th>Нэр</Th>
          <Th>Түвшин</Th>
          {DOMAINS.map((domain) => (
            <Th key={domain} numeric>
              {domain}
            </Th>
          ))}
          <Th numeric>Нийт</Th>
          <Th>Үр дүн</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          if (row.feeDue || unassessed(row)) {
            return (
              <tr key={row.childId}>
                <Td className="tabular-nums text-muted">{index + 1}</Td>
                <Td>
                  {linkChildren && !row.feeDue ? (
                    <Link
                      href={childHref(row.childId)}
                      className="font-medium text-primary hover:underline"
                    >
                      {shortName(row)}
                    </Link>
                  ) : (
                    <span className="text-ink">{shortName(row)}</span>
                  )}
                </Td>
                <Td>{row.level}</Td>
                {DOMAINS.map((domain) => (
                  <Td key={domain} numeric className="text-muted">
                    —
                  </Td>
                ))}
                <Td numeric className="text-muted">
                  —
                </Td>
                <Td>
                  <Badge tone="neutral">
                    {row.feeDue ? "Төлбөр төлөгдөөгүй" : "Тэмдэглэл холбоогүй"}
                  </Badge>
                </Td>
              </tr>
            );
          }
          const band = a79Band(row.percent);
          return (
            <tr key={row.childId}>
              <Td className="tabular-nums text-muted">{index + 1}</Td>
              <Td>
                {linkChildren ? (
                  <Link
                    href={childHref(row.childId)}
                    className="font-medium text-primary hover:underline"
                  >
                    {shortName(row)}
                  </Link>
                ) : (
                  <span className="font-medium text-ink">{shortName(row)}</span>
                )}
              </Td>
              <Td>{row.level}</Td>
              {DOMAINS.map((domain) => (
                <Td key={domain} numeric>
                  {row.domain[domain] ?? 0}%
                </Td>
              ))}
              <Td numeric className="font-semibold text-ink">
                {row.percent}%
              </Td>
              <Td>
                <Badge tone={BAND_TONE[band]}>{A79_BAND_LABEL[band]}</Badge>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}
