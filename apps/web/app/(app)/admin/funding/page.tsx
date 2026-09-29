"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import {
  childSummarySchema,
  groupListItemSchema,
  invoiceSummarySchema,
  paginated,
  schoolYearSchema,
  type ChildSummary,
  type InvoiceSummary,
} from "@kinder/contracts";
import { z } from "zod";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { fullName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

const childrenSchema = paginated(childSummarySchema);
const groupsSchema = paginated(groupListItemSchema);
const invoicesSchema = paginated(invoiceSummarySchema);
const yearsSchema = z.array(schoolYearSchema);

async function allChildren(kindergartenId: string): Promise<ChildSummary[]> {
  const path = `/kindergartens/${kindergartenId}/children/finance-roster`;
  const first = await get(`${path}?page=1&pageSize=100`, childrenSchema);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) =>
      get(`${path}?page=${index + 2}&pageSize=100`, childrenSchema),
    ),
  );
  return [first, ...rest].flatMap((page) => page.items);
}

async function allInvoicesForMonth(
  kindergartenId: string,
  month: string,
): Promise<InvoiceSummary[]> {
  const path = `/kindergartens/${kindergartenId}/invoices?month=${month}`;
  const first = await get(`${path}&page=1&pageSize=100`, invoicesSchema);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) =>
      get(`${path}&page=${index + 2}&pageSize=100`, invoicesSchema),
    ),
  );
  return [first, ...rest].flatMap((page) => page.items);
}

