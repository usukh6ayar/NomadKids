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
import { formatDate, formatMonthLabel } from "@/lib/format";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

const listSchema = paginated(invoiceSchema);
const PAGE_SIZE = 10;

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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <ResultCount total={data.total} noun="нэхэмжлэл" />
        <p className="text-caption text-muted">Цэцэрлэгийн нягтланд бэлнээр эсвэл дансаар төлнө.</p>
      </div>

      <div className="flex flex-col gap-4">
        {data.items.map((invoice) => (
          <InvoiceCard key={invoice.id} invoice={invoice} />
        ))}
      </div>

      <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
    </div>
  );
}

/** True for "0", "0.00", "", null — a line not worth a row. */
function isZero(value: string | null | undefined): boolean {
  return !value || Number(value) === 0;
}

/** A small status mark, receipt-quiet: a dot and the word. */
const STATUS_DOT: Record<InvoiceStatus, string> = {
  UNPAID: "bg-slate-400",
  PARTIALLY_PAID: "bg-amber-500",
  PAID: "bg-emerald-500",
  OVERDUE: "bg-rose-500",
  REFUNDED: "bg-sky-500",
};

function ReceiptRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className={strong ? "font-semibold text-ink" : "text-muted"}>{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-bold text-ink" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function Dashed() {
  return <hr className="my-2.5 border-0 border-t border-dashed border-slate-300" />;
}

/**
 * One month's bill as a receipt — 2026-10-13, the user: "ebarimt шиг минимал",
 * small type, professional. Who and which month at the top, the lines, the
 * totals right-aligned under a dashed rule, the payments last; zero lines left
 * out. One type size throughout, so nothing shouts.
 *
 * ★ Read-only (2026-09-01). QPay charges only the portal access fee
 * (`AccessGate`); a tuition or meal bill is settled in cash or by transfer and
 * recorded by the accountant, so nothing here is actionable by a parent.
 */
function InvoiceCard({ invoice }: { invoice: Invoice }) {
  return (
    <article className="rounded-card border border-border-soft bg-white px-4 py-4 text-caption leading-5 shadow-sm sm:px-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold uppercase tracking-[0.14em] text-slate-400">
            Нэхэмжлэх
          </p>
          {/* `month` is an ISO date (`DateTime @db.Date`) — sliced to `YYYY-MM`. */}
          <h3 className="text-compact font-bold text-ink">
            {formatMonthLabel(invoice.month.slice(0, 7))}
          </h3>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-border-soft px-2 py-0.5 text-caption font-semibold text-slate-600">
          <span aria-hidden className={`size-1.5 rounded-pill ${STATUS_DOT[invoice.status]}`} />
          {INVOICE_STATUS_LABEL[invoice.status]}
        </span>
      </header>

      <dl className="mt-2">
        <ReceiptRow label="Хүүхэд" value={`${invoice.child.lastName} ${invoice.child.firstName}`} />
        <ReceiptRow label="Дугаар" value={invoice.id.slice(0, 8).toUpperCase()} />
        <ReceiptRow label="Төлөх хугацаа" value={formatDate(invoice.dueDate)} />
      </dl>

      <Dashed />

      <dl>
        {invoice.lineItems.map((line) => (
          <ReceiptRow
            key={line.id}
            label={line.description || INVOICE_LINE_TYPE_LABEL[line.type]}
            value={money(line.amount)}
          />
        ))}
        {isZero(invoice.discountAmount) ? null : (
          <ReceiptRow label="Хөнгөлөлт" value={`− ${money(invoice.discountAmount)}`} />
        )}
        {isZero(invoice.previousBalance) ? null : (
          <ReceiptRow label="Өмнөх үлдэгдэл" value={money(invoice.previousBalance)} />
        )}
      </dl>

      <Dashed />

      <dl>
        <ReceiptRow label="Нийт дүн" value={money(invoice.totalDue)} />
        <ReceiptRow label="Төлсөн дүн" value={money(invoice.paidAmount)} />
        <ReceiptRow label="Үлдэгдэл" value={money(invoice.balance)} strong />
      </dl>

      {invoice.note ? <p className="mt-2 text-muted">{invoice.note}</p> : null}

      {invoice.payments.length > 0 ? (
        <>
          <Dashed />
          <p className="mb-1 text-caption font-semibold uppercase tracking-[0.14em] text-slate-400">
            Төлбөрийн түүх
          </p>
          <ul>
            {invoice.payments.map((payment) => (
              <li
                key={payment.id}
                className={`flex items-baseline justify-between gap-3 py-0.5 ${payment.voidedAt ? "text-muted line-through" : "text-ink"}`}
              >
                <span>
                  {formatDate(payment.createdAt)} · {PAYMENT_METHOD_LABEL[payment.method]}
                  {payment.voidedAt ? " · Цуцалсан" : ""}
                </span>
                <span className="tabular-nums">{money(payment.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}
