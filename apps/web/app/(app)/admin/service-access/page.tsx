"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock, FileDown } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { downloadUrl } from "@/lib/api/client";
import { get } from "@/lib/api/browser";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { daysUntil, formatDate } from "@/lib/format";
import {
  KINDERGARTEN_CURRENT_TERM_PER_GROUP,
  KINDERGARTEN_CURRENT_YEAR_PER_GROUP,
  kindergartenPrice,
  tugrik,
  type BillingPeriod,
} from "@/lib/pricing";
import { cn } from "@/lib/utils";

/**
 * «Үйлчилгээний эрх» for the kindergarten — 2026-10-12, the user: the row sits
 * just above «Хувийн тохиргоо», a director sees how long the contract runs and
 * renews it by term or by year at the price page's own amounts.
 *
 * ★ The contract the backend is asked for — nothing answers it yet:
 *
 *   GET /service-access
 *     → { expiresAt: date | null, period: "term" | "year" | null, groupCount }
 *   GET /service-access/invoice?period=term|year
 *     → the invoice PDF with the bank details; the operator marks it paid
 *
 * ★★ No QPay button. The client said on 2026-09-01 that QPay takes only the
 * parents' access fee; a «QPay-ээр шууд төлөх» button joins «Нэхэмжлэх
 * татах» here only once the client allows it for kindergartens.
 */
const serviceAccessSchema = z.object({
  expiresAt: z.string().nullish(),
  period: z.enum(["term", "year"]).nullish(),
  groupCount: z.number().int().nonnegative(),
});

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
          {groups > 0 ? (
            <>
              {groups} бүлэг ×{" "}
              {tugrik(
                period === "year"
                  ? KINDERGARTEN_CURRENT_YEAR_PER_GROUP
                  : KINDERGARTEN_CURRENT_TERM_PER_GROUP,
              )}{" "}
              = <strong className="text-title">{tugrik(kindergartenPrice(groups, period))}</strong>
            </>
          ) : (
            <>
              1 бүлэг:{" "}
              <strong>
                {tugrik(
                  period === "year"
                    ? KINDERGARTEN_CURRENT_YEAR_PER_GROUP
                    : KINDERGARTEN_CURRENT_TERM_PER_GROUP,
                )}
              </strong>{" "}
              / {period === "year" ? "жил" : "улирал"}
            </>
          )}
        </p>

        {access.isSuccess ? (
          <Button asChild className="self-start">
            <a href={downloadUrl(`/service-access/invoice?period=${period}`)}>
              <FileDown aria-hidden="true" />
              Нэхэмжлэх татах
            </a>
          </Button>
        ) : (
          <Button disabled className="self-start">
            <FileDown aria-hidden="true" />
            Нэхэмжлэх татах
          </Button>
        )}
        <p className="text-caption text-muted">
          Нэхэмжлэхийн дагуу шилжүүлэг хийсний дараа эрх сунгагдана.
        </p>
      </Card>
    </div>
  );
}
