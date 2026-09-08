"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  INVOICE_LINE_TYPE_LABEL,
  INVOICE_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  invoiceSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { formatDate, formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

/** `"126900.00"` → `"126 900₮"` — same formatting `/finance` and `/invoices` use. */
function money(value: string | null): string {
  if (!value) return "0₮";
  const [whole = "0", cents] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return cents && cents !== "00" ? `${grouped}.${cents}₮` : `${grouped}₮`;
}

type Invoice = z.infer<typeof invoiceSchema>;

const remindResultSchema = z.object({ sent: z.boolean() });

/**
 * One invoice — нэмэлт.md §7, §8.
 *
 * ★ Everything here reads and writes through the invoice's own detail
 * response, never a client-side computed total. `paidAmount`/`balance`/
 * `status` come back from every mutation already recomputed
 * (`InvoicesRepository.recomputeTotals`) — this page just renders what the
 * server says, the same discipline `child-menu.tsx` and `/finance` follow.
 */
export default function InvoiceDetailPage() {
  return (
    <RequireRole roles={["ACCOUNTANT", "ADMIN"]}>
      <InvoiceDetail />
    </RequireRole>
  );
}

function InvoiceDetail() {
  const params = useParams<{ invoiceId: string }>();
  const invoiceId = params.invoiceId;
  const queryClient = useQueryClient();
  const toast = useToast();

  const invoice = useQuery({
    queryKey: qk.invoice(invoiceId),
    queryFn: () => get(`/invoices/${invoiceId}`, invoiceSchema),
  });

  /**
   * ★ Seeds the cache with the mutation's own response rather than
   * invalidating and re-fetching.
   *
   * Every write here — recording a payment, voiding one, marking a refund —
   * already returns the invoice with `paidAmount`/`balance`/`status`
   * recomputed server-side (`InvoicesRepository.recomputeTotals`). Throwing
   * that response away and asking for the same row again would be a second
   * round trip to learn a fact this response already carries.
   */
  function applyUpdate(next: Invoice) {
    queryClient.setQueryData(qk.invoice(invoiceId), next);
  }

  if (invoice.isPending) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <LoadingState rows={4} />
      </div>
    );
  }

  if (invoice.isError) {
    return (
      <div className="py-6">
        <ErrorState
          title={isNotFound(invoice.error) ? "Олдсонгүй" : "Алдаа гарлаа"}
          description={
            isNotFound(invoice.error) ? "Энэ нэхэмжлэл олдсонгүй." : errorMessage(invoice.error)
          }
          action={
            <Button asChild variant="secondary">
              <Link href="/invoices">Жагсаалт руу буцах</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const data = invoice.data;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <BackButton href="/invoices" />

      <PageHeader
        title={`${data.child.lastName ? `${data.child.lastName} ` : ""}${data.child.firstName}`}
        // `month` comes back as an ISO date (`DateTime @db.Date` — see the
        // model's own comment) — sliced to `YYYY-MM` for `formatMonthLabel`.
        actions={<Badge tone={STATUS_TONE[data.status]}>{INVOICE_STATUS_LABEL[data.status]}</Badge>}
      />

      <Summary invoice={data} onChanged={applyUpdate} toast={toast} />

      <section aria-labelledby="lines-heading">
        <SectionHeader id="lines-heading" title="Мөрүүд" />
        <Card className="divide-y divide-border-soft">
          {data.lineItems.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-body font-medium text-ink">
                  {INVOICE_LINE_TYPE_LABEL[line.type]}
                </p>
                {line.description ? (
                  <p className="text-caption text-muted">{line.description}</p>
                ) : null}
              </div>
              <span className="shrink-0 text-body font-semibold tabular-nums text-ink">
                {money(line.amount)}
              </span>
            </div>
          ))}
        </Card>
      </section>

      <PaymentsSection invoice={data} onChanged={applyUpdate} />
    </div>
  );
}

