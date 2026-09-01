"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound, isPaymentRequired } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildInvoices } from "@/components/child/child-invoices";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { AccessGate } from "@/components/child/access-gate";

/**
 * A specific child's invoices, payment history and balance — нэмэлт.md §7,
 * §10's finance tab narrowed to the parent-facing half (state funding stays
 * on `/admin/funding`; that is a different ledger for a different audience).
 *
 * ★ No `@Roles`/`RequireRole` — the same reasoning `/menu` and
 * `ChildInvoicesController` both give. `RequireRole` is UX only
 * (`require-role.tsx`'s own comment); the real gate is
 * `ChildAccessService.assertCanViewFinance` on the API, which admits this
 * child's guardian, an admin or an accountant and refuses a teacher even
 * though a teacher may read the rest of this child's record — §13. A
 * teacher who reaches this URL sees the child's header (a different
 * authorization scope) and a 404 where the invoice list would be, never a
 * 403 — CLAUDE.md §1.7.
 */
export default function ChildFinancePage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  if (child.isLoading) return <LoadingState rows={4} />;

  /*
   * ★ 402 before the generic error branch, and it is the only status handled
   * this way. `assertCanAccess` answers 402 when this child's guardian has not
   * paid the portal access fee — they are the right person asking about the
   * right child, so unlike every other refusal there is something they can do,
   * and `AccessGate` is what offers it. A stranger never reaches here: the API
   * checks authorization first and answers them 404.
   */
  if (child.isError && isPaymentRequired(child.error)) {
    return <AccessGate childId={childId} />;
  }

  if (child.isError) {
    return (
      <div className="py-6">
        <ErrorState
          title={isNotFound(child.error) ? "Олдсонгүй" : "Алдаа гарлаа"}
          description={
            isNotFound(child.error) ? "Энэ хүүхдийн мэдээлэл олдсонгүй." : errorMessage(child.error)
          }
        />
      </div>
    );
  }

  const data = child.data!;

  return (
    <div className="flex flex-col gap-6 py-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/children/${childId}/general`}>
          <ArrowLeft size={18} />
          Хүүхдийн бүртгэл
        </Link>
      </Button>

      <ChildHeroProfile child={data} />

      <ChildInvoices childId={childId} />
    </div>
  );
}
