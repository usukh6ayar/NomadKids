"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { QpayPayDialog } from "@/components/child/qpay-pay-dialog";
import { Button } from "@/components/ui/button";

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
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const invoices = useQuery({
    queryKey: qk.childInvoices(childId, page),
    queryFn: () =>
      get(`/children/${childId}/invoices?page=${page}&pageSize=${PAGE_SIZE}`, listSchema),
    placeholderData: (previous) => previous,
  });

  /** A QPay payment lands through the webhook/poll, not this tab's own request — refetch rather than patch a cache entry locally. */
  function refetchInvoices() {
    void queryClient.invalidateQueries({ queryKey: ["child", childId, "invoices"] });
  }

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
          <InvoiceCard key={invoice.id} childId={childId} invoice={invoice} onPaid={refetchInvoices} />
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

function InvoiceCard({
  childId,
  invoice,
  onPaid,
}: {
  childId: string;
  invoice: Invoice;
  onPaid: () => void;
}) {
  const payable =
    invoice.status !== "PAID" && invoice.status !== "REFUNDED" && Number(invoice.balance) > 0;

  /*
   * ★ Sticky once true, never reverts.
   *
   * `onPaid` invalidates this card's own invoice query — the moment QPay
   * confirms a payment, `payable` flips false on the very next render, mid-
   * dialog. Unmounting `QpayPayDialog` right then would tear down its "Төлбөр
   * амжилттай хийгдлээ" success state before the guardian ever sees it. An
   * invoice that starts already PAID/REFUNDED never sets this, so nothing pays
   * for a dialog that will never open.
   */
  const [everPayable, setEverPayable] = useState(payable);
  useEffect(() => {
    if (payable) setEverPayable(true);
  }, [payable]);

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

      {everPayable ? (
        <QpayPayDialog
          childId={childId}
          invoiceId={invoice.id}
          onPaid={onPaid}
          trigger={
            <Button size="sm" className={payable ? "self-start" : "hidden"}>
              QPay-ээр төлөх
            </Button>
          }
        />
      ) : null}
    </Card>
  );
}
