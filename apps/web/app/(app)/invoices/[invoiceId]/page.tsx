"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, CreditCard } from "lucide-react";
import {
  INVOICE_ITEM_KIND_LABEL,
  PAYMENT_METHOD_LABEL,
  invoiceDetailSchema,
  type QpayInvoice,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { InvoiceStatusBadge } from "@/components/finance/invoice-card";
import { QpayDialog, useStartQpayPayment } from "@/components/finance/qpay-dialog";
import { money, monthLabel } from "@/components/finance/money";

/**
 * One invoice — `нэмэлт.md` §7, and the paying end of §8.
 *
 * ★ Not under `/children/:id`, because the invoice is the resource and both
 * audiences arrive from different places: a parent from their child's finance
 * list, an accountant from the kindergarten ledger. The API authorizes on the
 * invoice itself — finance staff of the owning kindergarten, or one of the
 * child's guardians, and 404 for everyone else including the child's own
 * teacher (§13). No `RequireRole` here would be able to express that.
 *
 * ★★ The pay button appears only when there is something to pay. An invoice
 * already settled shows its payments instead — offering "Төлөх" on a paid bill
 * is how a family pays twice.
 */
export default function InvoiceDetailPage() {
  const params = useParams<{ invoiceId: string }>();
  const invoiceId = params.invoiceId;
  const router = useRouter();
  const [qpay, setQpay] = useState<QpayInvoice | null>(null);

  const invoice = useQuery({
    queryKey: qk.invoice(invoiceId),
    queryFn: () => get(`/invoices/${invoiceId}`, invoiceDetailSchema),
  });

  const startPayment = useStartQpayPayment(invoiceId);

  if (invoice.isLoading) return <LoadingState rows={5} />;

  if (invoice.isError) {
    return (
      <div className="py-6">
        <ErrorState description={errorMessage(invoice.error)} />
      </div>
    );
  }

  const data = invoice.data!;
  const owes = data.balanceAmount !== "0.00" && !data.balanceAmount.startsWith("-");

  /*
   * ★ A reversal is shown, not hidden — `нэмэлт.md` §14 keeps both the mistake
   * and the correction, and a family that sees a payment disappear with no
   * explanation assumes the system lost it.
   */
  const payments = data.payments.filter((payment) => payment.status !== "PENDING");

  return (
    <div className="flex flex-col gap-6 py-2">
      <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={() => router.back()}>
        <ArrowLeft size={18} />
        Буцах
      </Button>

      <Card pad="roomy">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-h2 font-semibold text-ink">{monthLabel(data.month)}</h1>
            <p className="mt-1 text-caption text-muted">№ {data.number}</p>
          </div>
          <InvoiceStatusBadge status={data.status} />
        </div>

        <dl className="mt-5 grid gap-3">
          <Row label="Нийт төлбөр" value={money(data.totalAmount)} />
          <Row label="Төлсөн" value={money(data.paidAmount)} />
          <Row
            label="Үлдэгдэл"
            value={money(data.balanceAmount)}
            emphasis={owes ? "owing" : "settled"}
          />
          {data.dueDate && (
            <Row label="Төлөх хугацаа" value={new Date(data.dueDate).toLocaleDateString("mn-MN")} />
          )}
        </dl>

        {owes && (
          <Button
            block
            className="mt-5"
            disabled={startPayment.isPending}
            onClick={() =>
              startPayment.mutate(undefined, { onSuccess: (result) => setQpay(result) })
            }
          >
            <CreditCard size={18} aria-hidden="true" />
            {startPayment.isPending ? "Түр хүлээнэ үү…" : "QPay-ээр төлөх"}
          </Button>
        )}
      </Card>

      <section aria-labelledby="lines-heading">
        <SectionHeader id="lines-heading" title="Задаргаа" />
        <Card pad="none" className="overflow-hidden">
          <ul className="divide-y divide-border">
            {data.lines.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-body-sm font-medium text-ink">{line.label}</p>
                  <p className="mt-0.5 text-caption text-muted">
                    {INVOICE_ITEM_KIND_LABEL[line.kind]}
                    {/* `"18.00"` reads as a count, not money — trim it. */}
                    {line.quantity !== "1.00" &&
                      ` · ${line.quantity.replace(/\.00$/, "")} × ${money(line.unitAmount)}`}
                  </p>
                </div>
                <p className="shrink-0 text-body-sm font-medium text-ink">{money(line.amount)}</p>
              </li>
            ))}

            {data.discountAmount !== "0.00" && (
              <li className="flex items-center justify-between gap-4 p-4">
                <p className="text-body-sm text-ink">Хөнгөлөлт</p>
                <p className="text-body-sm font-medium text-mint-ink">
                  −{money(data.discountAmount)}
                </p>
              </li>
            )}

            {data.previousBalance !== "0.00" && (
              <li className="flex items-center justify-between gap-4 p-4">
                <p className="text-body-sm text-ink">Өмнөх үлдэгдэл</p>
                <p className="text-body-sm font-medium text-ink">{money(data.previousBalance)}</p>
              </li>
            )}
          </ul>
        </Card>
      </section>

      {payments.length > 0 && (
        <section aria-labelledby="payments-heading">
          <SectionHeader id="payments-heading" title="Төлбөрийн түүх" />
          <Card pad="none" className="overflow-hidden">
            <ul className="divide-y divide-border">
              {payments.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium text-ink">
                      {payment.isReversal ? "Буцаалт" : PAYMENT_METHOD_LABEL[payment.method]}
                    </p>
                    <p className="mt-0.5 text-caption text-muted">
                      {payment.paidAt
                        ? new Date(payment.paidAt).toLocaleDateString("mn-MN")
                        : new Date(payment.createdAt).toLocaleDateString("mn-MN")}
                      {payment.note && ` · ${payment.note}`}
                    </p>
                  </div>
                  <p
                    className={
                      payment.isReversal
                        ? "shrink-0 text-body-sm font-medium text-muted"
                        : "shrink-0 text-body-sm font-medium text-ink"
                    }
                  >
                    {money(payment.amount)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {qpay && (
        <QpayDialog
          invoiceId={invoiceId}
          childId={data.childId}
          qpay={qpay}
          onClose={() => setQpay(null)}
        />
      )}
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: "owing" | "settled";
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-body-sm text-muted">{label}</dt>
      <dd
        className={
          emphasis === "owing"
            ? "text-body font-semibold text-ink"
            : emphasis === "settled"
              ? "text-body font-semibold text-mint-ink"
              : "text-body-sm font-medium text-ink"
        }
      >
        {value}
      </dd>
    </div>
  );
}
