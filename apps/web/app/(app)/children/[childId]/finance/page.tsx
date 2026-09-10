"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { BackButton } from "@/components/ui/back-button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildInvoices } from "@/components/child/child-invoices";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { useSession } from "@/lib/auth/session";

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
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  if (child.isLoading) return <LoadingState rows={4} />;

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
      <BackButton href={`/children/${childId}/general`} />

      {/*
        ★ Staff only, 2026-09-09 — see assessments/page.tsx's note. Still
        shown to a teacher, which is what keeps this page's own 404-not-403
        reasoning true above: a teacher sees the header and gets 404 from the
        invoice list, never a 403 that would leak whether a record exists.
      */}
      {isStaff ? <ChildHeroProfile child={data} /> : null}

      <ChildInvoices childId={childId} />
    </div>
  );
}
