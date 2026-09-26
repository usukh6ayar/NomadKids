"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Download, FileText, Plus } from "lucide-react";
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
import { formatDate, fullName, groupLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDebounced } from "@/lib/use-debounced";
import { ChildAvatar } from "@/components/media/media-image";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { SearchField } from "@/components/ui/search-field";
import { TableShell, Td, Th } from "@/components/ui/table";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { MonthSelect } from "@/components/ui/month-select";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

const listSchema = paginated(invoiceSummarySchema);
const groupsSchema = paginated(groupListItemSchema);

const LINE_TYPES: InvoiceLineType[] = ["TUITION", "MEAL", "CLUB", "BUS", "EXTRA", "OTHER"];

type Tone = "neutral" | "mint" | "sky" | "sun" | "peach" | "primary" | "danger";

const STATUS_TONE: Record<InvoiceStatus, Tone> = {
  UNPAID: "neutral",
  PARTIALLY_PAID: "peach",
  PAID: "mint",
  OVERDUE: "danger",
  REFUNDED: "sky",
};

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
  const [pageSize, setPageSize] = useState(25);

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
  const unpaid = figures
    ? figures.byStatus.UNPAID.count + figures.byStatus.PARTIALLY_PAID.count
    : 0;
  const unpaidAmount = figures
    ? Number(figures.byStatus.UNPAID.outstanding) +
      Number(figures.byStatus.PARTIALLY_PAID.outstanding)
    : 0;
  const share = (count: number) =>
    figures && figures.total > 0 ? Math.round((count / figures.total) * 100) : 0;

  /*
    ★ The tabs are the same four states the tiles count, and pressing one sets
    the list's filter. "Төлөгдөөгүй" covers `UNPAID` and `PARTIALLY_PAID` on
    the tiles; the tab filters on `UNPAID` alone, because the API's filter is
    one status and a tab that silently meant two would not match the figure
    above it. Partially paid keeps its own tab.
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

  return (
    <div className="page-band">
      <PageHeader
        title="Нэхэмжлэл"
        lede="Эцэг эхийн сургалтын төлбөр, хоолны төлбөрийн нэхэмжлэл үүсгэх, удирдах"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <MonthSelect
              aria-label="Сар"
              value={month}
              onValueChange={(value) => {
                setMonth(value);
                setPage(1);
              }}
              className="w-[170px]"
            />
            {/*
              ★ A page, not a dialog — 2026-09-17, the client's second drawing.
              An invoice is a document about to be sent to a family; it is
              checked before it is sent, and a modal with six amount boxes
              showed nothing back. `/invoices/new` puts the form beside a live
              preview of what will be created.
            */}
            <Button asChild>
              <Link href="/invoices/new">
                <Plus size={16} aria-hidden="true" />
                Нэхэмжлэл үүсгэх
              </Link>
            </Button>
          </div>
        }
      />

      {/* ★ Four figures over the month, each with its money under the count. */}
      <section aria-label="Сарын дүн" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <InvoiceStat
          label="Нийт нэхэмжлэл"
          value={figures?.total ?? 0}
          amount={money(figures?.billed ?? "0")}
          tone="sky"
          icon={<FileText size={20} aria-hidden="true" />}
        />
        <InvoiceStat
          label="Төлөгдсөн"
          value={figures?.byStatus.PAID.count ?? 0}
          percent={share(figures?.byStatus.PAID.count ?? 0)}
          amount={money(figures?.byStatus.PAID.billed ?? "0")}
          tone="mint"
          icon={<CheckCircle2 size={20} aria-hidden="true" />}
        />
        <InvoiceStat
          label="Төлөгдөөгүй"
          value={unpaid}
          percent={share(unpaid)}
          amount={money(unpaidAmount.toFixed(2))}
          tone="sun"
          icon={<Clock size={20} aria-hidden="true" />}
        />
        <InvoiceStat
          label="Хугацаа хэтэрсэн"
          value={figures?.byStatus.OVERDUE.count ?? 0}
          percent={share(figures?.byStatus.OVERDUE.count ?? 0)}
          amount={money(figures?.byStatus.OVERDUE.outstanding ?? "0")}
          tone="peach"
          icon={<AlertTriangle size={20} aria-hidden="true" />}
        />
      </section>

      <div className="flex flex-col gap-3">
        <FilterChipRow label="Төлөвөөр шүүх" scroll>
          {tabs.map((tab) => (
            <FilterChip
              key={tab.key || "all"}
              active={status === tab.key}
              onClick={() => {
                setStatus(tab.key);
                setPage(1);
              }}
            >
              {tab.label} ({tab.count})
            </FilterChip>
          ))}
        </FilterChipRow>

        {/*
          ★ Бүлэг and Төлбөрийн төрөл are the design's other two filters —
          2026-09-17. Both are the API's (`groupId`, `lineType`), not a filter
          over the page on screen: a register that narrowed only the 25 rows
          loaded would disagree with the counts above it.
        */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
                {groupLabel(group.name)}
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

          <SearchField
            label="Хүүхдийн нэр, нэхэмжлэх дугаараар хайх"
            placeholder="Хүүхдийн нэр, нэхэмжлэх №-аар хайх…"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />

          {/*
            ★ A link, not a fetch — the browser downloads it with the session
            cookie it already has, and fetching would buffer a spreadsheet in
            memory only to hand it straight back. It carries the screen's own
            filters, so the file is what is on screen.
          */}
          <Button variant="secondary" asChild className="justify-center">
            <a
              href={downloadUrl(`/kindergartens/${kindergartenId}/invoices/export?${queryString}`)}
            >
              <Download size={16} aria-hidden="true" />
              Экспорт
            </a>
          </Button>
        </div>
      </div>

      {invoices.isLoading ? <LoadingState rows={5} /> : null}
      {invoices.isError ? <ErrorState description={errorMessage(invoices.error)} /> : null}

      {invoices.data && invoices.data.items.length === 0 ? (
        <EmptyState
          title="Нэхэмжлэл алга"
          description="Энэ сар, төлөвт тохирох нэхэмжлэл байхгүй байна. Дээрх товчоор шинээр үүсгэнэ үү."
        />
      ) : null}

      {invoices.data && invoices.data.items.length > 0 ? (
        <>
          <TableShell caption="Нэхэмжлэлийн жагсаалт" stacked minWidth="min-w-0">
            <thead>
              <tr>
                <Th>Нэхэмжлэх №</Th>
                <Th>Хүүхэд</Th>
                <Th>Бүлэг</Th>
                <Th>Төлбөрийн төрөл</Th>
                <Th numeric>Дүн</Th>
                <Th>Үүсгэсэн</Th>
                <Th>Төлөв</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.data.items.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-canvas">
                  <Td data-label="Нэхэмжлэх №">
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="font-medium tabular-nums text-primary hover:underline"
                    >
                      {invoice.number ?? "—"}
                    </Link>
                  </Td>
                  <Td data-label="Хүүхэд">
                    <span className="flex min-w-0 items-center gap-2">
                      <ChildAvatar child={invoice.child} size={28} />
                      <span className="truncate">{fullName(invoice.child)}</span>
                    </span>
                  </Td>
                  <Td data-label="Бүлэг">{invoice.child.group?.name ?? "—"}</Td>
                  <Td data-label="Төлбөрийн төрөл">{chargeLabel(invoice)}</Td>
                  <Td data-label="Дүн" numeric>
                    {money(invoice.totalDue)}
                  </Td>
                  <Td data-label="Үүсгэсэн">{formatDate(invoice.createdAt)}</Td>
                  <Td data-label="Төлөв">
                    <Badge tone={STATUS_TONE[invoice.status]}>
                      {INVOICE_STATUS_LABEL[invoice.status]}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <ResultCount total={invoices.data.total} noun="нэхэмжлэл" />
            <label className="flex items-center gap-2 text-caption text-muted">
              Хуудсанд
              <Select
                aria-label="Хуудсанд харуулах тоо"
                value={String(pageSize)}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                className="w-[90px]"
              >
                {[25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <Pagination
            page={invoices.data.page}
            totalPages={invoices.data.totalPages}
            onPage={setPage}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * What this invoice is for, from the amounts it carries.
 *
 * ★ Derived, not stored. `нэмэлт.md` §7 bills six line types and an invoice
 * usually carries two — tuition and meals — so a single "type" column is a
 * summary rather than a field. The list payload deliberately omits the line
 * items (they are the detail screen's), and the three amount columns it does
 * carry answer the question the column asks.
 */
function chargeLabel(invoice: { baseAmount: string; mealAmount: string; extraAmount: string }) {
  const parts: string[] = [];
  if (Number(invoice.baseAmount) > 0) parts.push(INVOICE_LINE_TYPE_LABEL.TUITION);
  if (Number(invoice.mealAmount) > 0) parts.push(INVOICE_LINE_TYPE_LABEL.MEAL);
  if (Number(invoice.extraAmount) > 0) parts.push("Нэмэлт");
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/**
 * One of the month's four figures — the client's 2026-09-17 design.
 *
 * ★ White card, colour on the chip. The drawing tints each box; four pastel
 * panels across the head of a register is a band of paint over the table that
 * is the screen's actual work, and the chip carries the same meaning.
 */
function InvoiceStat({
  label,
  value,
  percent,
  amount,
  tone,
  icon,
}: {
  label: string;
  value: number;
  percent?: number;
  amount: string;
  tone: "sky" | "mint" | "sun" | "peach";
  icon: ReactNode;
}) {
  const chips = {
    sky: "bg-sky text-sky-ink",
    mint: "bg-mint text-mint-ink",
    sun: "bg-sun text-sun-ink",
    peach: "bg-peach text-peach-ink",
  } as const;

  return (
    <Card pad="compact" className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={cn("grid size-10 shrink-0 place-items-center rounded-card", chips[tone])}
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-medium text-muted">{label}</span>
        <span className="mt-0.5 flex items-baseline gap-1.5">
          <span className="text-title font-bold tabular-nums leading-none text-ink">{value}</span>
          {percent !== undefined ? (
            <span className="text-caption tabular-nums text-muted">({percent}%)</span>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-caption tabular-nums text-muted">{amount}</span>
      </span>
    </Card>
  );
}
