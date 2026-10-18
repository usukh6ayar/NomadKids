"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";
import { formatDate, todayLocal } from "@/lib/format";
import { tugrik } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/**
 * «Гэрээний төлбөр» — every kindergarten's contract payments, for the
 * platform operator (the client, 2026-10-18): most kindergartens are state
 * ones and pay against an invoice by bank transfer. The operator records the
 * transfer seen on the statement — the period is paid and counted as income
 * — and keeps the number of the e-receipt issued on ebarimt by hand.
 *
 * ★ `GET /platform/contract-payments`, `POST …/:id/record`,
 * `PATCH …/:id/ebarimt` — superadmin only; anyone else gets 404.
 */
const paymentSchema = z.object({
  id: z.string(),
  kindergarten: z.object({ id: z.string(), name: z.string() }),
  contractNumber: z.string(),
  initial: z.boolean(),
  period: z.enum(["term", "year"]),
  coversFrom: z.string(),
  coversTo: z.string(),
  groupCount: z.number().int(),
  amount: z.string(),
  status: z.enum(["PENDING", "PAID"]),
  method: z.enum(["QPAY", "BANK_TRANSFER"]).nullable(),
  paidAt: z.string().nullable(),
  reference: z.string().nullable(),
  ebarimtNumber: z.string().nullable(),
});
type Payment = z.infer<typeof paymentSchema>;

const listSchema = z.object({
  items: z.array(paymentSchema),
  total: z.number().int(),
});

type Filter = "PENDING" | "PAID" | "ebarimt";
const FILTERS: ReadonlyArray<readonly [Filter, string]> = [
  ["PENDING", "Хүлээгдэж буй"],
  ["PAID", "Төлөгдсөн"],
  ["ebarimt", "ebarimt гаргаагүй"],
];

const queryKey = (filter: Filter) => ["platform", "contract-payments", filter] as const;

export default function PlatformContractPaymentsPage() {
  return (
    <RequireSuperAdmin>
      <ContractPayments />
    </RequireSuperAdmin>
  );
}

function ContractPayments() {
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [recording, setRecording] = useState<Payment | null>(null);
  const [receipting, setReceipting] = useState<Payment | null>(null);

  const list = useQuery({
    queryKey: queryKey(filter),
    queryFn: () =>
      get(
        `/platform/contract-payments?${filter === "ebarimt" ? "ebarimt=missing" : `status=${filter}`}&page=1&pageSize=100`,
        listSchema,
      ),
  });

  return (
    <div className="flex flex-col gap-6 pb-8">
      <PlatformPageHeading
        title="Гэрээний төлбөр"
        lede="Цэцэрлэгүүдийн гэрээний төлбөр — дансаар орсныг бүртгэж, ebarimt-ын дугаарыг хадгална."
        mark={<Landmark />}
      />

      <div
        role="radiogroup"
        aria-label="Шүүлтүүр"
        className="grid max-w-[520px] grid-cols-3 gap-1 rounded-pill bg-canvas p-1"
      >
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "min-h-11 rounded-pill px-3 text-body font-semibold transition-colors",
              filter === value ? "bg-primary text-white shadow-sm" : "text-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {list.isLoading ? <LoadingState rows={3} /> : null}
      {list.isError ? <ErrorState description={errorMessage(list.error)} /> : null}
      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          title="Төлбөр алга"
          description={
            filter === "PENDING"
              ? "Захирал гэрээгээ баталгаажуулах эсвэл нэхэмжлэх үүсгэхэд энд харагдана."
              : "Шүүлтүүрээ өөрчилж үзнэ үү."
          }
        />
      ) : null}

      <ul className="flex flex-col gap-3">
        {list.data?.items.map((payment) => (
          <li key={payment.id}>
            <PaymentCard
              payment={payment}
              onRecord={() => setRecording(payment)}
              onEbarimt={() => setReceipting(payment)}
            />
          </li>
        ))}
      </ul>

      {recording ? (
        <RecordTransferDialog payment={recording} onClose={() => setRecording(null)} />
      ) : null}
      {receipting ? (
        <EbarimtDialog payment={receipting} onClose={() => setReceipting(null)} />
      ) : null}
    </div>
  );
}

