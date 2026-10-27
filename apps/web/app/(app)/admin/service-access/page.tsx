"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, FileText, Minus, Plus, QrCode, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { MONTHS_IN_TERM, qpayInvoiceAttemptSchema } from "@kinder/contracts";
import { QpayProgress } from "@/components/child/access-pay-dialog";
import { FormError } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { get, mutate } from "@/lib/api/browser";
import { useToast } from "@/components/ui/toast";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { daysUntil, formatDate } from "@/lib/format";
import { tugrik, type BillingPeriod } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/**
 * «Үйлчилгээний эрх» for the kindergarten — 2026-10-12, the user: the row sits
 * just above «Хувийн тохиргоо», a director sees how long the contract runs and
 * renews it by term or by year at the price page's own amounts.
 *
 * ★ `GET /service-access` (#218) answers the contract in force, the groups
 * running now and both renewal amounts — the contract's own per-group fee,
 * not `lib/pricing.ts`. The invoice is a job rendered by the worker:
 * `POST /service-access/invoices { period }` → poll → `…/download`.
 *
 * ★★ «QPay-ээр төлөх» — №6, the user 2026-10-16, confirmed 2026-10-18
 * («QPay байх»): a bank transfer never reached the system, so the platform's
 * revenue and the partners' shares missed it. The server prices the next
 * period (`POST /service-access/qpay`) and, once QPay confirms, the contract
 * runs to the day shown here before paying. The invoice stays, second, as a
 * document to keep.
 */
const serviceAccessSchema = z.object({
  expiresAt: z.string().nullish(),
  period: z.enum(["term", "year"]).nullish(),
  groupCount: z.number().int().nonnegative(),
  /** «Бүлэг − N +»'s bounds — never below the groups running now (№5). */
  groupCountMin: z.number().int().nullish(),
  groupCountMax: z.number().int().nullish(),
  termAmount: z.string().nullish(),
  yearAmount: z.string().nullish(),
  /** What each period would extend the contract to (№6). */
  termCoversTo: z.string().nullish(),
  yearCoversTo: z.string().nullish(),
  /**
   * What each period is, as the invoice and the QR name it. From December
   * «Жилээр» is what is left of the school year, priced as terms (the user,
   * 2026-10-18) — «2026–2027 хичээлийн жил, II улирал, III улирал».
   */
  termLabel: z.string().nullish(),
  yearLabel: z.string().nullish(),
  /** Months each period charges — the server's (2026-10-22); derived when absent. */
  termMonths: z.number().int().nullish(),
  yearMonths: z.number().int().nullish(),
  /** The whole school year at the year's price — the only one «хямд» is said of. */
  yearWhole: z.boolean().nullish(),
  /**
   * The contract issued and waiting for the director's acceptance — accepted
   * online (the user, 2026-10-18).
   */
  contractToSign: z
    .object({
      id: z.string(),
      number: z.string(),
      version: z.number().int(),
      groupCount: z.number().int().nullable(),
      period: z.enum(["term", "year"]).nullable(),
      periodFee: z.string().nullable(),
      startsOn: z.string(),
      endsOn: z.string(),
      pdfReady: z.boolean(),
    })
    .nullish(),
  /** The accepted contract's first period, unpaid — by QPay or by transfer. */
  due: z
    .object({
      id: z.string(),
      contractNumber: z.string(),
      coversFrom: z.string(),
      coversTo: z.string(),
      groupCount: z.number().int(),
      amount: z.string(),
      label: z.string(),
    })
    .nullish(),
});

/** Where a QR or an invoice is asked for — the next period, or the one owed. */
type PayRequest = { path: string; body: Record<string, unknown> };

const contractQpaySchema = z.object({
  payment: z.object({
    id: z.string(),
    coversTo: z.string(),
    amount: z.string(),
    status: z.enum(["PENDING", "PAID"]),
  }),
  attempt: qpayInvoiceAttemptSchema.nullable(),
});

const invoiceJobSchema = z.object({
  id: z.string(),
  status: z.string(),
  downloadable: z.boolean(),
  errorMessage: z.string().nullish(),
});
const invoiceDownloadSchema = z.object({ url: z.string() });
const acceptSchema = z.object({ contract: z.object({ id: z.string(), status: z.string() }) });

/** The reminder window — the user, 2026-10-12. */
const REMIND_DAYS = 14;

