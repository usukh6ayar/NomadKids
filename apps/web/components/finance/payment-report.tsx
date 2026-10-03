"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import {
  attendanceJournalSchema,
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
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { cents, PrintButton } from "@/components/finance/finance-ui";

/**
 * A child on the finance roster, with ESIS's own enrolment state.
 *
 * ★ 2026-10-01, the client: a Төлөв column after Бүлэг — "Суралцаж байгаа",
 * "Шилжсэн" and the date ESIS recorded it, as ESIS's `students/list` gives them
 * (`programStatusName`, `actionDate`).
 *
 * ★★ The two fields are agreed with the backend and not yet sent. Until the
 * API adds them to `finance-roster` they parse as absent and the column reads
 * "—"; the moment it does, the column fills with no change here. Declared in
 * this file rather than in `@kinder/contracts` because the API has not
 * committed to them yet.
 */
const financeChildSchema = childSummarySchema.extend({
  esisProgramStatus: z.string().nullish(),
  esisActionDate: z.string().nullish(),
});
type FinanceChild = z.infer<typeof financeChildSchema>;

const childrenSchema = paginated(financeChildSchema);
const groupsSchema = paginated(groupListItemSchema);
const invoicesSchema = paginated(invoiceSummarySchema);
const yearsSchema = z.array(schoolYearSchema);

async function allChildren(kindergartenId: string): Promise<FinanceChild[]> {
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

/** The register takes at most 92 days, so a school year is read in windows. */
function windows(from: string, to: string): { from: string; to: string }[] {
  const result: { from: string; to: string }[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const stop = new Date(cursor);
    stop.setUTCDate(stop.getUTCDate() + 91);
    const last = stop < end ? stop : end;
    result.push({ from: cursor.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) });
    cursor.setTime(last.getTime());
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

/**
 * Days each child attended in one window — `PRESENT` and `HALF_DAY`, the two
 * statuses the funding calculation counts as attended.
 */
async function attendedIn(
  kindergartenId: string,
  window: { from: string; to: string },
): Promise<Map<string, number>> {
  const path = `/kindergartens/${kindergartenId}/attendance/register`;
  const query = (page: number) =>
    `${path}?from=${window.from}&to=${window.to}&page=${page}&pageSize=200`;
  const first = await get(query(1), attendanceJournalSchema);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) =>
      get(query(index + 2), attendanceJournalSchema),
    ),
  );
  const days = new Map<string, number>();
  for (const page of [first, ...rest]) {
    for (const row of page.items) {
      const attended = (row.counts.PRESENT ?? 0) + (row.counts.HALF_DAY ?? 0);
      days.set(row.childId, (days.get(row.childId) ?? 0) + attended);
    }
  }
  return days;
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

/**
 * Whole tugrik for display. Callers sum in cents (`cents()`), never in
 * floats — 2026-10-02, CLAUDE.md's money rule — and divide only here.
 */
function money(value: number): string {
  return `${new Intl.NumberFormat("mn-MN", { maximumFractionDigits: 0 }).format(value)} ₮`;
}

/** ESIS's state, drawn blue while studying and red once transferred out. */
function statusTone(status: string): string {
  const value = status.toLocaleLowerCase("mn-MN");
  if (value.includes("шилж")) return "border-danger/40 text-danger";
  if (value.includes("суралцаж")) return "border-primary/40 text-primary";
  return "border-border text-muted";
}

/*
  ★ №, the name and the group stay put while the months scroll — 2026-10-01,
  at the client's request. Fixed widths, because a sticky column's `left` is
  the sum of the widths before it; a background on every frozen cell, because
  a transparent one would let the scrolled months show through; a shadow on
  the last so the edge reads as an edge.
*/
const FROZEN_NO = "sticky left-0 z-10 w-12 min-w-12";
const FROZEN_NAME = "sticky left-12 z-10 w-[220px] min-w-[220px] max-w-[220px]";
const FROZEN_GROUP =
  "sticky left-[268px] z-10 w-[140px] min-w-[140px] max-w-[140px] shadow-[6px_0_6px_-6px_rgb(15_23_42_/_0.25)]";

function activeGroup(child: ChildSummary) {
  return (
    child.enrollments.find((item) => item.status === "ACTIVE")?.group ??
    child.enrollments[0]?.group ??
    null
  );
}

