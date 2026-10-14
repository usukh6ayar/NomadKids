"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Undo2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors, isNotFound } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

/*
 * ★ A kindergarten's payments to the platform — 2026-10-14, the user:
 *
 *   - a contract is a school year, paid by the year or by the term;
 *   - each period is due the day it begins (09.01, 12.01, 03.01) — the 14-day
 *     reminder runs up to it, and unpaid on it, access is suspended;
 *   - the operator alone records what came in, by transfer or in cash. Never
 *     QPay (CLAUDE.md §7), and a wrong entry is reversed, never deleted
 *     (CLAUDE.md §3.2).
 *
 * Built against routes asked of the admin; until they exist the section says
 * «удахгүй».
 */
const paymentSchema = z.object({
  id: z.string(),
  amount: z.string(),
  paidOn: z.string(),
  method: z.enum(["transfer", "cash"]),
  reference: z.string().nullish(),
  /** Set on a payment that a reversal cancelled. */
  reversedAt: z.string().nullish(),
});

const periodSchema = z.object({
  index: z.number().int(),
  label: z.string(),
  dueOn: z.string(),
  amount: z.string(),
  paidAmount: z.string(),
  status: z.enum(["paid", "due", "overdue", "upcoming"]),
  payments: z.array(paymentSchema).default([]),
});

const paymentsSchema = z.object({
  contract: z
    .object({ id: z.string(), number: z.string(), billingPeriod: z.enum(["term", "year"]) })
    .nullable(),
  periods: z.array(periodSchema).default([]),
  /** Access suspended for an unpaid period. */
  suspended: z.boolean().default(false),
});

type Period = z.infer<typeof periodSchema>;
type Payment = z.infer<typeof paymentSchema>;

const STATUS: Record<
  Period["status"],
  { label: string; tone: "mint" | "sun" | "peach" | "neutral" }
> = {
  paid: { label: "Төлсөн", tone: "mint" },
  due: { label: "Төлөх хугацаа ойртсон", tone: "sun" },
  overdue: { label: "Хоцорсон", tone: "peach" },
  upcoming: { label: "Хүлээгдэж буй", tone: "neutral" },
};

const METHOD_LABEL = { transfer: "Шилжүүлэг", cash: "Бэлэн" } as const;

