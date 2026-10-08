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
  type A79Band,
  type A79GroupSummary,
} from "@/lib/a79-progress";
import { shortName } from "@/lib/format";

const DOMAINS: A79Domain[] = ["Мэдлэг", "Чадвар", "Төлөвшил"];
const BAND_TONE: Record<A79Band, "mint" | "sun" | "peach"> = {
  MASTERED: "mint",
  PROGRESSING: "sun",
  DEVELOPING: "peach",
};

const pct = (achieved: number, total: number) =>
  total > 0 ? Math.round((achieved / total) * 100) : 0;

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
  return (
    <>
      <A79SummaryChart
        rows={rows}
        averageLabel="Бүлгийн дундаж"
        description={`Бүлгийн дундаж, ${rows.length} хүүхэд. Хүүхдийн хувь бол өөрийн түвшний шалгуурын хэдийг бие даан илрүүлсэн нь.`}
      />

      <A79ChildrenTable groupId={groupId} rows={rows} />
    </>
  );
}

function domainAverage(rows: A79ChildRow[], domain: A79Domain): number {
  if (rows.length === 0) return 0;
  return Math.round(rows.reduce((sum, row) => sum + (row.domain[domain] ?? 0), 0) / rows.length);
}

function A79SummaryChart({
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
  const average = Math.round(rows.reduce((sum, row) => sum + row.percent, 0) / rows.length);
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
        />
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

function KindergartenSummaryBody({
  groups,
}: {
  groups: { group: A79ReportGroup; summary: A79GroupSummary }[];
}) {
  const groupRows = groups.map(({ group, summary }) => {
    const children = a79ChildRows(summary);
    const percent = children.length
      ? Math.round(children.reduce((sum, row) => sum + row.percent, 0) / children.length)
      : null;
    return { group, children, percent };
  });
  const children = groupRows.flatMap((row) => row.children);

  if (children.length === 0) {
    return (
      <EmptyState
        title="Цэцэрлэгт хүүхдийн үр дүн алга"
        description="Хүүхдийн үнэлгээ бүртгэгдсэний дараа бүлгийн үзүүлэлтүүд энд харагдана."
      />
    );
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
                    href={`/groups/${row.group.id}/results`}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.group.name}
                  </Link>
                </Td>
                <Td numeric>{row.children.length}</Td>
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
                    <Badge tone="neutral">Мэдээлэл алга</Badge>
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
export function A79ChildrenTable({ groupId, rows }: { groupId: string; rows: A79ChildRow[] }) {
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
          const band = a79Band(row.percent);
          return (
            <tr key={row.childId}>
              <Td className="tabular-nums text-muted">{index + 1}</Td>
              <Td>
                <Link
                  href={`/groups/${groupId}/results/${row.childId}`}
                  className="font-medium text-primary hover:underline"
                >
                  {shortName(row)}
                </Link>
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
