"use client";

import { useQuery } from "@tanstack/react-query";
import { accessStatusSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { money } from "@/components/finance/money";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { AccessPayDialog } from "@/components/child/access-pay-dialog";

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
 */
export function AccessGate({ childId }: { childId: string }) {
  const status = useQuery({
    queryKey: qk.childAccess(childId),
    queryFn: () => get(`/children/${childId}/access`, accessStatusSchema),
  });

  if (status.isLoading) return <LoadingState rows={2} />;

  // The deployment does not charge, or this family has already paid. Either
  // way there is nothing to show — and the caller should not have rendered us.
  if (!status.data?.required || status.data.active) return null;

  const amount = status.data.amount;
  const year = status.data.subscription?.schoolYear.name;

  return (
    <Card className="mx-auto mt-6 flex max-w-md flex-col gap-4 p-6 text-center">
      <div className="flex flex-col gap-1">
        <h2 className="text-title text-ink">Хандалтын төлбөр</h2>
        <p className="text-body text-muted">
          Хүүхдийнхээ хөгжлийн бүртгэл, зураг, тайланг үзэхийн тулд
          {year ? ` ${year} оны хичээлийн жилийн` : ""} хандалтын төлбөрөө төлнө үү.
        </p>
      </div>

      {amount ? (
        <p className="text-headline text-ink" aria-label="Төлөх дүн">
          {money(amount)}
        </p>
      ) : null}

      <AccessPayDialog
        childId={childId}
        onPaid={() => status.refetch()}
        trigger={<Button className="w-full">QPay-ээр төлөх</Button>}
      />

      <p className="text-caption text-muted">
        Төлбөр төлсний дараа хандалт шууд нээгдэнэ. Асуудал гарвал цэцэрлэгийн захиргаанд хандана
        уу.
      </p>
    </Card>
  );
}
