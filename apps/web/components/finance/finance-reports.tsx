"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download, FileText } from "lucide-react";
import {
  FINANCE_REPORT_LABEL,
  FINANCE_REPORT_PERIOD,
  financeReportDownloadSchema,
  financeReportJobSchema,
  reportTableSchema,
  type FinanceReportKey,
  type ReportTable,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { money } from "./money";

/**
 * The eight financial reports — `нэмэлт.md` §16.
 *
 * ★ One screen, not eight. The reports differ in what they select, not in what
 * they are: a title, columns, rows, a total. Eight pages would be eight places
 * to fix the same formatting, and the accountant would have to learn where each
 * one lives.
 *
 * ★★ The period control **follows the report**. `unpaid` takes no period at all
 * — arrears are not a property of the month being viewed — and `annual` takes a
 * school year rather than a month. Showing a month picker beside the unpaid
 * report would imply a filter that does not apply, and the API would ignore it.
 */
export function FinanceReports({ kindergartenId }: { kindergartenId: string }) {
  const [report, setReport] = useState<FinanceReportKey>("state-funding");
  const [month, setMonth] = useState(thisMonth());
  const [year, setYear] = useState(thisSchoolYear());

  const kind = FINANCE_REPORT_PERIOD[report];
  // `unpaid` ignores it, but the API still requires the parameter to parse —
  // the month is harmless and keeps one query shape for all eight.
  const period = kind === "year" ? year : month;

  const table = useQuery({
    queryKey: qk.financeReport(kindergartenId, report, period),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/invoices/reports?report=${report}&period=${period}`,
        reportTableSchema,
      ),
  });

  return (
    <section aria-labelledby="reports-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="reports-heading"
        title="Санхүүгийн тайлан"
        lede="Ирц, хоол, нэхэмжлэлийн бүртгэлээс бодогдоно."
      />

      <Card pad="roomy" className="flex flex-wrap items-end gap-3">
        <Field label="Тайлан">
          {({ id }) => (
            <Select
              id={id}
              value={report}
              onChange={(event) => setReport(event.target.value as FinanceReportKey)}
              className="w-[320px] max-w-full"
            >
              {Object.entries(FINANCE_REPORT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {kind === "month" && (
          <Field label="Сар">
            {({ id }) => (
              <Input
                id={id}
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="w-[170px]"
              />
            )}
          </Field>
        )}

        {kind === "year" && (
          <Field label="Хичээлийн жил" hint="9-р сараас 8-р сар">
            {({ id }) => (
              <Input
                id={id}
                value={year}
                onChange={(event) => setYear(event.target.value)}
                placeholder="2025-2026"
                className="w-[150px]"
              />
            )}
          </Field>
        )}

        {/*
          ★ An anchor, not a fetch. The session cookie rides along on a
          navigation and the browser handles `Content-Disposition` itself —
          reading a spreadsheet into JavaScript to rebuild it as a blob would
          hold the whole file in memory to achieve the same thing.
        */}
        <Button size="sm" variant="secondary" asChild className="ml-auto">
          <a
            href={downloadUrl(
              `/kindergartens/${kindergartenId}/invoices/reports/export?report=${report}&period=${period}`,
            )}
          >
            <Download size={16} aria-hidden="true" /> Excel татах
          </a>
        </Button>

        <PdfButton kindergartenId={kindergartenId} report={report} period={period} />
      </Card>

      {table.isLoading && <LoadingState rows={4} />}
      {table.isError && <ErrorState description={errorMessage(table.error)} />}
      {table.data && <ReportTableView table={table.data} />}
    </section>
  );
}

/**
 * Queues the report as PDF and waits for it — `нэмэлт.md` §16.
 *
 * ★ **A job, not a download.** Chromium takes a couple of seconds and a
 * gigabyte of memory, so the PDF is rendered on BullMQ (CLAUDE.md §6) while the
 * spreadsheet beside it is built inline. That difference is why this is a
 * button with a spinner and the Excel control is a plain link.
 *
 * ★★ Polls only while a job is in flight, and stops the moment it finishes or
 * fails. An interval that kept running would keep hitting the API from a tab
 * nobody is looking at.
 */
function PdfButton({
  kindergartenId,
  report,
  period,
}: {
  kindergartenId: string;
  report: string;
  period: string;
}) {
  const toast = useToast();
  const [jobId, setJobId] = useState<string | null>(null);

  const queue = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/invoices/reports/pdf`, financeReportJobSchema, {
        method: "POST",
        body: { report, period },
      }),
    onSuccess: (job) => setJobId(job.id),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const job = useQuery({
    enabled: Boolean(jobId),
    queryKey: qk.financeReportJob(jobId ?? ""),
    queryFn: () => get(`/finance-reports/${jobId}`, financeReportJobSchema),
    // Stops on its own the moment the job settles.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "DONE" || status === "FAILED" ? false : 1500;
    },
  });

  const download = useMutation({
    mutationFn: () => get(`/finance-reports/${jobId}/download`, financeReportDownloadSchema),
    onSuccess: (result) => {
      setJobId(null);
      // A presigned URL, opened rather than fetched — the browser saves the
      // file and the credential never enters JavaScript's memory twice.
      window.location.href = result.url;
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const status = job.data?.status;
  const working = queue.isPending || status === "QUEUED" || status === "RUNNING";

  if (status === "FAILED") {
    return (
      <Button size="sm" variant="secondary" onClick={() => queue.mutate()}>
        <FileText size={16} aria-hidden="true" /> PDF дахин оролдох
      </Button>
    );
  }

  if (job.data?.downloadable) {
    return (
      <Button size="sm" onClick={() => download.mutate()} disabled={download.isPending}>
        <Download size={16} aria-hidden="true" /> PDF татах
      </Button>
    );
  }

  return (
    <Button size="sm" variant="secondary" onClick={() => queue.mutate()} disabled={working}>
      <FileText size={16} aria-hidden="true" />
      {working ? "PDF бэлдэж байна…" : "PDF үүсгэх"}
    </Button>
  );
}

function ReportTableView({ table }: { table: ReportTable }) {
  if (table.rows.length === 0) {
    return (
      <EmptyState
        title="Энэ хугацаанд бичлэг алга"
        description={
          table.note ?? "Тооцоо хийгдээгүй эсвэл энэ тайланд хамаарах бүртгэл байхгүй байна."
        }
      />
    );
  }

  const moneyKeys = new Set(table.columns.filter((column) => column.money).map((c) => c.key));

  return (
    <Card pad="none" className="overflow-hidden">
      {table.note && (
        <p className="border-b border-border px-4 py-3 text-caption text-muted">{table.note}</p>
      )}

      {/*
        ★ The scroll container is the table's own, not the page's. A report can
        be eight columns wide; letting the page scroll sideways would move the
        navigation off screen on a phone (CLAUDE.md §5's mobile-first rule).
      */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-border bg-canvas">
              {table.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={
                    moneyKeys.has(column.key)
                      ? "px-4 py-3 text-right font-medium text-ink"
                      : "px-4 py-3 text-left font-medium text-ink"
                  }
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index} className="border-b border-border last:border-0">
                {table.columns.map((column) => (
                  <Cell
                    key={column.key}
                    value={row[column.key]}
                    money={moneyKeys.has(column.key)}
                  />
                ))}
              </tr>
            ))}
          </tbody>

          {table.totals && (
            <tfoot>
              <tr className="border-t-2 border-border bg-canvas font-semibold">
                {table.columns.map((column) => (
                  <Cell
                    key={column.key}
                    value={table.totals![column.key]}
                    money={moneyKeys.has(column.key)}
                  />
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}

function Cell({ value, money: isMoney }: { value: unknown; money: boolean }) {
  if (value === null || value === undefined || value === "") {
    return <td className="px-4 py-3 text-muted">—</td>;
  }

  const text = isMoney ? money(String(value)) : String(value);

  return (
    <td
      className={
        isMoney ? "px-4 py-3 text-right tabular-nums text-ink" : "px-4 py-3 text-left text-ink"
      }
    >
      {text}
    </td>
  );
}

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The school year we are currently in — September to August.
 *
 * ★ Before September, the current year belongs to the one that started *last*
 * September. Defaulting to the calendar year would show an accountant an empty
 * report for eight months of every year.
 */
function thisSchoolYear(): string {
  const now = new Date();
  const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${start + 1}`;
}