function PaymentCard({
  payment,
  onRecord,
  onEbarimt,
}: {
  payment: Payment;
  onRecord: () => void;
  onEbarimt: () => void;
}) {
  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lead font-semibold text-ink">{payment.kindergarten.name}</p>
          <p className="text-caption text-muted">
            №{payment.contractNumber} · {payment.initial ? "Гэрээний эхний төлбөр" : "Сунгалт"} ·{" "}
            {formatDate(payment.coversFrom)} – {formatDate(payment.coversTo)} · {payment.groupCount}{" "}
            бүлэг
          </p>
        </div>
        <p className="text-title font-semibold text-ink">{tugrik(Number(payment.amount))}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {payment.status === "PENDING" ? (
          <Badge tone="sun">Хүлээгдэж буй</Badge>
        ) : (
          <Badge tone="mint">
            Төлөгдсөн
            {payment.paidAt ? ` · ${formatDate(payment.paidAt.slice(0, 10))}` : ""}
            {payment.method === "QPAY"
              ? " · QPay"
              : payment.method === "BANK_TRANSFER"
                ? " · Данс"
                : ""}
          </Badge>
        )}
        {payment.status === "PAID" ? (
          payment.ebarimtNumber ? (
            <Badge tone="neutral">ebarimt: {payment.ebarimtNumber}</Badge>
          ) : (
            <Badge tone="danger">ebarimt гаргаагүй</Badge>
          )
        ) : null}
        {payment.reference ? (
          <span className="text-caption text-muted">Гүйлгээний утга: {payment.reference}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {payment.status === "PENDING" ? (
          <Button size="sm" onClick={onRecord}>
            Дансаар хүлээн авсан
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={onEbarimt}>
            {payment.ebarimtNumber ? "ebarimt засах" : "ebarimt оруулах"}
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * «Дансаар хүлээн авсан» — the transfer seen on the statement. The amount is
 * the row's unless the statement says otherwise; the server settles the
 * period once and counts it as income.
 */
function RecordTransferDialog({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState(payment.amount.replace(/\.00$/, ""));
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [reference, setReference] = useState("");
  const [ebarimtNumber, setEbarimtNumber] = useState("");

  const record = useMutation({
    mutationFn: () =>
      mutate(`/platform/contract-payments/${payment.id}/record`, z.unknown(), {
        method: "POST",
        body: {
          amount: amount.trim(),
          paidOn,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(ebarimtNumber.trim() ? { ebarimtNumber: ebarimtNumber.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Төлбөр бүртгэгдлээ.");
      void queryClient.invalidateQueries({ queryKey: ["platform", "contract-payments"] });
      onClose();
    },
  });

  const errors = fieldErrors(record.error);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!record.isPending) record.mutate();
  }

  return (
    <Modal label="Дансаар хүлээн авсан" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <ModalHeading title="Дансаар хүлээн авсан" onClose={onClose} />
        <p className="text-body text-muted">
          {payment.kindergarten.name} · №{payment.contractNumber}
        </p>
        <FormError message={record.isError ? errorMessage(record.error) : null} />

        <Field label="Хүлээн авсан дүн" error={errors.amount} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </Field>
        <Field label="Орсон огноо" error={errors.paidOn} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="date"
              max={todayLocal()}
              value={paidOn}
              onChange={(event) => setPaidOn(event.target.value)}
            />
          )}
        </Field>
        <Field label="Гүйлгээний утга" error={errors.reference}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder={`${payment.contractNumber} ${payment.kindergarten.name}`}
            />
          )}
        </Field>
        <Field label="ebarimt-ын дугаар" error={errors.ebarimtNumber} hint="Дараа нь оруулж болно.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={ebarimtNumber}
              onChange={(event) => setEbarimtNumber(event.target.value)}
            />
          )}
        </Field>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button type="submit" disabled={record.isPending}>
            {record.isPending ? "Бүртгэж байна…" : "Бүртгэх"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={record.isPending}>
            Болих
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The e-receipt's number, issued by hand on ebarimt. */
function EbarimtDialog({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [ebarimtNumber, setEbarimtNumber] = useState(payment.ebarimtNumber ?? "");

  const save = useMutation({
    mutationFn: () =>
      mutate(`/platform/contract-payments/${payment.id}/ebarimt`, z.unknown(), {
        method: "PATCH",
        body: { ebarimtNumber: ebarimtNumber.trim() || null },
      }),
    onSuccess: () => {
      toast.success("ebarimt-ын дугаар хадгалагдлаа.");
      void queryClient.invalidateQueries({ queryKey: ["platform", "contract-payments"] });
      onClose();
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!save.isPending) save.mutate();
  }

  return (
    <Modal label="ebarimt-ын дугаар" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <ModalHeading title="ebarimt-ын дугаар" onClose={onClose} />
        <p className="text-body text-muted">
          {payment.kindergarten.name} · {tugrik(Number(payment.amount))}
        </p>
        <FormError message={save.isError ? errorMessage(save.error) : null} />
        <Field label="ebarimt-ын дугаар" error={fieldErrors(save.error).ebarimtNumber}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={ebarimtNumber}
              onChange={(event) => setEbarimtNumber(event.target.value)}
              autoFocus
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
            Болих
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const backdrop = useBackdropDismiss(onClose);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      {...backdrop}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[460px] rounded-card border border-border bg-surface p-5">
        {children}
      </div>
    </div>
  );
}

function ModalHeading({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <h2 className="text-title font-semibold text-ink">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Хаах"
        className="grid size-11 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
