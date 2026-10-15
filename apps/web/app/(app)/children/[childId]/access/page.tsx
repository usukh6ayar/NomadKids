"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { accessStatusSchema, type AccessPeriod } from "@kinder/contracts";
import { AccessInvoice, useOwnChildName } from "@/components/child/access-invoice";
import { AccessPayDialog } from "@/components/child/access-pay-dialog";
import { AccessPeriodPicker } from "@/components/child/access-period-picker";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { daysUntil, formatDate } from "@/lib/format";

/**
 * «Үйлчилгээний эрх» — what a family pays NomadKids to use the system, kept
 * apart from «Санхүү», which is the kindergarten's own invoices (2026-10-12,
 * the user: "санхүү цэцэрлэгийн нэхэмжлэх, үйлчилгээний эрх бол манай систем
 * ашигласан"). The parent's menu row used to open the invoices.
 *
 * Reads the existing `GET /children/:id/access` and pays through the existing
 * `AccessPayDialog` (QPay). An unpaid child never reaches this page — the
 * child layout shows `AccessGate` instead — so this is the paid state: until
 * when, and renewing 14 days before the end.
 *
 * ★ The amounts are the server's — `amount` for the year, `termAmount` for a
 * term (#217) — not `lib/pricing.ts`: the server's figure is what QPay
 * charges. «Улирлаар» is offered only while `termAmount` is set: terms are
 * sold here and today is in one.
 *
 * ★★ 2026-10-15, the user: the paid period as a receipt with a PDF, and the
 * renewal as an invoice before the QR — `AccessInvoice`.
 */
const REMIND_DAYS = 14;

export default function ChildAccessPage() {
  const { childId } = useParams<{ childId: string }>();
  const [period, setPeriod] = useState<AccessPeriod>("YEAR");
  const childName = useOwnChildName(childId);

  const status = useQuery({
    queryKey: qk.childAccess(childId),
    queryFn: () => get(`/children/${childId}/access`, accessStatusSchema),
  });

  if (status.isPending) return <LoadingState rows={3} />;
  if (status.isError) {
    return (
      <div className="py-6">
        <ErrorState title="Алдаа гарлаа" description={errorMessage(status.error)} />
      </div>
    );
  }

  const { required, active, subscription, amount, termAmount } = status.data;
  // Without a term price the year is the only choice, whatever was picked.
  const chosen: AccessPeriod = termAmount ? period : "YEAR";
  const price = chosen === "YEAR" ? amount : (termAmount ?? null);
  const daysLeft = subscription && active ? daysUntil(subscription.expiresAt) : null;
  const canRenew = required && (!active || (daysLeft !== null && daysLeft <= REMIND_DAYS));

  return (
    <div className="flex flex-col gap-4 py-2">
      <PageHeader backHref={`/children/${childId}/general`} title="Үйлчилгээний эрх" />

      <Card pad="roomy" className="flex flex-col gap-3">
        <SectionHeader title="Одоогийн эрх" />
        {!required ? (
          <p className="text-body text-muted">
            Энэ цэцэрлэгт үйлчилгээний эрхийн төлбөр шаардлагагүй.
          </p>
        ) : subscription && active ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-body text-ink">
              <CalendarClock className="size-5 shrink-0 text-muted" aria-hidden="true" />
              <span>
                <strong>{formatDate(subscription.expiresAt)}</strong> хүртэл ·{" "}
                {subscription.schoolYear.name} хичээлийн жил
              </span>
            </p>
            {daysLeft !== null && daysLeft <= REMIND_DAYS ? (
              <p role="status" className="text-caption font-semibold text-danger">
                {daysLeft} хоногийн дараа дуусна. Сунгана уу.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-body text-muted">Үйлчилгээний эрх идэвхгүй байна.</p>
        )}
      </Card>

      {required && subscription?.paidAt ? (
        <AccessInvoice
          data={{
            state: "paid",
            childName,
            period: subscription.period ?? "YEAR",
            termNumber: subscription.termNumber,
            schoolYearName: subscription.schoolYear.name,
            amount: subscription.amount,
            number: subscription.id,
            paidAt: subscription.paidAt,
            expiresAt: subscription.expiresAt,
          }}
        />
      ) : null}

      {canRenew ? (
        <Card pad="roomy" className="flex flex-col gap-4">
          <SectionHeader title="Сунгах" lede="Улирлаар эсвэл жилээр сонгоод QPay-ээр төлнө." />

          <AccessPeriodPicker
            value={chosen}
            onChange={setPeriod}
            termAvailable={Boolean(termAmount)}
            className="max-w-[420px]"
          />
          {!termAmount ? (
            <p className="text-caption text-muted">Одоогоор зөвхөн жилээр төлөх боломжтой.</p>
          ) : null}

          <AccessInvoice
            data={{
              state: "due",
              childName,
              // No year named: a renewal may already be next year's.
              period: chosen,
              amount: price,
            }}
          />

          <AccessPayDialog
            key={chosen}
            childId={childId}
            period={chosen}
            onPaid={() => status.refetch()}
            trigger={<Button className="self-start">QPay-ээр төлөх</Button>}
          />
        </Card>
      ) : null}
    </div>
  );
}
