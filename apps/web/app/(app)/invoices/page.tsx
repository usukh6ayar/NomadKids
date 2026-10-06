"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Plus, SlidersHorizontal } from "lucide-react";
import {
  INVOICE_LINE_TYPE_LABEL,
  groupListItemSchema,
  INVOICE_STATUS_LABEL,
  invoiceRegisterSummarySchema,
  invoiceSummarySchema,
  type InvoiceLineType,
  paginated,
  type InvoiceStatus,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { fullName } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { SearchField } from "@/components/ui/search-field";
import { TableShell, Td, Th } from "@/components/ui/table";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { YearMonthSelect } from "@/components/ui/year-month-select";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

const listSchema = paginated(invoiceSummarySchema);
const groupsSchema = paginated(groupListItemSchema);

const LINE_TYPES: InvoiceLineType[] = ["TUITION", "MEAL", "CLUB", "BUS", "EXTRA", "OTHER"];

/** `"126900.00"` → `"126 900₮"` — same formatting `/finance` uses, repeated rather than imported across route boundaries. */
function money(value: string | null): string {
  if (!value) return "0₮";
  const [whole = "0", cents] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return cents && cents !== "00" ? `${grouped}.${cents}₮` : `${grouped}₮`;
}

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Эцэг эхийн нэхэмжлэл — нэмэлт.md §7.
 *
 * ★ The accountant and the administrator, same as `/finance` — §13's role.
 */
export default function InvoicesPage() {
  return (
    <RequireRole roles={["ACCOUNTANT", "ADMIN"]}>
      <Invoices />
    </RequireRole>
  );
}

function Invoices() {
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const [month, setMonth] = useState(thisMonth());
  const [status, setStatus] = useState<InvoiceStatus | "">("");
  const [groupId, setGroupId] = useState("");
  const [lineType, setLineType] = useState<InvoiceLineType | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const pageSize = 25;

  const term = useDebounced(search.trim());
  const filters = {
    month,
    status: status || undefined,
    groupId: groupId || undefined,
    lineType: lineType || undefined,
    q: term || undefined,
    page,
    pageSize,
  };

  /** Everything but the page — what the export downloads and the list filters by. */
  const queryString = useMemo(() => {
    const params = new URLSearchParams({ month });
    if (status) params.set("status", status);
    if (groupId) params.set("groupId", groupId);
    if (lineType) params.set("lineType", lineType);
    if (term) params.set("q", term);
    return params.toString();
  }, [month, status, groupId, lineType, term]);

  const invoices = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.invoices(kindergartenId ?? "", filters),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/invoices?${queryString}&page=${page}&pageSize=${pageSize}`,
        listSchema,
      ),
    placeholderData: (previous) => previous,
  });

  /*
    ★ The month's figures come from their own endpoint — 2026-09-17, the
    client's design.

    Not from `invoices.data`: that is one page of twenty-five, and a header
    stating "126 нэхэмжлэл" from it would change when somebody turned the page.
    `GET …/invoices/summary` counts and sums the whole month in two aggregates.
  */
  const summary = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: ["invoice-summary", kindergartenId, month],
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/invoices/summary?month=${month}`,
        invoiceRegisterSummarySchema,
      ),
    placeholderData: (previous) => previous,
  });

  /*
    `GET /groups`, the same key the shell fills — so this usually reads a warm
    cache rather than a request of its own.
  */
  const groups = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    staleTime: 5 * 60_000,
  });

  const figures = summary.data;
  /*
    What families still owe this month: unpaid, part-paid and overdue alike.
    Summed in cents, so «Үлдэгдэл» is never a float's idea of a sum.
  */
  const unpaidAmount = figures
    ? (["UNPAID", "PARTIALLY_PAID", "OVERDUE"] as const).reduce(
        (cents, key) => cents + Math.round(Number(figures.byStatus[key].outstanding) * 100),
        0,
      ) / 100
    : 0;

  /*
    ★ The tabs are the month's statuses with their counts, and pressing one sets
    the list's filter. «Төлөгдөөгүй» filters on `UNPAID` alone, because the
    API's filter is one status; partially paid keeps its own tab.
  */
  const tabs: { key: InvoiceStatus | ""; label: string; count: number }[] = [
    { key: "", label: "Бүгд", count: figures?.total ?? 0 },
    { key: "PAID", label: "Төлөгдсөн", count: figures?.byStatus.PAID.count ?? 0 },
    { key: "UNPAID", label: "Төлөгдөөгүй", count: figures?.byStatus.UNPAID.count ?? 0 },
    {
      key: "PARTIALLY_PAID",
      label: "Хэсэгчлэн",
      count: figures?.byStatus.PARTIALLY_PAID.count ?? 0,
    },
    { key: "OVERDUE", label: "Хугацаа хэтэрсэн", count: figures?.byStatus.OVERDUE.count ?? 0 },
  ];

  const activeFilters = (groupId ? 1 : 0) + (lineType ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      {/*
        ★ Minimal — client, 2026-10-06 ("маш минимал цэгцтэй … хэт олон
        сонголт"). What went: the lede, the four figure tiles (the status
        chips carry the same counts; the money is one quiet line), the
        «Хуудсанд» size picker (25 a page), and three columns — Бүлэг now sits
        under the child's name, Төлбөрийн төрөл and Үүсгэсэн are on the
        invoice itself. Бүлэг and Төлбөрийн төрөл filters fold behind
        «Шүүлтүүр»; the export is an icon.
      */}
      <PageHeader
        title="Нэхэмжлэл"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <YearMonthSelect
              value={month}
              onValueChange={(value) => {
                setMonth(value);
                setPage(1);
              }}
            />
            <Button asChild size="sm">
              <Link href="/invoices/new">
                <Plus size={16} aria-hidden="true" />
                Нэхэмжлэл үүсгэх
              </Link>
            </Button>
          </div>
        }
      />

      {/*
        ★ Text tabs, not boxed chips — client, 2026-10-06: the five boxes "хэт
        анхаарал татаад байна". The chosen status is ink with a line under it,
        the rest are grey words; the count is a quiet number. A phone scrolls
        the row sideways rather than wrapping it onto two lines.
      */}
      <div
        role="tablist"
        aria-label="Төлөвөөр шүүх"
        className="-mx-4 flex gap-5 overflow-x-auto border-b border-border-soft px-4 sm:mx-0 sm:px-0"
      >
        {tabs.map((tab) => {
          const active = status === tab.key;
          return (
            <button
              key={tab.key || "all"}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setStatus(tab.key);
                setPage(1);
              }}
              className={cn(
                "-mb-px min-h-[40px] shrink-0 whitespace-nowrap border-b-2 text-body transition-colors",
                active
                  ? "border-ink font-semibold text-ink"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {tab.label}
              <span className="ml-1.5 text-caption tabular-nums text-faint">{tab.count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchField
            label="Хүүхдийн нэр, нэхэмжлэх дугаараар хайх"
            placeholder="Нэр, нэхэмжлэх №"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={filtersOpen}
          aria-controls="invoice-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Шүүлтүүр</span>
          {activeFilters > 0 ? <span className="tabular-nums">({activeFilters})</span> : null}
        </Button>
        {/*
          A link, not a fetch — the browser downloads it with the session it
          already has. It carries the screen's own filters, so the file is
          what is on screen.
        */}
        <Button variant="secondary" size="sm" asChild>
          <a
            href={downloadUrl(`/kindergartens/${kindergartenId}/invoices/export?${queryString}`)}
            aria-label="Excel татах"
            title="Excel татах"
          >
            <Download size={16} aria-hidden="true" />
          </a>
        </Button>
      </div>

      {filtersOpen ? (
        <div id="invoice-filters" className="grid gap-2 sm:grid-cols-2">
          <Select
            aria-label="Бүлгээр шүүх"
            value={groupId}
            onChange={(event) => {
              setGroupId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Бүх бүлэг</option>
            {(groups.data?.items ?? []).map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Төлбөрийн төрлөөр шүүх"
            value={lineType}
            onChange={(event) => {
              setLineType(event.target.value as InvoiceLineType | "");
              setPage(1);
            }}
          >
            <option value="">Бүх төлбөрийн төрөл</option>
            {LINE_TYPES.map((type) => (
              <option key={type} value={type}>
                {INVOICE_LINE_TYPE_LABEL[type]}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {figures ? (
        <p className="text-caption text-muted">
          Нийт <span className="font-semibold tabular-nums text-ink">{money(figures.billed)}</span>
          {" · "}
          Үлдэгдэл{" "}
          <span className="font-semibold tabular-nums text-ink">
            {money(unpaidAmount.toFixed(2))}
          </span>
        </p>
      ) : null}

      {invoices.isLoading ? <LoadingState rows={5} /> : null}
      {invoices.isError ? <ErrorState description={errorMessage(invoices.error)} /> : null}

      {invoices.data && invoices.data.items.length === 0 ? (
        /*
          ★ The title alone — client, 2026-10-06, the sentence under it taken
          off. «Нэхэмжлэл үүсгэх» is in the header right above, which is the
          next step the sentence used to spell out (CLAUDE.md §5).
        */
        <EmptyState title="Нэхэмжлэл алга" />
      ) : null}

      {invoices.data && invoices.data.items.length > 0 ? (
        <>
          <TableShell caption="Нэхэмжлэлийн жагсаалт" minWidth="min-w-0">
            <thead>
              <tr>
                <Th className={CELL}>№</Th>
                <Th className={CELL}>Хүүхэд</Th>
                <Th className={CELL} numeric>
                  Дүн
                </Th>
                <Th className={CELL}>Төлөв</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.data.items.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-canvas">
                  <Td className={CELL}>
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="font-medium tabular-nums text-primary hover:underline"
                    >
                      {invoice.number ?? "—"}
                    </Link>
                  </Td>
                  <Td className={CELL}>
                    <span className="block truncate text-ink">{fullName(invoice.child)}</span>
                    {invoice.child.group?.name ? (
                      <span className="block truncate text-muted">{invoice.child.group.name}</span>
                    ) : null}
                  </Td>
                  <Td className={cn(CELL, "font-medium text-ink")} numeric>
                    {money(invoice.totalDue)}
                  </Td>
                  <Td className={CELL}>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 whitespace-nowrap",
                        STATUS_TEXT[invoice.status],
                      )}
                    >
                      <span aria-hidden="true" className="size-1.5 rounded-pill bg-current" />
                      {INVOICE_STATUS_LABEL[invoice.status]}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <ResultCount total={invoices.data.total} noun="нэхэмжлэл" />
            <Pagination
              page={invoices.data.page}
              totalPages={invoices.data.totalPages}
              onPage={setPage}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The register's rows, one tight line each. */
const CELL = "px-2.5 py-2 text-caption";

/** A status as coloured text with a dot — the badge's meaning without its box. */
const STATUS_TEXT: Record<InvoiceStatus, string> = {
  UNPAID: "text-muted",
  PARTIALLY_PAID: "text-peach-ink",
  PAID: "text-mint-ink",
  OVERDUE: "text-danger",
  REFUNDED: "text-sky-ink",
};
