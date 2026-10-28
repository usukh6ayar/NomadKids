"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { paginated, platformKindergartenSchema } from "@kinder/contracts";
import { CalendarPlus, Landmark, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
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
 * `PATCH …/:id/ebarimt`, `GET|POST …/extension` — superadmin only; anyone
 * else gets 404.
 *
 * ★ «Эрх сунгах» (the user, 2026-10-28): a kindergarten that paid by
 * transfer without opening «Үйлчилгээний эрх» is recorded from the
 * kindergarten itself — the end comes suggested and may be moved, with a note.
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
  note: z.string().nullable().optional(),
});
type Payment = z.infer<typeof paymentSchema>;

const kindergartensSchema = paginated(platformKindergartenSchema);

const optionSchema = z.object({
  coversFrom: z.string(),
  coversTo: z.string(),
  perGroup: z.string(),
  amount: z.string(),
  label: z.string(),
});

const extensionSchema = z.object({
  kindergarten: z.object({ id: z.string(), name: z.string() }),
  contract: z.object({ id: z.string(), number: z.string(), endsOn: z.string() }).nullable(),
  awaitingSignature: z.boolean(),
  registeredGroups: z.number().int(),
  initialDue: z
    .object({
      id: z.string(),
      period: z.enum(["TERM", "YEAR"]),
      coversFrom: z.string(),
      coversTo: z.string(),
      amount: z.string(),
    })
    .nullable(),
  groupCount: z.number().int().nullable(),
  options: z.object({ TERM: optionSchema.nullable(), YEAR: optionSchema.nullable() }).nullable(),
});

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
  const [extending, setExtending] = useState(false);

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

      <div>
        <Button onClick={() => setExtending(true)}>
          <CalendarPlus size={18} aria-hidden="true" />
          Эрх сунгах
        </Button>
      </div>

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
      {extending ? <ExtensionDialog onClose={() => setExtending(false)} /> : null}
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
      {payment.note ? (
        <p className="whitespace-pre-line text-body text-muted">Тэмдэглэл: {payment.note}</p>
      ) : null}

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

/**
 * «Эрх сунгах» — a transfer recorded from the kindergarten itself. The
 * server suggests the end and the amount (the first period still owed, or
 * the term or year a renewal covers); the operator may change both and adds
 * a note. Settled like QPay, so «Орлого» counts it.
 */
function ExtensionDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [kindergartenId, setKindergartenId] = useState("");
  const [period, setPeriod] = useState<"TERM" | "YEAR">("TERM");
  const [groups, setGroups] = useState("");
  const [amount, setAmount] = useState<string | null>(null);
  const [coversTo, setCoversTo] = useState<string | null>(null);
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [ebarimtNumber, setEbarimtNumber] = useState("");

  const kindergartens = useQuery({
    queryKey: ["platform", "kindergartens", "extension-targets"],
    queryFn: () => get("/platform/kindergartens?page=1&pageSize=100", kindergartensSchema),
  });
  const groupCount = /^\d+$/.test(groups) && Number(groups) > 0 ? Number(groups) : null;
  const preview = useQuery({
    queryKey: ["platform", "contract-payments", "extension", kindergartenId, groupCount],
    queryFn: () =>
      get(
        `/platform/contract-payments/extension?kindergartenId=${kindergartenId}${groupCount ? `&groups=${groupCount}` : ""}`,
        extensionSchema,
      ),
    enabled: Boolean(kindergartenId),
    retry: false,
  });

  const view = preview.data;
  const suggestion = view?.initialDue ?? view?.options?.[period] ?? null;
  const shownAmount = amount ?? suggestion?.amount.replace(/\.00$/, "") ?? "";
  const shownCoversTo = coversTo ?? suggestion?.coversTo ?? "";
  const shownGroups = groups || (view?.groupCount ? String(view.groupCount) : "");
  const blocked = view
    ? !view.contract
      ? view.awaitingSignature
        ? "Эрхлэгч гэрээг хараахан хүлээн аваагүй байна. «Үйлчилгээний эрх»-ээс гэрээгээ хүлээн авсны дараа бүртгэнэ."
        : "Энэ цэцэрлэгт идэвхтэй гэрээ алга."
      : !suggestion
        ? "Энэ хичээлийн жилд жилээр төлөх сар үлдээгүй. Улирлаар сунгана уу."
        : null
    : null;

  const record = useMutation({
    mutationFn: () =>
      mutate("/platform/contract-payments/extension", z.unknown(), {
        method: "POST",
        body: {
          kindergartenId,
          period: view?.initialDue?.period ?? period,
          groupCount: Number(shownGroups),
          amount: shownAmount.trim(),
          paidOn,
          coversTo: shownCoversTo,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(ebarimtNumber.trim() ? { ebarimtNumber: ebarimtNumber.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Эрх сунгагдаж, төлбөр орлогод бүртгэгдлээ.");
      void queryClient.invalidateQueries({ queryKey: ["platform"] });
      onClose();
    },
  });
  const errors = fieldErrors(record.error);

  function resetSuggested() {
    setAmount(null);
    setCoversTo(null);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!record.isPending && view?.contract && suggestion) record.mutate();
  }

  return (
    <Modal label="Эрх сунгах" onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <ModalHeading title="Эрх сунгах" onClose={onClose} />
        <p className="text-body text-muted">
          Дансаар орсон гэрээний төлбөрийг цэцэрлэг дээр нь бүртгэж, эрхийг сунгана.
        </p>
        <FormError
          message={
            record.isError
              ? errorMessage(record.error)
              : preview.isError
                ? errorMessage(preview.error)
                : null
          }
        />

        <Field label="Цэцэрлэг" required>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={kindergartenId}
              onChange={(event) => {
                setKindergartenId(event.target.value);
                setGroups("");
                resetSuggested();
              }}
            >
              <option value="">
                {kindergartens.isLoading ? "Ачаалж байна…" : "Цэцэрлэг сонгоно уу"}
              </option>
              {(kindergartens.data?.items ?? [])
                .filter((kg) => kg.isActive)
                .sort((x, y) => x.name.localeCompare(y.name, "mn"))
                .map((kg) => (
                  <option key={kg.id} value={kg.id}>
                    {kg.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>

        {kindergartenId && preview.isLoading ? <LoadingState rows={2} /> : null}
        {blocked ? <FormError message={blocked} /> : null}

        {view?.contract && suggestion ? (
          <>
            <p className="text-body text-ink">
              №{view.contract.number} · одоогийн эрх{" "}
              <strong>{formatDate(view.contract.endsOn)}</strong> хүртэл
            </p>
            {view.initialDue ? (
              <p className="text-body text-muted">
                Гэрээний эхний төлбөр хүлээгдэж байна — энэ бүртгэл түүнийг төлнө.
              </p>
            ) : (
              <div
                role="radiogroup"
                aria-label="Хугацаа"
                className="grid grid-cols-2 gap-1 rounded-pill bg-canvas p-1"
              >
                {(
                  [
                    ["TERM", "Улирал"],
                    ["YEAR", "Хичээлийн жил"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={period === value}
                    disabled={!view.options?.[value]}
                    onClick={() => {
                      setPeriod(value);
                      resetSuggested();
                    }}
                    className={cn(
                      "min-h-11 rounded-pill px-3 text-body font-semibold transition-colors disabled:opacity-40",
                      period === value ? "bg-primary text-white shadow-sm" : "text-muted",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {!view.initialDue && "label" in suggestion ? (
              <p className="text-caption text-muted">
                Санал: {suggestion.label} · {tugrik(Number(suggestion.amount))}
              </p>
            ) : null}

            <Field
              label="Бүлгийн тоо"
              error={errors.groupCount}
              hint={`Одоо бүртгэлтэй: ${view.registeredGroups}`}
              required
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  inputMode="numeric"
                  value={shownGroups}
                  onChange={(event) => {
                    setGroups(event.target.value.replace(/\D/g, ""));
                    resetSuggested();
                  }}
                />
              )}
            </Field>
            <Field label="Хүлээн авсан дүн" error={errors.amount} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  inputMode="decimal"
                  value={shownAmount}
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
            <Field
              label="Эрх дуусах огноо"
              error={errors.coversTo}
              hint="Санал болгосон огноог өөрчилж болно."
              required
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={shownCoversTo}
                  onChange={(event) => setCoversTo(event.target.value)}
                />
              )}
            </Field>
            <Field label="Тэмдэглэл" error={errors.note}>
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  maxLength={1000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Жишээ нь: Хаан банкны хуулга, захиралтай утсаар ярьсан"
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
                />
              )}
            </Field>
            <Field
              label="ebarimt-ын дугаар"
              error={errors.ebarimtNumber}
              hint="Дараа нь оруулж болно."
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={ebarimtNumber}
                  onChange={(event) => setEbarimtNumber(event.target.value)}
                />
              )}
            </Field>
          </>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            type="submit"
            disabled={record.isPending || !view?.contract || !suggestion || !shownGroups}
          >
            {record.isPending ? "Бүртгэж байна…" : "Бүртгэж сунгах"}
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
      className="fixed inset-0 z-50 grid grid-cols-[minmax(0,1fr)] place-items-center overflow-y-auto bg-ink/50 p-4"
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