export default function AdminServiceAccessPage() {
  const { session, isLoading } = useSession();
  /*
    ★ A director whose service has lapsed holds no live ADMIN membership —
    the API opens this page alone to them (2026-10-27), so the guard does too.
  */
  if (!isLoading && session?.lapsed.some((m) => m.role === "ADMIN")) return <ServiceAccess />;
  return (
    <RequireRole roles={["ADMIN"]}>
      <ServiceAccess />
    </RequireRole>
  );
}

function ServiceAccess() {
  const [period, setPeriod] = useState<BillingPeriod>("term");
  /**
   * «+ / −» on the group count — 2026-10-22, the user. Null follows the
   * server's count (the kindergarten's groups); a number is the director's.
   */
  const [chosenGroups, setChosenGroups] = useState<number | null>(null);

  const access = useQuery({
    queryKey: qk.serviceAccess(),
    queryFn: () => get("/service-access", serviceAccessSchema),
    retry: false,
  });

  const notReady = access.isError && isNotFound(access.error);
  const groups = access.data?.groupCount ?? 0;
  const shownGroups = chosenGroups ?? groups;
  /*
    ★ The chosen count is sent with the QR and the invoice (№5, 2026-10-23):
    the server prices and charges exactly that many groups, never fewer than
    run now. Before it could, a changed count only previewed and the buttons
    stayed off — a screen that showed 5 groups' sum and charged 3 groups'
    would be the worst kind of bug, and sending the count is what rules it out.
  */
  const minGroups = access.data?.groupCountMin ?? groups;
  const maxGroups = access.data?.groupCountMax ?? 99;
  const countChanged = chosenGroups !== null && chosenGroups !== groups;
  const groupBody = countChanged ? { groupCount: chosenGroups } : {};
  /** One group's price for a period: the server's amount over the groups it priced. */
  const perGroupOf = (amount: string | null | undefined) =>
    amount && groups > 0 ? Number(amount) / groups : null;
  const daysLeft = access.data?.expiresAt ? daysUntil(access.data.expiresAt) : null;
  const price = period === "year" ? access.data?.yearAmount : access.data?.termAmount;
  // An API from before the labels sends no `yearWhole`: the year was always whole then.
  const yearWhole = access.data?.yearWhole ?? true;
  const toSign = access.data?.contractToSign ?? null;
  const due = access.data?.due ?? null;
  const renewal: PayRequest = { path: "/service-access/qpay", body: { period, ...groupBody } };

  /*
    ★ Minimal — 2026-10-22, the user: "хэт их бичиг". The state is one line
    under the title; the renewal is the group count, two cards (the amount
    and the dates), and the two ways to pay. What a card buys in full — the
    period's name, its months, «N бүлэг × per group» — is its description,
    and shows on the chosen card only.
  */
  const status = access.isPending
    ? "Ачаалж байна…"
    : access.data?.expiresAt && !due
      ? `${formatDate(access.data.expiresAt)} хүртэл · ${groups} бүлэг`
      : access.isSuccess && !toSign && !due
        ? "Төлөгдсөн хугацаа алга"
        : undefined;
  const alert = notReady
    ? "Үйлчилгээний эрхийн мэдээлэл удахгүй харагдана."
    : access.isError
      ? errorMessage(access.error)
      : toSign
        ? "Гэрээ баталгаажаагүй байна. Доорх гэрээг уншаад баталгаажуулна уу."
        : due
          ? `Гэрээний төлбөр төлөгдмөгц эрх ${formatDate(due.coversTo)} хүртэл хүчинтэй болно.`
          : daysLeft !== null && access.data?.expiresAt
            ? daysLeft < 0
              ? "Хугацаа дууссан. Сунгана уу."
              : daysLeft <= REMIND_DAYS
                ? `${daysLeft} хоногийн дараа дуусна. Сунгана уу.`
                : null
            : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title="Үйлчилгээний эрх" lede={status} />
      {alert ? (
        <p role="status" className="-mt-2 text-caption font-semibold text-danger">
          {alert}
        </p>
      ) : null}
      {access.isPending ? <LoadingState label="Ачаалж байна…" rows={2} /> : null}

      {toSign ? <ContractToSign contract={toSign} /> : null}
      {due ? <ContractDue due={due} /> : null}

      {/* While the API does not answer (404), the card stays with its buttons off. */}
      {toSign || due || access.isPending || (access.isError && !notReady) ? null : (
        <Card pad="roomy" className="flex flex-col gap-4">
          {groups > 0 ? (
            <GroupStepper
              value={shownGroups}
              registered={groups}
              min={minGroups}
              max={maxGroups}
              onChange={(next) => setChosenGroups(next === groups ? null : next)}
            />
          ) : null}

          <div role="radiogroup" aria-label="Төлбөрийн хугацаа" className="grid grid-cols-2 gap-2">
            {(
              [
                {
                  value: "term",
                  title: "Улирлаар",
                  amount: access.data?.termAmount,
                  coversTo: access.data?.termCoversTo,
                  label: access.data?.termLabel ?? "улирал",
                  months: access.data?.termMonths ?? MONTHS_IN_TERM,
                },
                {
                  value: "year",
                  title: yearWhole ? "Жилээр — хямд" : "Жилээр",
                  amount: access.data?.yearAmount,
                  coversTo: access.data?.yearCoversTo,
                  label: access.data?.yearLabel ?? "хичээлийн жил",
                  months: access.data?.yearMonths ?? yearMonths(access.data?.yearLabel, yearWhole),
                },
              ] as const
            ).map((option) => {
              const chosen = period === option.value;
              const perGroup = perGroupOf(option.amount);
              const total = perGroup !== null ? Math.round(perGroup * shownGroups) : null;
              const span = dateSpan(option.label, option.coversTo);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  // Named by the choice; what it buys is its description.
                  aria-label={option.title}
                  aria-describedby={`period-${option.value}-details`}
                  onClick={() => setPeriod(option.value)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-card border-2 px-3 py-2.5 text-left transition-colors",
                    chosen
                      ? "border-primary bg-primary-soft"
                      : "border-border-soft bg-surface hover:border-border",
                  )}
                >
                  <span
                    className={cn(
                      "text-caption font-semibold",
                      chosen ? "text-primary" : "text-muted",
                    )}
                  >
                    {option.title}
                  </span>
                  <span className="text-title font-bold tabular-nums text-ink">
                    {total !== null ? tugrik(total) : "—"}
                  </span>
                  {span ? <span className="text-caption text-muted">{span}</span> : null}
                  {chosen && perGroup !== null ? (
                    <span className="text-caption tabular-nums text-muted">
                      {shownGroups} бүлэг × {tugrik(Math.round(perGroup))} · {option.months} сар
                    </span>
                  ) : null}
                  <span id={`period-${option.value}-details`} className="sr-only">
                    {option.label} · {option.months} сар · {total !== null ? tugrik(total) : "—"}
                    {perGroup !== null
                      ? ` · ${shownGroups} бүлэг × ${tugrik(Math.round(perGroup))}`
                      : ""}
                    {option.coversTo ? ` · ${formatDate(option.coversTo)} хүртэл` : ""}
                  </span>
                </button>
              );
            })}
          </div>

          {!price ? (
            <p className="text-caption text-muted">
              Гэрээнд бүлгийн төлбөр тогтоогоогүй байна. NomadKids-тэй холбогдоно уу.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <ContractPayDialog request={renewal} disabled={!price} />
            <InvoiceButton
              request={{ path: "/service-access/invoices", body: { period, ...groupBody } }}
              disabled={!price}
            />
          </div>
          <p className="-mt-2 text-caption text-muted">
            Дансаар шилжүүлбэл бүртгэгдмэгц сунгагдана.
          </p>
        </Card>
      )}
    </div>
  );
}