const STATUS_TONE: Record<Invoice["status"], "neutral" | "mint" | "sky" | "peach" | "danger"> = {
  UNPAID: "neutral",
  PARTIALLY_PAID: "peach",
  PAID: "mint",
  OVERDUE: "danger",
  REFUNDED: "sky",
};

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-caption text-muted">{label}</dt>
      <dd
        className={`text-body font-semibold tabular-nums ${accent ? "text-primary" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Summary({
  invoice,
  onChanged,
  toast,
}: {
  invoice: Invoice;
  onChanged: (next: Invoice) => void;
  toast: ReturnType<typeof useToast>;
}) {
  const refund = useMutation({
    mutationFn: () =>
      mutate(`/invoices/${invoice.id}/refund`, invoiceSchema, { method: "POST", body: {} }),
    onSuccess: (next) => {
      toast.success("Нэхэмжлэлийг буцаалттай гэж тэмдэглэлээ.");
      onChanged(next);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remind = useMutation({
    mutationFn: () =>
      mutate(`/invoices/${invoice.id}/remind`, remindResultSchema, { method: "POST", body: {} }),
    onSuccess: () => toast.success("Эцэг эхэд сануулга илгээлээ."),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const owesMoney = Number(invoice.balance) > 0;

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        <Row label="Үндсэн төлбөр" value={money(invoice.baseAmount)} />
        <Row label="Хоолны төлбөр" value={money(invoice.mealAmount)} />
        <Row label="Нэмэлт төлбөр" value={money(invoice.extraAmount)} />
        <Row label="Хөнгөлөлт" value={`− ${money(invoice.discountAmount)}`} />
        <Row label="Өмнөх үлдэгдэл" value={money(invoice.previousBalance)} />
        <Row label="Төлөх хугацаа" value={formatDate(invoice.dueDate)} />
      </dl>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-border-soft pt-3">
        <Row label="Нийт төлөх дүн" value={money(invoice.totalDue)} />
        <Row label="Төлсөн дүн" value={money(invoice.paidAmount)} />
        <Row label="Үлдэгдэл" value={money(invoice.balance)} accent />
      </div>
      {invoice.note ? <p className="text-caption text-muted">{invoice.note}</p> : null}

      <div className="flex flex-wrap gap-2">
        {invoice.status !== "PAID" && invoice.status !== "REFUNDED" && owesMoney ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={remind.isPending}
            onClick={() => remind.mutate()}
          >
            {remind.isPending ? "Илгээж байна…" : "Сануулга илгээх"}
          </Button>
        ) : null}

        {invoice.status !== "REFUNDED" ? (
          <ConfirmDialog
            trigger={
              <Button variant="secondary" size="sm">
                Буцаалт болгож тэмдэглэх
              </Button>
            }
            title="Нэхэмжлэлийг буцаалт болгож тэмдэглэх үү?"
            description="Энэ нь мөнгө буцаагдсаныг тэмдэглэнэ. Төлбөрийг цуцлах бол доорх төлбөрийн жагсаалтаас цуцална уу."
            confirmLabel="Тийм, буцаалт"
            pendingLabel="Тэмдэглэж байна…"
            onConfirm={() => refund.mutate()}
            pending={refund.isPending}
          />
        ) : null}
      </div>
    </Card>
  );
}

function PaymentsSection({
  invoice,
  onChanged,
}: {
  invoice: Invoice;
  onChanged: (next: Invoice) => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "BANK_TRANSFER" | "OTHER">("CASH");

  const record = useMutation({
    mutationFn: () =>
      mutate(`/invoices/${invoice.id}/payments`, invoiceSchema, {
        method: "POST",
        body: { amount, method },
      }),
    onSuccess: (next) => {
      toast.success("Төлбөр бүртгэгдлээ.");
      setAmount("");
      onChanged(next);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const void_ = useMutation({
    mutationFn: (paymentId: string) =>
      mutate(`/payments/${paymentId}/void`, invoiceSchema, { method: "PATCH", body: {} }),
    onSuccess: (next) => {
      toast.success("Төлбөр цуцлагдаж, буцаалтын мөр үүслээ.");
      onChanged(next);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <section aria-labelledby="payments-heading">
      <SectionHeader id="payments-heading" title="Төлбөрийн түүх" />

      {invoice.payments.length === 0 ? (
        <EmptyState title="Төлбөр алга" description="Доорх маягтаар төлбөр бүртгэнэ үү." />
      ) : (
        <Card className="mb-3 divide-y divide-border-soft">
          {invoice.payments.map((payment) => (
            <div
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-body font-medium ${payment.voidedAt ? "text-muted line-through" : "text-ink"}`}
                  >
                    {money(payment.amount)}
                  </span>
                  <Badge tone="sky">{PAYMENT_METHOD_LABEL[payment.method]}</Badge>
                  {payment.voidedAt ? <Badge tone="neutral">Цуцалсан</Badge> : null}
                  {payment.reversalOfId ? <Badge tone="peach">Буцаалт</Badge> : null}
                </p>
                <p className="text-caption text-muted">
                  {payment.recordedBy ? `${payment.recordedBy.firstName} · ` : ""}
                  {formatRelative(payment.createdAt)}
                  {payment.note ? ` · ${payment.note}` : ""}
                </p>
              </div>
              {!payment.voidedAt && !payment.reversalOfId ? (
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="sm">
                      Цуцлах
                    </Button>
                  }
                  title="Төлбөрийг цуцлах уу?"
                  description="Баталгаажсан төлбөрийг устгахгүй — эсрэг дүнтэй буцаалтын мөр нэмэгдэнэ, анхны мөр харагдсаар байна."
                  confirmLabel="Тийм, цуцлах"
                  pendingLabel="Цуцалж байна…"
                  tone="danger"
                  onConfirm={() => void_.mutate(payment.id)}
                  pending={void_.isPending}
                />
              ) : null}
            </div>
          ))}
        </Card>
      )}

      {invoice.status !== "PAID" && invoice.status !== "REFUNDED" ? (
        <Card pad="roomy" className="flex flex-wrap items-end gap-3">
          <FormError message={record.isError ? errorMessage(record.error) : null} />
          <Field label="Дүн">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-40"
              />
            )}
          </Field>
          <Field label="Хэлбэр">
            {({ id }) => (
              <Select
                id={id}
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
                className="w-45"
              >
                <option value="CASH">Бэлнээр</option>
                <option value="BANK_TRANSFER">Банкны шилжүүлэг</option>
                <option value="OTHER">Бусад</option>
              </Select>
            )}
          </Field>
          <Button disabled={record.isPending || !amount} onClick={() => record.mutate()}>
            {record.isPending ? "Бүртгэж байна…" : "Төлбөр бүртгэх"}
          </Button>
        </Card>
      ) : null}
    </section>
  );
}