/** September–June columns for one academic year. */
function monthsForYear(name: string, startsOn?: string | null): string[] {
  const parsed = name.match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
  const start = parsed ? Number(parsed[1]) : Number(startsOn?.slice(0, 4));
  if (!Number.isFinite(start)) return [];
  return [9, 10, 11, 12, 1, 2, 3, 4, 5, 6].map((month) => {
    const year = month >= 9 ? start : start + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

function money(value: number): string {
  return `${new Intl.NumberFormat("mn-MN", { maximumFractionDigits: 0 }).format(value)} ₮`;
}

function activeGroup(child: ChildSummary) {
  return (
    child.enrollments.find((item) => item.status === "ACTIVE")?.group ??
    child.enrollments[0]?.group ??
    null
  );
}

export default function AdminPaymentReportPage() {
  return (
    <RequireRole roles={["ADMIN", "ACCOUNTANT"]}>
      <PaymentReport />
    </RequireRole>
  );
}

function PaymentReport() {
  const { primaryKindergartenId } = useSession();
  const kindergartenId = primaryKindergartenId ?? "";
  const [yearId, setYearId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [search, setSearch] = useState("");

  const years = useQuery({
    queryKey: qk.adminSchoolYears(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/school-years`, yearsSchema),
    enabled: Boolean(kindergartenId),
  });
  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled: Boolean(kindergartenId),
  });
  const children = useQuery({
    queryKey: ["payment-report", "children", kindergartenId],
    queryFn: () => allChildren(kindergartenId),
    enabled: Boolean(kindergartenId),
  });

  const selectedYear =
    years.data?.find((year) => year.id === yearId) ??
    years.data?.find((year) => year.isCurrent) ??
    years.data?.[0];
  const months = useMemo(
    () => (selectedYear ? monthsForYear(selectedYear.name, selectedYear.startsOn) : []),
    [selectedYear],
  );

  const invoiceQueries = useQueries({
    queries: months.map((month) => ({
      queryKey: qk.invoices(kindergartenId, { month, page: 1, pageSize: 100 }),
      queryFn: () => allInvoicesForMonth(kindergartenId, month),
      enabled: Boolean(kindergartenId),
      staleTime: 60_000,
    })),
  });

  const invoicesByChild = useMemo(() => {
    const byChild = new Map<string, Map<string, InvoiceSummary>>();
    for (let index = 0; index < months.length; index += 1) {
      const month = months[index]!;
      for (const invoice of invoiceQueries[index]?.data ?? []) {
        const childMonths = byChild.get(invoice.child.id) ?? new Map<string, InvoiceSummary>();
        childMonths.set(month, invoice);
        byChild.set(invoice.child.id, childMonths);
      }
    }
    return byChild;
  }, [invoiceQueries, months]);

  const term = search.trim().toLocaleLowerCase("mn-MN");
  const rows = (children.data ?? []).filter((child) => {
    const group = activeGroup(child);
    return (
      (!groupId || group?.id === groupId) &&
      (!term || fullName(child).toLocaleLowerCase("mn-MN").includes(term))
    );
  });

  const pending =
    years.isPending ||
    groups.isPending ||
    children.isPending ||
    invoiceQueries.some((query) => query.isPending);
  const failure =
    years.error ??
    groups.error ??
    children.error ??
    invoiceQueries.find((query) => query.isError)?.error;

  const downloadReport = () => {
    const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const header = [
      "№",
      "Суралцагчийн нэр",
      "Төрсөн огноо",
      "Бүлэг",
      "Хөнгөлөлт",
      "Үлдэгдэл",
      ...months.map((month) => `${Number(month.slice(5))} сар`),
    ];
    const lines = rows.map((child, index) => {
      const childInvoices = invoicesByChild.get(child.id);
      const invoices = [...(childInvoices?.values() ?? [])];
      const discounted = invoices.some((invoice) => Number(invoice.discountAmount) > 0);
      const balance = invoices.reduce((sum, invoice) => sum + Number(invoice.balance), 0);
      return [
        index + 1,
        fullName(child),
        child.dateOfBirth.slice(0, 10),
        activeGroup(child)?.name ?? "—",
        discounted ? "Хөнгөлөлттэй" : "Хөнгөлөлтгүй",
        balance,
        ...months.map((month) => Number(childInvoices?.get(month)?.paidAmount ?? 0)),
      ];
    });
    const csv = [header, ...lines].map((line) => line.map(quote).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `tolbor-${selectedYear?.name ?? "report"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Төлбөрийн тайлан"
        actions={
          kindergartenId ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || rows.length === 0}
              onClick={downloadReport}
            >
              <Download size={16} aria-hidden /> Excel
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 rounded-card bg-canvas p-4 sm:grid-cols-2 lg:grid-cols-[400px_400px_minmax(280px,650px)]">
        <Select
          aria-label="Хичээлийн жил"
          value={selectedYear?.id ?? ""}
          onChange={(event) => setYearId(event.target.value)}
        >
          {(years.data ?? []).map((year) => (
            <option key={year.id} value={year.id}>
              {year.name} оны хичээлийн жил
            </option>
          ))}
        </Select>
        <Select
          aria-label="Бүлэг"
          value={groupId}
          onChange={(event) => setGroupId(event.target.value)}
        >
          <option value="">Бүгд</option>
          {(groups.data?.items ?? []).map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
        <SearchField
          label="Суралцагч хайх"
          placeholder="Суралцагч хайх..."
          value={search}
          onChange={setSearch}
        />
      </div>

      {failure ? <ErrorState description={errorMessage(failure)} /> : null}
      {pending ? <LoadingState rows={8} /> : null}
      {!pending && !failure && rows.length === 0 ? (
        <EmptyState
          title="Суралцагч олдсонгүй"
          description="Шүүлтүүрээ өөрчилж дахин оролдоно уу."
        />
      ) : null}

      {!pending && !failure && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-[1660px] border-collapse text-body">
            <caption className="sr-only">Суралцагчдын хичээлийн жилийн төлбөрийн тайлан</caption>
            <thead>
              <tr className="bg-sunken text-muted">
                <th className="px-4 py-4 text-left font-medium">№</th>
                <th className="px-4 py-4 text-left font-medium">Суралцагчийн нэр</th>
                <th className="px-4 py-4 text-left font-medium">Бүлэг</th>
                <th className="px-4 py-4 text-left font-medium">Хөнгөлөлт</th>
                <th className="px-4 py-4 text-right font-medium">Үлдэгдэл</th>
                {months.map((month) => (
                  <th key={month} className="px-4 py-4 text-right font-medium">
                    {Number(month.slice(5))} сар
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((child, index) => {
                const childInvoices = invoicesByChild.get(child.id);
                const invoices = [...(childInvoices?.values() ?? [])];
                const discounted = invoices.some((invoice) => Number(invoice.discountAmount) > 0);
                const balance = invoices.reduce((sum, invoice) => sum + Number(invoice.balance), 0);
                return (
                  <tr
                    key={child.id}
                    className={cn("border-t border-border-soft", index % 2 === 1 && "bg-sunken/70")}
                  >
                    <td className="px-4 py-5 tabular-nums text-muted">{index + 1}</td>
                    <td className="px-4 py-5">
                      <span className="block font-semibold text-ink">{fullName(child)}</span>
                      <span className="mt-1 block text-caption text-faint">
                        {child.dateOfBirth.slice(0, 10)}
                      </span>
                    </td>
                    <td className="px-4 py-5 text-muted">{activeGroup(child)?.name ?? "—"}</td>
                    <td className="px-4 py-5">
                      <span
                        className={cn(
                          "inline-flex rounded-pill border px-2.5 py-1 text-caption font-medium",
                          discounted
                            ? "border-mint-ink/40 text-mint-ink"
                            : "border-border text-muted",
                        )}
                      >
                        {discounted ? "Хөнгөлөлттэй" : "Хөнгөлөлтгүй"}
                      </span>
                    </td>
                    <td className="px-4 py-5 text-right">
                      <span className="inline-flex rounded-pill border border-peach-ink/30 px-2.5 py-1 font-medium text-peach-ink">
                        {money(balance)}
                      </span>
                    </td>
                    {months.map((month) => (
                      <td
                        key={month}
                        className="px-4 py-5 text-right font-semibold tabular-nums text-ink"
                      >
                        {money(Number(childInvoices?.get(month)?.paidAmount ?? 0))}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