/**
 * «2026.12.01 – 2027.02.28» — the dates out of the server's label, or
 * «… хүртэл» when the label names none (a whole year).
 */
function dateSpan(label: string, coversTo: string | null | undefined): string | null {
  const inLabel = label.match(/\(([^)]+)\)/)?.[1];
  if (inLabel) return inLabel;
  return coversTo ? `${formatDate(coversTo)} хүртэл` : null;
}

const PAID_HOW =
  "QPay-ээр төлсөн даруйд эрх сунгагдана. Нэхэмжлэхээр дансаар шилжүүлсэн бол NomadKids төлбөрийг бүртгэмэгц сунгагдана.";

/**
 * «Гэрээ байгуулах» — the director reads the contract and accepts it online
 * (the user, 2026-10-18). The server records who, when, and which version of
 * which PDF; the contract becomes ACTIVE and its first period is owed.
 */
function ContractToSign({
  contract,
}: {
  contract: NonNullable<z.infer<typeof serviceAccessSchema>["contractToSign"]>;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [agreed, setAgreed] = useState(false);

  const pdf = useMutation({
    mutationFn: () =>
      get(`/service-access/contracts/${contract.id}/download`, invoiceDownloadSchema),
    // ★ Fetched and followed per click: a presigned URL sitting in the page is a credential.
    onSuccess: (result) => window.open(result.url, "_blank", "noopener"),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const accept = useMutation({
    mutationFn: () =>
      mutate(`/service-access/contracts/${contract.id}/accept`, acceptSchema, {
        method: "POST",
        body: { accepted: true, version: contract.version },
      }),
    onSuccess: () => {
      toast.success("Гэрээ баталгаажлаа.");
      void queryClient.invalidateQueries({ queryKey: qk.serviceAccess() });
    },
  });

  return (
    <Card pad="roomy" className="flex flex-col gap-4">
      <SectionHeader
        title="Гэрээ байгуулах"
        lede="Гэрээгээ уншаад зөвшөөрвөл доор баталгаажуулна уу."
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
        <dt className="text-muted">Гэрээний дугаар</dt>
        <dd className="font-semibold text-ink">№{contract.number}</dd>
        <dt className="text-muted">Хугацаа</dt>
        <dd className="text-ink">
          {formatDate(contract.startsOn)} – {formatDate(contract.endsOn)}
        </dd>
        {contract.groupCount ? (
          <>
            <dt className="text-muted">Бүлэг</dt>
            <dd className="text-ink">{contract.groupCount}</dd>
          </>
        ) : null}
        {contract.periodFee ? (
          <>
            <dt className="text-muted">Нийт төлбөр</dt>
            <dd className="font-semibold text-ink">{tugrik(Number(contract.periodFee))}</dd>
          </>
        ) : null}
      </dl>

      <Button
        variant="secondary"
        className="self-start"
        onClick={() => pdf.mutate()}
        disabled={!contract.pdfReady || pdf.isPending}
      >
        <FileText aria-hidden="true" />
        {contract.pdfReady ? "Гэрээ унших (PDF)" : "Гэрээ бэлтгэгдэж байна…"}
      </Button>

      <label className="flex items-start gap-2 text-body text-ink">
        <input
          type="checkbox"
          className="mt-1 size-4"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
        />
        <span>Гэрээний нөхцөлийг уншиж танилцсан бөгөөд зөвшөөрч байна.</span>
      </label>

      <FormError message={accept.isError ? errorMessage(accept.error) : null} />
      <Button
        className="self-start"
        onClick={() => accept.mutate()}
        disabled={!agreed || !contract.pdfReady || accept.isPending}
      >
        {accept.isPending ? "Баталгаажуулж байна…" : "Гэрээг баталгаажуулах"}
      </Button>
      <p className="text-caption text-muted">
        Баталгаажуулахад таны нэр, огноо, гэрээний хувилбар бүртгэгдэнэ.
      </p>
    </Card>
  );
}

/** «Гэрээний төлбөр» — the accepted contract's first period, at its own figure. */
function ContractDue({ due }: { due: NonNullable<z.infer<typeof serviceAccessSchema>["due"]> }) {
  return (
    <Card pad="roomy" className="flex flex-col gap-4">
      <SectionHeader title="Гэрээний төлбөр" lede={due.label} />
      <p className="text-body text-ink">
        {due.groupCount} бүлэг ·{" "}
        <strong className="text-title">{tugrik(Number(due.amount))}</strong>
      </p>
      <div className="flex flex-wrap gap-2">
        <ContractPayDialog request={{ path: `/service-access/qpay/${due.id}`, body: {} }} />
        <InvoiceButton request={{ path: `/service-access/payments/${due.id}/invoice`, body: {} }} />
      </div>
      <p className="text-caption text-muted">{PAID_HOW}</p>
    </Card>
  );
}

/**
 * «Нэхэмжлэх татах» — queued, polled, then opened. The same shape as the
 * finance PDFs: Chromium never runs inside a request (CLAUDE.md §6).
 */
function InvoiceButton({ request, disabled = false }: { request: PayRequest; disabled?: boolean }) {
  const toast = useToast();
  const [jobId, setJobId] = useState<string | null>(null);

  const queue = useMutation({
    mutationFn: () =>
      mutate(request.path, invoiceJobSchema, { method: "POST", body: request.body }),
    onSuccess: (job) => setJobId(job.id),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const job = useQuery({
    enabled: Boolean(jobId),
    queryKey: ["service-access", "invoice", jobId],
    queryFn: () => get(`/service-access/invoices/${jobId}`, invoiceJobSchema),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "DONE" || status === "FAILED" ? false : 1500;
    },
  });

  const download = useMutation({
    mutationFn: () => get(`/service-access/invoices/${jobId}/download`, invoiceDownloadSchema),
    onSuccess: (result) => {
      setJobId(null);
      window.location.href = result.url;
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const status = job.data?.status;
  const working = queue.isPending || status === "QUEUED" || status === "RUNNING";

  if (job.data?.downloadable) {
    return (
      <Button
        className="self-start"
        onClick={() => download.mutate()}
        disabled={download.isPending}
      >
        <FileDown aria-hidden="true" />
        Нэхэмжлэх татах
      </Button>
    );
  }

  return (
    <Button
      variant="secondary"
      className="self-start"
      onClick={() => queue.mutate()}
      disabled={disabled || working}
    >
      <FileDown aria-hidden="true" />
      {working
        ? "Нэхэмжлэх бэлдэж байна…"
        : status === "FAILED"
          ? "Дахин оролдох"
          : "Нэхэмжлэх үүсгэх"}
    </Button>
  );
}

/**
 * «QPay-ээр төлөх» — the next period of the contract (№6), or the one owed.
 * The QR comes from the server's price; the dialog follows the attempt until
 * QPay confirms, then the contract's new end is read back.
 */
function ContractPayDialog({
  request,
  disabled = false,
}: {
  request: PayRequest;
  disabled?: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      mutate(request.path, contractQpaySchema, { method: "POST", body: request.body }),
    onSuccess: (result) => {
      queryClient.setQueryData(["service-access", "qpay", result.payment.id], result);
      setPaymentId(result.payment.id);
    },
  });

  const progress = useQuery({
    queryKey: ["service-access", "qpay", paymentId],
    queryFn: () => get(`/service-access/qpay/${paymentId}`, contractQpaySchema),
    enabled: Boolean(paymentId) && open,
    refetchInterval: (query) => (query.state.data?.attempt?.status === "PENDING" ? 3000 : false),
  });

  const done = useRef(false);
  const paid = progress.data?.payment.status === "PAID";
  useEffect(() => {
    if (paid && !done.current) {
      done.current = true;
      void queryClient.invalidateQueries({ queryKey: qk.serviceAccess() });
      toast.success(
        `Төлбөр төлөгдлөө. Эрх ${formatDate(progress.data!.payment.coversTo)} хүртэл сунгагдлаа.`,
      );
    }
  }, [paid, progress.data, queryClient, toast]);

  function close() {
    setOpen(false);
    setPaymentId(null);
    done.current = false;
    create.reset();
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
          create.mutate();
        } else close();
      }}
    >
      <Dialog.Trigger asChild>
        <Button className="self-start" disabled={disabled}>
          <QrCode aria-hidden="true" />
          QPay-ээр төлөх
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-card border border-border bg-surface p-5 shadow-lg"
          aria-describedby="contract-qpay-description"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lead font-semibold text-ink">
                Үйлчилгээний эрх сунгах
              </Dialog.Title>
              <Dialog.Description
                id="contract-qpay-description"
                className="mt-1 text-body text-muted"
              >
                {progress.data
                  ? `${formatDate(progress.data.payment.coversTo)} хүртэл · ${tugrik(Number(progress.data.payment.amount))}`
                  : "QR кодыг банкны аппаараа уншуулж төлнө үү."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Хаах">
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>

          <FormError message={create.isError ? errorMessage(create.error) : null} />
          {create.isError ? null : (
            <QpayProgress
              attempt={progress.data?.attempt ?? undefined}
              pending={create.isPending}
              onRetry={() => create.mutate()}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The year's months — nine for the whole school year; from December «the
 * year» is what is left of it, named by its terms («…, II улирал, III
 * улирал»), three months each.
 */
function yearMonths(label: string | null | undefined, whole: boolean): number {
  if (whole || !label) return MONTHS_IN_TERM * 3;
  const terms = label.match(/[IV]+ улирал/g)?.length ?? 3;
  return MONTHS_IN_TERM * terms;
}

/** «Бүлэг − N +» — what the amounts below are figured for; the registered count when changed. */
function GroupStepper({
  value,
  registered,
  min,
  max,
  onChange,
}: {
  value: number;
  registered: number;
  /** The groups running now — the server refuses to price fewer. */
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 flex-1 text-body font-semibold text-ink">
        Бүлэг
        {value !== registered ? (
          <span className="ml-2 text-caption font-normal text-muted">Бүртгэлтэй: {registered}</span>
        ) : null}
      </span>
      <div role="group" aria-label="Бүлгийн тоо" className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Бүлэг хасах"
          disabled={value <= Math.max(1, min)}
          onClick={() => onChange(value - 1)}
        >
          <Minus size={18} aria-hidden />
        </Button>
        <span
          aria-live="polite"
          className="w-8 text-center text-lead font-bold tabular-nums text-ink"
        >
          {value}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Бүлэг нэмэх"
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          <Plus size={18} aria-hidden />
        </Button>
      </div>
    </div>
  );
}