/** «1 400 000₮», from the decimal string. */
function money(value: string): string {
  const [whole = "0"] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}₮`;
}

const key = (kindergartenId: string) => ["platform", "kindergarten-payments", kindergartenId];

export function KindergartenPayments({ kindergartenId }: { kindergartenId: string }) {
  const [recording, setRecording] = useState<Period | null>(null);
  const payments = useQuery({
    queryKey: key(kindergartenId),
    queryFn: () => get(`/platform/kindergartens/${kindergartenId}/payments`, paymentsSchema),
    retry: false,
  });
  const data = payments.data;

  return (
    <section aria-labelledby="platform-payments-heading">
      <SectionHeader
        id="platform-payments-heading"
        title="Төлбөр"
        lede="Гэрээний хуваарь. Хугацаа нь улирал, жил эхлэх өдөр; төлөөгүй бол тэр өдрөөс эрх түр хаагдана."
      />

      {payments.isLoading ? <LoadingState rows={3} /> : null}
      {payments.isError ? (
        <p className="rounded-control bg-canvas px-3.5 py-3 text-caption text-muted">
          {isNotFound(payments.error)
            ? "Төлбөрийн бүртгэл удахгүй нээгдэнэ."
            : errorMessage(payments.error)}
        </p>
      ) : null}

      {data && !data.contract ? (
        <p className="rounded-control bg-canvas px-3.5 py-3 text-caption text-muted">
          Гэрээ байхгүй тул төлбөрийн хуваарь алга. Гэрээ «Байгууллагын хүсэлт»-ээр батлагдана.
        </p>
      ) : null}

      {data?.contract ? (
        <div className="flex flex-col gap-2">
          <p className="flex flex-wrap items-center gap-2 text-caption text-muted">
            Гэрээ №{data.contract.number} ·{" "}
            {data.contract.billingPeriod === "year" ? "Жилээр" : "Улирлаар"}
            {data.suspended ? <Badge tone="peach">Эрх түр хаагдсан</Badge> : null}
          </p>
          <div className="overflow-x-auto rounded-control border border-border bg-white">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-caption">
              <thead className="bg-slate-50 text-muted">
                <tr className="[&>th]:whitespace-nowrap [&>th]:border-b [&>th]:border-r [&>th]:border-border [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold [&>th:last-child]:border-r-0">
                  <th scope="col">Хугацаа</th>
                  <th scope="col">Төлөх өдөр</th>
                  <th scope="col" className="text-right">
                    Дүн
                  </th>
                  <th scope="col" className="text-right">
                    Төлсөн
                  </th>
                  <th scope="col">Төлөв</th>
                  <th scope="col">Гүйлгээ</th>
                  <th scope="col">
                    <span className="sr-only">Үйлдэл</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.periods.map((period) => (
                  <PeriodRow
                    key={period.index}
                    period={period}
                    kindergartenId={kindergartenId}
                    onRecord={() => setRecording(period)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {recording && data?.contract ? (
        <RecordPaymentDialog
          kindergartenId={kindergartenId}
          contractId={data.contract.id}
          period={recording}
          onClose={() => setRecording(null)}
        />
      ) : null}
    </section>
  );
}

function PeriodRow({
  period,
  kindergartenId,
  onRecord,
}: {
  period: Period;
  kindergartenId: string;
  onRecord: () => void;
}) {
  const cell = "border-b border-r border-border-soft px-3 py-2 align-top last:border-r-0";
  const live = period.payments.filter((payment) => !payment.reversedAt);
  return (
    <tr>
      <td className={`${cell} font-semibold text-ink`}>{period.label}</td>
      <td className={`${cell} whitespace-nowrap tabular-nums`}>{formatDate(period.dueOn)}</td>
      <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>
        {money(period.amount)}
      </td>
      <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>
        {money(period.paidAmount)}
      </td>
      <td className={cell}>
        <Badge tone={STATUS[period.status].tone}>{STATUS[period.status].label}</Badge>
      </td>
      <td className={cell}>
        {period.payments.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {period.payments.map((payment) => (
              <PaymentLine key={payment.id} payment={payment} kindergartenId={kindergartenId} />
            ))}
          </ul>
        )}
      </td>
      <td className={`${cell} text-right`}>
        {period.status !== "paid" || live.length === 0 ? (
          <Button size="sm" variant="secondary" onClick={onRecord}>
            <Plus size={14} aria-hidden="true" />
            Төлбөр бүртгэх
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

/** One payment, with «Буцаах» — a reversal, never a deletion. */
function PaymentLine({ payment, kindergartenId }: { payment: Payment; kindergartenId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const reverse = useMutation({
    mutationFn: () =>
      mutate(`/platform/payments/${payment.id}/reverse`, z.unknown(), {
        method: "POST",
        body: reason.trim() ? { reason: reason.trim() } : {},
      }),
    onSuccess: () => {
      toast.success("Төлбөрийг буцаалаа.");
      void queryClient.invalidateQueries({ queryKey: key(kindergartenId) });
    },
    onError: (error) =>
      toast.error(
        isNotFound(error) ? "Төлбөр буцаах боломж удахгүй нээгдэнэ." : errorMessage(error),
      ),
  });

  return (
    <li className="flex flex-wrap items-center gap-x-2">
      <span className={payment.reversedAt ? "text-muted line-through" : "text-ink"}>
        {formatDate(payment.paidOn)} · {money(payment.amount)} · {METHOD_LABEL[payment.method]}
        {payment.reference ? ` · ${payment.reference}` : ""}
      </span>
      {payment.reversedAt ? (
        <span className="text-muted">Буцаасан</span>
      ) : (
        <ConfirmDialog
          trigger={
            <button type="button" className="inline-flex items-center gap-1 text-danger">
              <Undo2 size={12} aria-hidden="true" />
              Буцаах
            </button>
          }
          title="Төлбөрийг буцаах уу?"
          description={`${formatDate(payment.paidOn)} · ${money(payment.amount)}. Устгахгүй — буцаалтын мөр бичигдэнэ.`}
          body={
            <Input
              aria-label="Буцаах шалтгаан"
              placeholder="Шалтгаан (заавал биш), жишээ: буруу цэцэрлэгт бүртгэсэн"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          }
          confirmLabel="Буцаах"
          tone="danger"
          pending={reverse.isPending}
          onConfirm={() => reverse.mutate()}
        />
      )}
    </li>
  );
}

function RecordPaymentDialog({
  kindergartenId,
  contractId,
  period,
  onClose,
}: {
  kindergartenId: string;
  contractId: string;
  period: Period;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const owed = Math.max(0, Number(period.amount) - Number(period.paidAmount));
  const [amount, setAmount] = useState(String(owed));
  const [paidOn, setPaidOn] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [method, setMethod] = useState<"transfer" | "cash">("transfer");
  const [reference, setReference] = useState("");

  const record = useMutation({
    mutationFn: () =>
      mutate(`/platform/contracts/${contractId}/payments`, z.unknown(), {
        method: "POST",
        body: {
          periodIndex: period.index,
          amount: amount.trim(),
          paidOn,
          method,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Төлбөр бүртгэгдлээ.");
      void queryClient.invalidateQueries({ queryKey: key(kindergartenId) });
      onClose();
    },
  });
  const errors = fieldErrors(record.error);
  const valid = /^\d+$/.test(amount.trim()) && Number(amount) > 0 && Boolean(paidOn);

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      busy={record.isPending}
      title="Төлбөр бүртгэх"
      description={`${period.label} · ${money(period.amount)} · төлөх өдөр ${formatDate(period.dueOn)}`}
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Болих
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!valid || record.isPending}
            onClick={() => record.mutate()}
          >
            {record.isPending ? "Бүртгэж байна…" : "Бүртгэх"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormError
          message={
            record.isError && Object.keys(errors).length === 0
              ? isNotFound(record.error)
                ? "Төлбөр бүртгэх боломж удахгүй нээгдэнэ."
                : errorMessage(record.error)
              : null
          }
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Дүн (₮)" error={errors.amount} required>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            )}
          </Field>
          <Field label="Төлсөн огноо" error={errors.paidOn} required>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                type="date"
                value={paidOn}
                onChange={(event) => setPaidOn(event.target.value)}
              />
            )}
          </Field>
          <Field label="Хэлбэр" error={errors.method} required>
            {({ id, invalid }) => (
              <Select
                id={id}
                invalid={invalid}
                value={method}
                onChange={(event) => setMethod(event.target.value as "transfer" | "cash")}
              >
                <option value="transfer">Шилжүүлэг</option>
                <option value="cash">Бэлэн</option>
              </Select>
            )}
          </Field>
          <Field label="Гүйлгээний утга" error={errors.reference} hint="Заавал биш">
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="жишээ: Гэрээ NK-2026-000001"
              />
            )}
          </Field>
        </div>
      </div>
    </FormDialog>
  );
}