/**
 * Жилийн тайлан — each child's school year of invoices and payments, a month
 * per column.
 *
 * ★ A tab of «Санхүү» since 2026-10-01 (it was the «Төлбөрийн тайлан» page),
 * at the client's request to gather the finance screens into one. Moved
 * whole; `/admin/funding` redirects to `/finance?tab=annual`. The caller gates
 * the roles (ADMIN, ACCOUNTANT), as the page did.
 */
export function PaymentReport() {
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

  /*
    ★ Нийт ирц — 2026-10-02, from the client's reference. Read from the same
    register «Ирц → Жилээр» reads. It is a column, not the report: a register
    that fails to load leaves it reading "—" rather than blanking the money.
  */
  const yearWindows = useMemo(() => {
    if (!selectedYear) return [];
    const start = months[0];
    const from = selectedYear.startsOn?.slice(0, 10) ?? (start ? `${start}-01` : null);
    const to = selectedYear.endsOn?.slice(0, 10) ?? null;
    return from && to ? windows(from, to) : [];
  }, [selectedYear, months]);
  const attendanceQueries = useQueries({
    queries: yearWindows.map((window) => ({
      queryKey: ["payment-report", "attended", kindergartenId, window.from, window.to],
      queryFn: () => attendedIn(kindergartenId, window),
      enabled: Boolean(kindergartenId),
      staleTime: 60_000,
      retry: false,
    })),
  });
  const attendanceReady =
    attendanceQueries.length > 0 && attendanceQueries.every((query) => query.isSuccess);
  const attendedByChild = useMemo(() => {
    const total = new Map<string, number>();
    if (!attendanceReady) return total;
    for (const query of attendanceQueries) {
      for (const [childId, days] of query.data ?? []) {
        total.set(childId, (total.get(childId) ?? 0) + days);
      }
    }
    return total;
  }, [attendanceQueries, attendanceReady]);
  const attended = (childId: string) =>
    attendanceReady ? String(attendedByChild.get(childId) ?? 0) : "—";

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

  /** One child's year: billed, paid and the balance it leaves. */
  const yearOf = (childId: string) => {
    const invoices = [...(invoicesByChild.get(childId)?.values() ?? [])];
    // Summed in cents, then back to tugrik — never floats added together.
    const billedCents = invoices.reduce((sum, invoice) => sum + cents(invoice.totalDue), 0);
    const paidCents = invoices.reduce((sum, invoice) => sum + cents(invoice.paidAmount), 0);
    const balance = invoices.reduce((sum, invoice) => sum + cents(invoice.balance), 0) / 100;
    return {
      invoices,
      billedCents,
      paidCents,
      billed: billedCents / 100,
      paid: paidCents / 100,
      discounted: invoices.some((invoice) => cents(invoice.discountAmount) > 0),
      overpaid: balance < 0 ? -balance : 0,
      owed: balance > 0 ? balance : 0,
    };
  };
  const totals = rows.reduce(
    (sum, child) => {
      const year = yearOf(child.id);
      return { billed: sum.billed + year.billedCents, paid: sum.paid + year.paidCents };
    },
    { billed: 0, paid: 0 },
  );
  // Cents above, tugrik from here on.
  totals.billed /= 100;
  totals.paid /= 100;

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
      "Төлөв",
      "Хөнгөлөлт",
      "Нийт ирц",
      "Нэхэмжилсэн дүн",
      "Төлсөн дүн",
      "Илүү төлөлт",
      "Өр",
      ...months.map((month) => `${Number(month.slice(5))} сар`),
    ];
    const lines = rows.map((child, index) => {
      const childInvoices = invoicesByChild.get(child.id);
      const year = yearOf(child.id);
      return [
        index + 1,
        fullName(child),
        child.dateOfBirth.slice(0, 10),
        activeGroup(child)?.name ?? "—",
        child.esisProgramStatus
          ? [child.esisProgramStatus, child.esisActionDate?.slice(0, 10)].filter(Boolean).join(" ")
          : "—",
        year.discounted ? "Хөнгөлөлттэй" : "Хөнгөлөлтгүй",
        attended(child.id),
        year.billed,
        year.paid,
        year.overpaid,
        year.owed,
        ...months.map((month) => cents(childInvoices?.get(month)?.paidAmount ?? "0") / 100),
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-title font-semibold text-ink">Жилийн тайлан</h2>
        {kindergartenId ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || rows.length === 0}
              onClick={downloadReport}
            >
              <Download size={16} aria-hidden /> Excel
            </Button>
            <PrintButton />
          </div>
        ) : null}
      </div>

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

      {!pending && !failure ? (
        <div className="flex flex-wrap gap-2">
          <span className="rounded-pill border border-primary/40 px-3 py-1 text-caption font-semibold text-primary">
            Нийт суралцагч: {rows.length}
          </span>
          <span className="rounded-pill border border-peach-ink/40 px-3 py-1 text-caption font-semibold text-peach-ink">
            Нэхэмжилсэн: {money(totals.billed)}
          </span>
          <span className="rounded-pill border border-mint-ink/40 px-3 py-1 text-caption font-semibold text-mint-ink">
            Төлсөн: {money(totals.paid)}
          </span>
        </div>
      ) : null}

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
          <table className="w-full min-w-[1900px] border-collapse text-body">
            <caption className="sr-only">Суралцагчдын хичээлийн жилийн төлбөрийн тайлан</caption>
            <thead>
              <tr className="bg-sunken text-muted">
                <th className={cn(FROZEN_NO, "bg-sunken px-3 py-2.5 text-left font-medium")}>№</th>
                <th className={cn(FROZEN_NAME, "bg-sunken px-3 py-2.5 text-left font-medium")}>
                  Суралцагчийн нэр
                </th>
                <th className={cn(FROZEN_GROUP, "bg-sunken px-3 py-2.5 text-left font-medium")}>
                  Бүлэг
                </th>
                <th className="px-3 py-2.5 text-left font-medium">Төлөв</th>
                <th className="px-3 py-2.5 text-left font-medium">Хөнгөлөлт</th>
                <th className="px-3 py-2.5 text-right font-medium">Нийт ирц</th>
                <th className="px-3 py-2.5 text-right font-medium">Нэхэмжилсэн дүн</th>
                <th className="px-3 py-2.5 text-right font-medium">Төлсөн дүн</th>
                <th className="px-3 py-2.5 text-right font-medium">Илүү төлөлт</th>
                <th className="px-3 py-2.5 text-right font-medium">Өр</th>
                {months.map((month) => (
                  <th key={month} className="px-3 py-2.5 text-right font-medium">
                    {Number(month.slice(5))} сар
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((child, index) => {
                const childInvoices = invoicesByChild.get(child.id);
                const year = yearOf(child.id);
                const discounted = year.discounted;
                // Opaque, so the frozen cells hide what scrolls beneath them.
                const rowBg = index % 2 === 1 ? "bg-sunken" : "bg-surface";
                return (
                  <tr key={child.id} className={cn("border-t border-border-soft", rowBg)}>
                    <td className={cn(FROZEN_NO, rowBg, "px-3 py-2 tabular-nums text-muted")}>
                      {index + 1}
                    </td>
                    <td className={cn(FROZEN_NAME, rowBg, "px-3 py-2")}>
                      <span
                        className="block truncate font-semibold text-ink"
                        title={fullName(child)}
                      >
                        {fullName(child)}
                      </span>
                      <span className="mt-0.5 block text-caption text-faint">
                        {child.dateOfBirth.slice(0, 10)}
                      </span>
                    </td>
                    <td className={cn(FROZEN_GROUP, rowBg, "truncate px-3 py-2 text-muted")}>
                      {activeGroup(child)?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {child.esisProgramStatus ? (
                        <>
                          <span
                            className={cn(
                              "inline-flex whitespace-nowrap rounded-pill border px-2 py-0.5 text-caption font-medium",
                              statusTone(child.esisProgramStatus),
                            )}
                          >
                            {child.esisProgramStatus}
                          </span>
                          {child.esisActionDate ? (
                            <span className="mt-0.5 block text-caption tabular-nums text-faint">
                              {child.esisActionDate.slice(0, 10)}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex rounded-pill border px-2 py-0.5 text-caption font-medium",
                          discounted
                            ? "border-mint-ink/40 text-mint-ink"
                            : "border-border text-muted",
                        )}
                      >
                        {discounted ? "Хөнгөлөлттэй" : "Хөнгөлөлтгүй"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-primary">
                      {attended(child.id)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-peach-ink">
                      {money(year.billed)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-mint-ink">
                      {money(year.paid)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">
                      {year.overpaid ? money(year.overpaid) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {year.owed ? (
                        <span className="inline-flex rounded-pill border border-peach-ink/30 px-2 py-0.5 font-medium text-peach-ink">
                          {money(year.owed)}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    {months.map((month) => (
                      <td
                        key={month}
                        className="px-3 py-2 text-right font-semibold tabular-nums text-ink"
                      >
                        {money(cents(childInvoices?.get(month)?.paidAmount ?? "0") / 100)}
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
