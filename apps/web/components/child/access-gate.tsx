"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { accessStatusSchema, type AccessPeriod } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { useSession } from "@/lib/auth/session";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { AccessInvoice, useOwnChildName } from "@/components/child/access-invoice";
import { AccessPayDialog } from "@/components/child/access-pay-dialog";
import { AccessPeriodPicker } from "@/components/child/access-period-picker";

/**
 * The unlock screen — what a family sees instead of their child's record when
 * the portal access fee is unpaid.
 *
 * ★ This is the reason the API answers **402** here and 404 everywhere else.
 * A 404 would be honest about nothing and actionable in no way; the person
 * reading this is the child's own guardian, already authorized, and the only
 * thing standing between them and the record is a payment they can make on
 * this screen. `docs/SECURITY.md` §5.4's indistinguishability rule is not
 * weakened by it — a stranger never reaches this component, because the API
 * checks authorization *before* the fee and answers them 404.
 *
 * ★★ It does not render the fee it thinks is owed from a local guess: the
 * amount comes from `GET /children/:id/access`, which reads the subscription
 * frozen at issue. A price change must not silently restate what a family was
 * already asked for.
 *
 * ★★★ The first payment chooses a term or the year too (2026-10-15, the user),
 * and shows what is being paid as a receipt before the QR — `AccessInvoice`.
 */
export function AccessGate({ childId }: { childId: string }) {
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");
  /*
    ★ A solo teacher meets this too (2026-10-11): in their own workspace a child
    is inactive until the family pays. They are told so — and are not offered
    the pay button, because teachers never pay.

    ★★ Without asking `/access` — 2026-10-17, the client: the screen "цайрч
    харагдаад … эвдэрсэн юм шиг". That route is a guardian's and the finance
    staff's (`assertCanViewFinance`); a solo teacher is TEACHER only and gets
    404 there, so the gate waited on it, found no answer and drew nothing. The
    402 that brought us here is the whole fact the teacher needs.
  */
  if (isStaff) return <UnpaidForStaff />;
  return <GuardianGate childId={childId} />;
}

/**
 * What a teacher sees for a child whose family has not paid the portal fee —
 * on the child's own pages and wherever a group screen names them.
 */
export function UnpaidForStaff({
  backHref = "/children",
}: {
  /** `null` where the page's own header already has one. */
  backHref?: string | null;
}) {
  return (
    <div className="mx-auto mt-4 flex w-full max-w-md flex-col gap-3">
      {backHref ? (
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="shrink-0 self-start border border-border-soft bg-surface text-ink shadow-none transition-colors hover:bg-primary-soft hover:text-primary sm:h-10 sm:w-10"
        >
          <Link href={backHref} aria-label="Буцах">
            <ChevronLeft size={22} strokeWidth={2.5} aria-hidden />
          </Link>
        </Button>
      ) : null}
      <Card className="flex flex-col gap-2 p-6 text-center">
        <h2 className="text-title text-ink">Төлбөр төлөгдөөгүй</h2>
        <p className="text-body text-muted">
          Энэ хүүхдийн эцэг эх хандалтын төлбөрөө төлөөгүй байна. Төлбөр төлөгдсөний дараа хүүхдийн
          бүртгэл, ажиглалт, судалгаа нээгдэнэ.
        </p>
        <p className="text-caption text-muted">
          Эцэг эхийг урьж амжаагүй бол «Суралцагч» хэсгээс урина уу.
        </p>
      </Card>
    </div>
  );
}

function GuardianGate({ childId }: { childId: string }) {
  const [period, setPeriod] = useState<AccessPeriod>("YEAR");
  const childName = useOwnChildName(childId, true);
  const status = useQuery({
    queryKey: qk.childAccess(childId),
    queryFn: () => get(`/children/${childId}/access`, accessStatusSchema),
  });

  if (status.isLoading) return <LoadingState rows={2} />;

  // The deployment does not charge, or this family has already paid. Either
  // way there is nothing to show — and the caller should not have rendered us.
  if (!status.data?.required || status.data.active) return null;

  const { amount, termAmount, subscription } = status.data;
  const year = subscription?.schoolYear.name;
  // Without a term price the year is the only choice, whatever was picked.
  const chosen: AccessPeriod = termAmount ? period : "YEAR";

  return (
    <div className="mx-auto mt-4 flex max-w-md flex-col gap-3">
      {/*
        ★ Back to «Нүүр» — 2026-10-15, the user. A link, not history: behind
        this screen is usually another of the child's pages, which is this
        gate again.
      */}
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="shrink-0 self-start border border-border-soft bg-surface text-ink shadow-none transition-colors hover:bg-primary-soft hover:text-primary sm:h-10 sm:w-10"
      >
        <Link href="/home" aria-label="Нүүр рүү буцах">
          <ChevronLeft size={22} strokeWidth={2.5} aria-hidden />
        </Link>
      </Button>

      <Card className="flex flex-col gap-4 p-6 text-center">
        <div className="flex flex-col gap-1">
          <h2 className="text-title text-ink">Хандалтын төлбөр</h2>
          <p className="text-body text-muted">
            Хүүхдийнхээ хөгжлийн бүртгэл, зураг, тайланг үзэхийн тулд хандалтын төлбөрөө улирлаар
            эсвэл жилээр төлнө үү.
          </p>
        </div>

        <AccessPeriodPicker
          value={chosen}
          onChange={setPeriod}
          termAvailable={Boolean(termAmount)}
        />
        {!termAmount ? (
          <p className="-mt-2 text-caption text-muted">Одоогоор зөвхөн жилээр төлөх боломжтой.</p>
        ) : null}

        <AccessInvoice
          className="text-left"
          data={{
            state: "due",
            childName,
            period: chosen,
            schoolYearName: year,
            amount: chosen === "YEAR" ? amount : (termAmount ?? null),
          }}
        />

        <AccessPayDialog
          key={chosen}
          childId={childId}
          period={chosen}
          onPaid={() => status.refetch()}
          trigger={<Button className="w-full">QPay-ээр төлөх</Button>}
        />

        <p className="text-caption text-muted">
          Төлбөр төлсний дараа хандалт шууд нээгдэнэ. Асуудал гарвал цэцэрлэгийн захиргаанд хандана
          уу.
        </p>
      </Card>
    </div>
  );
}
