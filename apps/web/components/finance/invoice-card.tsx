"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { INVOICE_STATUS_LABEL, type InvoiceStatus, type InvoiceSummary } from "@kinder/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { money, monthLabel } from "./money";

/**
 * The tone each invoice status carries.
 *
 * ★ Colour reinforces, never signals — `Badge` renders the Mongolian label
 * regardless, so a parent who cannot distinguish the peach from the mint still
 * reads "Төлөгдөөгүй". The map exists so one status is not amber on one screen
 * and red on the next.
 */
const STATUS_TONE: Record<InvoiceStatus, "mint" | "sun" | "peach" | "neutral"> = {
  PAID: "mint",
  PARTIALLY_PAID: "sun",
  UNPAID: "sun",
  OVERDUE: "peach",
  REFUNDED: "neutral",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{INVOICE_STATUS_LABEL[status]}</Badge>;
}

/**
 * One invoice, as a row in the family's list.
 *
 * ★ The month leads, not the invoice number. A parent thinks "2-р сарын
 * төлбөр"; the number is what they quote to a bank, so it is present but
 * secondary.
 */
export function InvoiceCard({ invoice }: { invoice: InvoiceSummary }) {
  return (
    <Card pad="none" className="overflow-hidden">
      <Link
        href={`/invoices/${invoice.id}`}
        className="flex items-center gap-4 p-4 transition-colors hover:bg-canvas"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-semibold text-ink">{monthLabel(invoice.month)}</span>
            <InvoiceStatusBadge status={invoice.status} />
          </div>
          <p className="mt-1 truncate text-caption text-muted">№ {invoice.number}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-body font-semibold text-ink">{money(invoice.totalAmount)}</p>
          {invoice.dueDate && (
            <p className="mt-0.5 text-caption text-muted">
              {new Date(invoice.dueDate).toLocaleDateString("mn-MN")}-нд
            </p>
          )}
        </div>

        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
      </Link>
    </Card>
  );
}
