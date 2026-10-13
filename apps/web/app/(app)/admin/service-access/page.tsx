"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClock, FileDown } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
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
 * ★★ No QPay button. The client said on 2026-09-01 that QPay takes only the
 * parents' access fee; a «QPay-ээр шууд төлөх» button joins «Нэхэмжлэх
 * татах» here only once the client allows it for kindergartens.
 */
const serviceAccessSchema = z.object({
  expiresAt: z.string().nullish(),
  period: z.enum(["term", "year"]).nullish(),
  groupCount: z.number().int().nonnegative(),
  termAmount: z.string().nullish(),
  yearAmount: z.string().nullish(),
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
        <SectionHeader title="Сунгах" lede="Улирлаар эсвэл жилээр сонгоод нэхэмжлэхээ татна." />

        <div
          role="radiogroup"
          aria-label="Төлбөрийн хугацаа"
          className="grid max-w-[420px] grid-cols-2 gap-1 rounded-pill bg-canvas p-1"
        >
          {(
            [
              ["term", "Улирлаар"],
              ["year", "Жилээр — хямд"],
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
              {period === "year" ? "хичээлийн жил" : "улирал"}
            </>
          ) : access.isSuccess ? (
            "Гэрээнд бүлгийн төлбөр тогтоогоогүй байна. NomadKids-тэй холбогдож нэхэмжлэх авна уу."
          ) : null}
        </p>

        <InvoiceButton period={period} disabled={!price} />
        <p className="text-caption text-muted">
          Нэхэмжлэхийн дагуу шилжүүлэг хийсний дараа эрх сунгагдана.
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
    <Button className="self-start" onClick={() => queue.mutate()} disabled={disabled || working}>
      <FileDown aria-hidden="true" />
      {working
        ? "Нэхэмжлэх бэлдэж байна…"
        : status === "FAILED"
          ? "Дахин оролдох"
          : "Нэхэмжлэх үүсгэх"}
    </Button>
  );
}
