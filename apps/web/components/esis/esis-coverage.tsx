"use client";

import type { ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { esisCoverageMatrixSchema, type EsisCoverageState } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";

/**
 * «Яаманд өгөх 84/84 матриц» — ESIS_TRIAL_STATE §6, 2026-09-26.
 *
 * ★ The API has built this since the full-coverage spec (§7), and nothing
 * drew it: the one document the trial month ends with could only be produced
 * by somebody with a terminal. A director hands it to the ministry, so it
 * lives on their ESIS screen, with the spreadsheet one press away.
 *
 * ★★ It leads with the two questions the ministry will ask and that pull
 * against each other — "was what we granted used?" and "was anything left
 * without a reason?" — and only then the eighty-four rows. `undecided` is the
 * figure that must be nought; when it is not, it is the first thing said.
 */
const STATE: Record<
  EsisCoverageState,
  { label: string; tone: ComponentProps<typeof Badge>["tone"] }
> = {
  IN_USE: { label: "Ашиглагдаж буй", tone: "mint" },
  WIRED_UNUSED: { label: "Холбогдсон, дуудагдаагүй", tone: "sky" },
  DISPOSITIONED: { label: "Зориуд холбоогүй", tone: "neutral" },
  SUPERSEDED: { label: "Шинэ хувилбараар солигдсон", tone: "primary" },
  UNDECIDED: { label: "Шийдээгүй", tone: "peach" },
};

export function EsisCoverageSection({ kindergartenId }: { kindergartenId: string }) {
  const matrix = useQuery({
    queryKey: qk.esisCoverage(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/esis/coverage`, esisCoverageMatrixSchema),
    enabled: Boolean(kindergartenId),
  });

  return (
    <section aria-labelledby="esis-coverage-heading" className="flex flex-col gap-3">
      <SectionHeader
        id="esis-coverage-heading"
        title="Яаманд өгөх матриц"
        lede="Олгосон сервис бүр: юунд ашигласан, хэдэн удаа дуудсан, эсвэл яагаад ашиглаагүй."
        action={
          <Button asChild variant="secondary" size="sm">
            <a href={downloadUrl(`/kindergartens/${kindergartenId}/esis/coverage/export`)}>
              <Download size={16} aria-hidden /> Excel татах
            </a>
          </Button>
        }
      />

      {matrix.isLoading ? <LoadingState rows={4} /> : null}
      {matrix.isError ? <ErrorState description={errorMessage(matrix.error)} /> : null}

      {matrix.data ? (
        <>
          <p className="text-caption text-muted">
            {formatDate(matrix.data.from.slice(0, 10))} – {formatDate(matrix.data.to.slice(0, 10))}
          </p>

          <ul aria-label="Матрицын дүн" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { label: "Олгосон", value: matrix.data.totals.granted },
              { label: "Ашиглагдаж буй", value: matrix.data.totals.inUse },
              { label: "Холбогдсон, дуудагдаагүй", value: matrix.data.totals.wiredUnused },
              { label: "Зориуд холбоогүй", value: matrix.data.totals.dispositioned },
              { label: "Солигдсон", value: matrix.data.totals.superseded },
            ].map((figure) => (
              <li key={figure.label}>
                <Card pad="compact" className="h-full">
                  <p className="text-caption text-muted">{figure.label}</p>
                  <p className="text-title font-semibold tabular-nums text-ink">{figure.value}</p>
                </Card>
              </li>
            ))}
          </ul>

          {matrix.data.totals.undecided === 0 ? (
            <p className="rounded-control bg-mint px-3 py-2 text-body text-mint-ink">
              Шалтгаангүй үлдсэн сервис алга — ашиглаагүй сервис бүр шалтгаантай.
            </p>
          ) : (
            <p role="alert" className="rounded-control bg-peach px-3 py-2 text-body text-peach-ink">
              {matrix.data.totals.undecided} сервис шалтгаангүй — яаманд өгөхөөс өмнө шийдэх
              хэрэгтэй.
            </p>
          )}

          <TableShell caption="ЭСИС сервисийн матриц" minWidth="min-w-[860px]">
            <thead>
              <tr>
                <Th numeric>№</Th>
                <Th>Сервис</Th>
                <Th>Төлөв</Th>
                <Th>Зорилго / шалтгаан</Th>
                <Th numeric>Дуудлага</Th>
                <Th>Сүүлд</Th>
              </tr>
            </thead>
            <tbody>
              {matrix.data.rows.map((row) => (
                <tr key={row.apiId}>
                  <Td numeric className="text-muted">
                    {row.apiId}
                  </Td>
                  <Td>
                    <span className="block text-ink">{row.name}</span>
                    {row.method ? (
                      <span className="block text-caption text-muted">
                        {row.method} · {row.trigger}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Badge tone={STATE[row.state].tone}>{STATE[row.state].label}</Badge>
                  </Td>
                  <Td className="text-muted">{row.reason ?? (row.purpose || "—")}</Td>
                  <Td numeric className={row.calls > 0 ? "text-ink" : "text-muted"}>
                    {row.calls}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">
                    {row.lastCalledAt ? formatDate(row.lastCalledAt.slice(0, 10)) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </>
      ) : null}
    </section>
  );
}
