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
 * so in plain words (`NOT_READY`).
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
    .object({
      id: z.string(),
      number: z.string(),
      billingPeriod: z.enum(["term", "year"]),
      startsOn: z.string().nullish(),
      endsOn: z.string().nullish(),
    })
    .nullable(),
  periods: z.array(periodSchema).default([]),
  /** Access suspended for an unpaid period. */
  suspended: z.boolean().default(false),
});

type Period = z.infer<typeof periodSchema>;
type Payment = z.infer<typeof paymentSchema>;
type Contract = NonNullable<z.infer<typeof paymentsSchema>["contract"]>;

/** What is still owed on a period, in whole tögrög. */
function owedOn(period: Period): number {
  return Math.max(0, Math.round(Number(period.amount) - Number(period.paidAmount)));
}

/** Part paid: something came in, not all of it. */
function isPartial(period: Period): boolean {
  return period.status !== "paid" && Number(period.paidAmount) > 0;
}

/*
 * ★ Said plainly, not «удахгүй» — 2026-10-14, the user: what it means and
 * what to do meanwhile.
 */
const NOT_READY =
  "Төлбөр хадгалах хэсэг хараахан бэлэн болоогүй. Одоохондоо данс шалгаад тэмдэглэлдээ бичнэ үү.";
const NO_CONTRACT = "Энэ цэцэрлэг гэрээгүй. Гэрээ «Байгууллагын хүсэлт»-ээр батлагдана.";

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
  const [recording, setRecording] = useState<number | null>(null);
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
          {isNotFound(payments.error) ? NOT_READY : errorMessage(payments.error)}
        </p>
      ) : null}

      {data && !data.contract ? (
        <p className="rounded-control bg-canvas px-3.5 py-3 text-caption text-muted">
          {NO_CONTRACT}
        </p>
      ) : null}

      {data?.contract ? (
        <div className="flex flex-col gap-2">
          <p className="flex flex-wrap items-center gap-2 text-caption text-muted">
            Гэрээ №{data.contract.number} ·{" "}
            {data.contract.billingPeriod === "year" ? "Жилээр" : "Улирлаар"}
            {data.contract.startsOn && data.contract.endsOn
              ? ` · ${formatDate(data.contract.startsOn)} – ${formatDate(data.contract.endsOn)}`
              : ""}
            {data.suspended ? <Badge tone="peach">Эрх түр хаагдсан</Badge> : null}
          </p>
          <div className="table-scroll rounded-control border border-border bg-white">
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
                    onRecord={() => setRecording(period.index)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {recording !== null && data?.contract ? (
        <RecordPaymentDialog
          kindergartenId={kindergartenId}
          contract={data.contract}
          periods={data.periods}
          initial={recording}
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
        {isPartial(period) ? (
          <Badge tone="sun">Хэсэгчлэн төлсөн · {money(String(owedOn(period)))} үлдсэн</Badge>
        ) : (
          <Badge tone={STATUS[period.status].tone}>{STATUS[period.status].label}</Badge>
        )}
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

/**
 * «Төлбөр бүртгэх» — 2026-10-14, the user: which period it is for is chosen
 * here, the contract named on top. Several periods can be paid at once (II and
 * III together); a paid one is shown but cannot be chosen; an amount that
 * does not match is said aloud, and recorded all the same — a part payment
 * leaves the period «Хэсэгчлэн төлсөн».
 */
function RecordPaymentDialog({
  kindergartenId,
  kindergartenName,
  contract,
  periods,
  initial,
  onClose,
}: {
  kindergartenId: string;
  kindergartenName?: string;
  contract: Contract;
  periods: Period[];
  /** The period the dialog opens on. */
  initial: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<number[]>([initial]);
  /** `null` until typed: follows what the chosen periods owe. */
  const [amountTyped, setAmountTyped] = useState<string | null>(null);
  const [paidOn, setPaidOn] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [method, setMethod] = useState<"transfer" | "cash">("transfer");
  const [reference, setReference] = useState("");

  const owed = periods
    .filter((period) => chosen.includes(period.index))
    .reduce((sum, period) => sum + owedOn(period), 0);
  const amount = amountTyped ?? String(owed);
  const entered = /^\d+$/.test(amount.trim()) ? Number(amount) : NaN;
  const gap = Number.isNaN(entered) ? 0 : entered - owed;

  const toggle = (index: number) =>
    setChosen((current) =>
      current.includes(index) ? current.filter((i) => i !== index) : [...current, index].sort(),
    );

  const record = useMutation({
    mutationFn: () =>
      mutate(`/platform/contracts/${contract.id}/payments`, z.unknown(), {
        method: "POST",
        body: {
          periodIndexes: chosen,
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
  const valid = chosen.length > 0 && entered > 0 && Boolean(paidOn);
  const span =
    contract.startsOn && contract.endsOn
      ? ` · ${formatDate(contract.startsOn)} – ${formatDate(contract.endsOn)}`
      : "";

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      busy={record.isPending}
      title={kindergartenName ? `Төлбөр бүртгэх — ${kindergartenName}` : "Төлбөр бүртгэх"}
      description={`Гэрээ №${contract.number} · ${
        contract.billingPeriod === "year" ? "Жилээр" : "Улирлаар"
      }${span}`}
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
                ? NOT_READY
                : errorMessage(record.error)
              : null
          }
        />

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-caption font-semibold text-ink">
            Аль хугацааны төлбөр вэ?
          </legend>
          <ul className="divide-y divide-border-soft rounded-control border border-border bg-white text-caption">
            {periods.map((period) => {
              const paid = period.status === "paid";
              const lastPaid = period.payments.filter((p) => !p.reversedAt).at(-1);
              return (
                <li key={period.index}>
                  <label
                    className={`flex items-center gap-3 px-3 py-2 ${paid ? "text-muted" : "text-ink"}`}
                  >
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={paid || chosen.includes(period.index)}
                      disabled={paid}
                      onChange={() => toggle(period.index)}
                    />
                    <span className="min-w-0 flex-1">{period.label}</span>
                    <span className="tabular-nums">{money(period.amount)}</span>
                    <span className="w-40 text-right">
                      {paid
                        ? `Төлсөн${lastPaid ? ` ${formatDate(lastPaid.paidOn)}` : ""}`
                        : isPartial(period)
                          ? `${money(String(owedOn(period)))} үлдсэн`
                          : `Төлөх: ${formatDate(period.dueOn)}`}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-right text-caption text-muted">
            Сонгосон дүн: <strong className="tabular-nums text-ink">{money(String(owed))}</strong>
          </p>
        </fieldset>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Орсон дүн (₮)"
            error={errors.amount}
            hint={
              gap < 0
                ? `${money(String(-gap))} дутуу — хэсэгчлэн төлсөн гэж бүртгэгдэнэ`
                : gap > 0
                  ? `${money(String(gap))} илүү`
                  : undefined
            }
            required
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmountTyped(event.target.value)}
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
                placeholder={`жишээ: Хаан банк, ${contract.number}`}
              />
            )}
          </Field>
        </div>
      </div>
    </FormDialog>
  );
}

/**
 * «⋯ → Төлбөр бүртгэх» from the kindergartens table — 2026-10-14, the user:
 * record what came into the account without opening the kindergarten. It
 * loads the schedule and opens the first period not yet paid.
 */
export function QuickRecordPayment({
  kindergartenId,
  kindergartenName,
  onClose,
}: {
  kindergartenId: string;
  kindergartenName: string;
  onClose: () => void;
}) {
  const payments = useQuery({
    queryKey: key(kindergartenId),
    queryFn: () => get(`/platform/kindergartens/${kindergartenId}/payments`, paymentsSchema),
    retry: false,
  });
  const next = payments.data?.periods.find((period) => period.status !== "paid");

  if (payments.data?.contract && next) {
    return (
      <RecordPaymentDialog
        kindergartenId={kindergartenId}
        kindergartenName={kindergartenName}
        contract={payments.data.contract}
        periods={payments.data.periods}
        initial={next.index}
        onClose={onClose}
      />
    );
  }

  const message = payments.isLoading
    ? null
    : payments.isError
      ? isNotFound(payments.error)
        ? NOT_READY
        : errorMessage(payments.error)
      : !payments.data?.contract
        ? NO_CONTRACT
        : "Бүх хугацааны төлбөр төлөгдсөн байна.";

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Төлбөр бүртгэх"
      description={kindergartenName}
      footer={
        <Button type="button" size="sm" variant="secondary" onClick={onClose}>
          Хаах
        </Button>
      }
    >
      {message === null ? (
        <LoadingState rows={2} />
      ) : (
        <p className="text-body text-muted">{message}</p>
      )}
    </FormDialog>
  );
}
