"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileDown, FileText, Minus, Plus, QrCode, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { MONTHS_IN_TERM, qpayInvoiceAttemptSchema } from "@kinder/contracts";
import { QpayProgress } from "@/components/child/access-pay-dialog";
import { FormError } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
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
    ★ The server prices `groups` groups and charges exactly that. A different
    count is a preview only — QPay and the invoice stay off until the server
    can price and charge the chosen count (asked of the admin): a screen that
    showed 5 groups' sum and charged 3 groups' would be the worst kind of bug.
  */
  const countChanged = groups > 0 && shownGroups !== groups;
  /** One group's price for a period: the server's amount over the groups it priced. */
  const perGroupOf = (amount: string | null | undefined) =>
    amount && groups > 0 ? Number(amount) / groups : null;
  const daysLeft = access.data?.expiresAt ? daysUntil(access.data.expiresAt) : null;
  const price = period === "year" ? access.data?.yearAmount : access.data?.termAmount;
  const coversTo = period === "year" ? access.data?.yearCoversTo : access.data?.termCoversTo;
  // An API from before the labels sends no `yearWhole`: the year was always whole then.
  const yearWhole = access.data?.yearWhole ?? true;
  const toSign = access.data?.contractToSign ?? null;
  const due = access.data?.due ?? null;
  const renewal: PayRequest = { path: "/service-access/qpay", body: { period } };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title="Үйлчилгээний эрх" lede="Байгууллагын үйлчилгээний хугацаа, сунгалт." />

      <Card pad="roomy" className="flex flex-col gap-3">
        <SectionHeader title="Одоогийн эрх" />
        {access.isPending ? (
          <LoadingState label="Ачаалж байна…" rows={2} />
        ) : notReady ? (
          <p className="rounded-control bg-canvas px-3.5 py-3 text-caption text-muted">
            Үйлчилгээний эрхийн мэдээлэл удахгүй харагдана.
          </p>
        ) : access.isError ? (
          <p className="rounded-control bg-canvas px-3.5 py-3 text-caption text-muted">
            {errorMessage(access.error)}
          </p>
        ) : toSign ? (
          <p role="status" className="text-body font-semibold text-danger">
            Гэрээ баталгаажаагүй байна. Доорх гэрээг уншаад баталгаажуулна уу.
          </p>
        ) : due ? (
          <p role="status" className="text-body font-semibold text-danger">
            Гэрээний төлбөр төлөгдмөгц эрх {formatDate(due.coversTo)} хүртэл хүчинтэй болно.
          </p>
        ) : access.data.expiresAt && daysLeft !== null ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-body text-ink">
              <CalendarClock className="size-5 shrink-0 text-muted" aria-hidden="true" />
              <span>
                <strong>{formatDate(access.data.expiresAt)}</strong> хүртэл ·{" "}
                {access.data.period === "year" ? "Жилээр" : "Улирлаар"} · {groups} бүлэг
              </span>
            </p>
            {daysLeft < 0 ? (
              <p role="status" className="text-caption font-semibold text-danger">
                Хугацаа дууссан. Сунгана уу.
              </p>
            ) : daysLeft <= REMIND_DAYS ? (
              <p role="status" className="text-caption font-semibold text-danger">
                {daysLeft} хоногийн дараа дуусна. Сунгана уу.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-body text-muted">Төлөгдсөн хугацаа алга. Доороос сунгана уу.</p>
        )}
      </Card>

      {toSign ? <ContractToSign contract={toSign} /> : null}
      {due ? <ContractDue due={due} /> : null}

      {toSign || due ? null : (
        <Card pad="roomy" className="flex flex-col gap-4">
          <SectionHeader
            title="Сунгах"
            lede="Улирлаар эсвэл жилээр сонгоод QPay-ээр, эсвэл нэхэмжлэхээр төлнө."
          />

          {groups > 0 ? (
            <GroupStepper
              value={shownGroups}
              registered={groups}
              onChange={(next) => setChosenGroups(next === groups ? null : next)}
            />
          ) : null}

          {/*
            ★ Each choice shows what it buys — 2026-10-22, the user: «Улирлаар» and
            «Жилээр» with the period and the amount on the choice itself, so
            the two can be compared before paying. The amounts and dates are
            the server's (`termAmount`, `termCoversTo`, `termLabel` …).
          */}
          <div
            role="radiogroup"
            aria-label="Төлбөрийн хугацаа"
            className="grid max-w-xl grid-cols-2 gap-2"
          >
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
                    "flex flex-col items-start gap-1 rounded-card border-2 p-3 text-left transition-colors",
                    chosen
                      ? "border-primary bg-primary-soft"
                      : "border-border-soft bg-surface hover:border-border",
                  )}
                >
                  <span
                    className={cn("text-body font-semibold", chosen ? "text-primary" : "text-ink")}
                  >
                    {option.title}
                  </span>
                  <span id={`period-${option.value}-details`} className="flex flex-col gap-1">
                    <span className="text-caption text-muted">
                      {option.label} · {option.months} сар
                    </span>
                    <span className="text-title font-bold tabular-nums text-ink">
                      {total !== null ? tugrik(total) : "—"}
                    </span>
                    {perGroup !== null ? (
                      <span className="text-caption tabular-nums text-muted">
                        {shownGroups} бүлэг × {tugrik(Math.round(perGroup))}
                      </span>
                    ) : null}
                    {option.coversTo ? (
                      <span className="text-caption text-ink">
                        {formatDate(option.coversTo)} хүртэл
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>

          {!price && access.isSuccess ? (
            <p className="text-body text-ink">
              Гэрээнд бүлгийн төлбөр тогтоогоогүй байна. NomadKids-тэй холбогдож нэхэмжлэх авна уу.
            </p>
          ) : null}

          {price && coversTo ? (
            <p aria-live="polite" className="text-body text-muted">
              Төлмөгц эрх <strong className="text-ink">{formatDate(coversTo)}</strong> хүртэл
              сунгагдана.
            </p>
          ) : null}

          {countChanged ? (
            <p role="status" className="rounded-control bg-sun px-3 py-2 text-caption text-sun-ink">
              {shownGroups} бүлгээр тооцоолж харууллаа. Одоогоор {groups} бүлгээр төлөх боломжтой —
              бүлгийн тоог өөрчлөх бол NomadKids-тэй холбогдож гэрээгээ шинэчилнэ үү.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <ContractPayDialog request={renewal} disabled={!price || countChanged} />
            <InvoiceButton
              request={{ path: "/service-access/invoices", body: { period } }}
              disabled={!price || countChanged}
            />
          </div>
          <p className="text-caption text-muted">{PAID_HOW}</p>
        </Card>
      )}
    </div>
  );
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

/** «Бүлгийн тоо» with «−» and «+» — what the amounts below are figured for. */
function GroupStepper({
  value,
  registered,
  onChange,
}: {
  value: number;
  registered: number;
  onChange: (next: number) => void;
}) {
  const MAX = 99;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card bg-canvas px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-ink">Бүлгийн тоо</p>
        <p className="text-caption text-muted">Бүртгэлтэй: {registered} бүлэг</p>
      </div>
      <div role="group" aria-label="Бүлгийн тоо" className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon"
          aria-label="Бүлэг хасах"
          disabled={value <= 1}
          onClick={() => onChange(value - 1)}
        >
          <Minus size={18} aria-hidden />
        </Button>
        <span
          aria-live="polite"
          className="w-10 text-center text-title font-bold tabular-nums text-ink"
        >
          {value}
        </span>
        <Button
          variant="secondary"
          size="icon"
          aria-label="Бүлэг нэмэх"
          disabled={value >= MAX}
          onClick={() => onChange(value + 1)}
        >
          <Plus size={18} aria-hidden />
        </Button>
      </div>
    </div>
  );
}
