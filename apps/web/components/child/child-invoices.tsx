"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  INVOICE_LINE_TYPE_LABEL,
  INVOICE_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  invoiceSchema,
  paginated,
  type Invoice,
  type InvoiceStatus,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { formatDate, formatMonthLabel, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

const listSchema = paginated(invoiceSchema);
const PAGE_SIZE = 10;

type Tone = "neutral" | "mint" | "sky" | "sun" | "peach" | "primary" | "danger";

const STATUS_TONE: Record<InvoiceStatus, Tone> = {
  UNPAID: "neutral",
  PARTIALLY_PAID: "peach",
  PAID: "mint",
  OVERDUE: "danger",
  REFUNDED: "sky",
};

/** `"126900.00"` → `"126 900₮"` — same formatting `/invoices` uses, repeated rather than imported across route boundaries. */
function money(value: string | null): string {
  if (!value) return "0₮";
  const [whole = "0", cents] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return cents && cents !== "00" ? `${grouped}.${cents}₮` : `${grouped}₮`;
}

/**
 * A guardian's own read of one child's invoices, payment history and balance
 * — нэмэлт.md §7/§10.
 *
 * ★ Read-only, and deliberately so. `InvoicesController`'s write routes
 * (`recordPayment`, `void`, `markRefunded`, …) are `@Roles("ADMIN",
 * "ACCOUNTANT")` — a guardian reaching this screen has no route that would
 * accept a write anyway, so no form is offered here. The one action a
 * guardian genuinely has is paying through QPay, which is its own dialog.
 *
 * ★★ Full invoice shape per row, not a summary-then-detail split.
 * `InvoicesRepository.listForChild`'s own comment: a parent has at most a
 * handful of invoices ever, so returning line items and payment history
 * inline costs nothing and saves a second round trip per invoice.
 */
export function ChildInvoices({ childId }: { childId: string }) {
  const [page, setPage] = useState(1);

  const invoices = useQuery({
    queryKey: qk.childInvoices(childId, page),
    queryFn: () =>
      get(`/children/${childId}/invoices?page=${page}&pageSize=${PAGE_SIZE}`, listSchema),
    placeholderData: (previous) => previous,
  });

  if (invoices.isLoading) return <LoadingState rows={3} />;
  if (invoices.isError) return <ErrorState description={errorMessage(invoices.error)} />;

  const data = invoices.data!;

  if (data.items.length === 0) {
    return (
      <EmptyState
        title="Нэхэмжлэл алга"
        description="Одоогоор энэ хүүхдэд нэхэмжлэл үүсээгүй байна."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ResultCount total={data.total} noun="нэхэмжлэл" />

      <div className="flex flex-col gap-4">
        {data.items.map((invoice) => (
          <InvoiceCard key={invoice.id} invoice={invoice} />
        ))}
      </div>

      <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
    </div>
  );
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className={`text-body font-semibold tabular-nums ${accent ? "text-primary" : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * ★ Read-only, and that is the change of 2026-09-01.
 *
 * A card used to carry a "QPay-ээр төлөх" button. QPay now charges one thing
 * only — the portal access fee (`AccessGate`) — so a family's tuition and meal
 * bills are shown here and settled in cash or by transfer, recorded by the
 * accountant. Nothing on this card is actionable by a parent.
 */
function InvoiceCard({ invoice }: { invoice: Invoice }) {
  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {/* `month` is an ISO date (`DateTime @db.Date`) — sliced to `YYYY-MM`. */}
          <p className="text-body font-semibold text-ink">
            {formatMonthLabel(invoice.month.slice(0, 7))}
          </p>
          <p className="text-caption text-muted">Төлөх хугацаа: {formatDate(invoice.dueDate)}</p>
        </div>
        <Badge tone={STATUS_TONE[invoice.status]}>{INVOICE_STATUS_LABEL[invoice.status]}</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {invoice.lineItems.map((line) => (
          <Row key={line.id} label={INVOICE_LINE_TYPE_LABEL[line.type]} value={money(line.amount)} />
        ))}
        <Row label="Хөнгөлөлт" value={`− ${money(invoice.discountAmount)}`} />
        <Row label="Өмнөх үлдэгдэл" value={money(invoice.previousBalance)} />
      </dl>

      <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-border-soft pt-3">
        <Row label="Нийт төлөх дүн" value={money(invoice.totalDue)} />
        <Row label="Төлсөн дүн" value={money(invoice.paidAmount)} />
        <Row label="Үлдэгдэл" value={money(invoice.balance)} accent />
      </div>

      {invoice.note ? <p className="text-caption text-muted">{invoice.note}</p> : null}

      {invoice.payments.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-border-soft pt-3">
          <p className="text-caption font-medium text-muted">Төлбөрийн түүх</p>
          {invoice.payments.map((payment) => (
            <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={`text-caption ${payment.voidedAt ? "text-muted line-through" : "text-ink"}`}
              >
                {money(payment.amount)} · {PAYMENT_METHOD_LABEL[payment.method]}
                {payment.voidedAt ? " · Цуцалсан" : ""}
              </span>
              <span className="text-caption text-muted">{formatRelative(payment.createdAt)}</span>
            </div>
          ))}
        </div>
      ) : null}

    </Card>
  );
}
