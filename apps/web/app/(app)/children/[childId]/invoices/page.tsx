"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";
import { childDetailSchema, invoiceSummarySchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { ChildFinanceSummary } from "@/components/finance/child-finance-summary";
import { InvoiceCard } from "@/components/finance/invoice-card";
import { useSession } from "@/lib/auth/session";

const invoiceListSchema = paginated(invoiceSummarySchema);

/**
 * A child's invoices — `нэмэлт.md` §7, §10's "Санхүү" tab.
 *
 * ★ Reached from the parent home grid's Санхүү tile, which was a
 * `ComingSoonTile` until this page existed. CLAUDE.md §7 kept finance in a
 * later phase; the client moved it into scope on 2026-08-31, which is what
 * makes the tile a link.
 *
 * ★★ Deliberately **not** the accountant's screen. `/finance` is the
 * kindergarten's whole ledger and lives behind `RequireRole`; this is one
 * family's own bills, authorized on the child. The API refuses a teacher
 * either way (`нэмэлт.md` §13) — a teacher following a stale link gets the
 * error state below rather than a blank page, because the query fails with a
 * 404 rather than returning an empty list.
 */
export default function ChildInvoicesPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  const invoices = useQuery({
    queryKey: qk.childInvoices(childId),
    queryFn: () => get(`/children/${childId}/invoices`, invoiceListSchema),
  });

  if (child.isLoading || invoices.isLoading) return <LoadingState rows={4} />;

  if (child.isError) {
    return (
      <div className="py-6">
        <ErrorState description={errorMessage(child.error)} />
      </div>
    );
  }

  const data = child.data!;
  const items = invoices.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6 py-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/home">
          <ArrowLeft size={18} />
          Нүүр
        </Link>
      </Button>

      <ChildHeroProfile child={data} showHealthAlert={isStaff} />

      {invoices.isError ? (
        <ErrorState description={errorMessage(invoices.error)} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Wallet size={24} aria-hidden="true" />}
          title="Нэхэмжлэл алга"
          description="Цэцэрлэг төлбөрийн нэхэмжлэл үүсгэсний дараа энд харагдана."
        />
      ) : (
        <>
          {/*
            ★ `нэмэлт.md` §10's summary — the balance, what has been billed and
            paid, the discounts, and (finance staff only) the state funding
            history. It replaced a card that summed the page's own rows: that
            figure only ever covered the invoices on screen, so a family with
            more than one page of history was quoted a balance that was too
            small. This one is a running total the API computes over every
            issued invoice.
          */}
          <ChildFinanceSummary childId={childId} />

          <section aria-labelledby="invoices-heading">
            <SectionHeader id="invoices-heading" title="Нэхэмжлэл" />
            <div className="flex flex-col gap-3">
              {items.map((invoice) => (
                <InvoiceCard key={invoice.id} invoice={invoice} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
