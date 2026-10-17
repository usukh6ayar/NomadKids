"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileDown, QrCode, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { qpayInvoiceAttemptSchema } from "@kinder/contracts";
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
  /** The whole school year at the year's price — the only one «хямд» is said of. */
  yearWhole: z.boolean().nullish(),
});

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

  const access = useQuery({
    queryKey: qk.serviceAccess(),
    queryFn: () => get("/service-access", serviceAccessSchema),
    retry: false,
  });

  const notReady = access.isError && isNotFound(access.error);
  const groups = access.data?.groupCount ?? 0;
  const daysLeft = access.data?.expiresAt ? daysUntil(access.data.expiresAt) : null;
  const price = period === "year" ? access.data?.yearAmount : access.data?.termAmount;
  const coversTo = period === "year" ? access.data?.yearCoversTo : access.data?.termCoversTo;
  const periodLabel =
    (period === "year" ? access.data?.yearLabel : access.data?.termLabel) ??
    (period === "year" ? "хичээлийн жил" : "улирал");
  // An API from before the labels sends no `yearWhole`: the year was always whole then.
  const yearWhole = access.data?.yearWhole ?? true;

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

      <Card pad="roomy" className="flex flex-col gap-4">
        <SectionHeader title="Сунгах" lede="Улирлаар эсвэл жилээр сонгоод QPay-ээр төлнө." />

        <div
          role="radiogroup"
          aria-label="Төлбөрийн хугацаа"
          className="grid max-w-[420px] grid-cols-2 gap-1 rounded-pill bg-canvas p-1"
        >
          {(
            [
              ["term", "Улирлаар"],
              ["year", yearWhole ? "Жилээр — хямд" : "Жилээр"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                "min-h-11 rounded-pill px-3 text-body font-semibold transition-colors",
                period === value ? "bg-primary text-white shadow-sm" : "text-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <p aria-live="polite" className="text-body text-ink">
          {price ? (
            <>
              {groups} бүлэг · <strong className="text-title">{tugrik(Number(price))}</strong> /{" "}
              {periodLabel}
            </>
          ) : access.isSuccess ? (
            "Гэрээнд бүлгийн төлбөр тогтоогоогүй байна. NomadKids-тэй холбогдож нэхэмжлэх авна уу."
          ) : null}
        </p>

        {price && coversTo ? (
          <p className="text-body text-muted">
            Төлмөгц эрх <strong className="text-ink">{formatDate(coversTo)}</strong> хүртэл
            сунгагдана.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <ContractPayDialog period={period} disabled={!price} />
          <InvoiceButton period={period} disabled={!price} />
        </div>
        <p className="text-caption text-muted">
          QPay-ээр төлсөн даруйд эрх сунгагдана. Нэхэмжлэхийг баримтад хадгалж болно.
        </p>
      </Card>
    </div>
  );
}

/**
 * «Нэхэмжлэх татах» — queued, polled, then opened. The same shape as the
 * finance PDFs: Chromium never runs inside a request (CLAUDE.md §6).
 */
function InvoiceButton({ period, disabled }: { period: BillingPeriod; disabled: boolean }) {
  const toast = useToast();
  const [jobId, setJobId] = useState<string | null>(null);

  const queue = useMutation({
    mutationFn: () =>
      mutate("/service-access/invoices", invoiceJobSchema, { method: "POST", body: { period } }),
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
 * «QPay-ээр төлөх» — the next period of the contract (№6). The QR comes
 * from the server's price; the dialog follows the attempt until QPay
 * confirms, then the contract's new end is read back.
 */
function ContractPayDialog({ period, disabled }: { period: BillingPeriod; disabled: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      mutate("/service-access/qpay", contractQpaySchema, { method: "POST", body: { period } }),
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
