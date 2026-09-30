"use client";

import {
  ArrowLeftRight,
  BarChart3,
  FileSpreadsheet,
  FileText,
  ScrollText,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { Art } from "@/components/ui/art";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import {
  AnnualTab,
  BalancesTab,
  FormsTab,
  InvoicingTab,
  TransactionsTab,
} from "@/components/finance/payment-tabs";
import { cn } from "@/lib/utils";

/**
 * Төлбөрийн нэгтгэл — the administrator's and the accountant's finance screen,
 * five tabs to the client's drawing of 2026-09-27.
 *
 * ★ Санхүүжилт is gone from this screen, at the client's instruction the same
 * day ("esis api ороогүй бол санхүүжилт гэсэнг хас"). It carried no ESIS
 * service — its two ESIS forms had already moved to Маягт — and half of it
 * repeated the tabs beside it: the §9 summary's parent figures are
 * Төлбөрийн нэхэмжлэл's, and its unpaid report is Төлбөрийн үлдэгдэл.
 *
 * What it alone held, and where that went:
 *   - the state-funding month run and register — still `/admin/funding`
 *     ("Ирц ба тооцоолол"), which already did the same job;
 *   - the tariff list, the state-funding, meal and variance reports, and the
 *     §9 summary panel — no longer on any screen. `FinanceReports` and
 *     `FinanceDashboardPanel` are kept, with their tests, so they can be put
 *     back without being rewritten.
 *
 * `?tab=` opens a tab directly.
 */
export default function FinancePage() {
  return (
    <RequireRole roles={["ACCOUNTANT", "ADMIN"]}>
      <Finance />
    </RequireRole>
  );
}

const TABS = [
  { key: "balance", label: "Төлбөрийн үлдэгдэл", icon: Wallet },
  { key: "invoicing", label: "Төлбөрийн нэхэмжлэл", icon: FileText },
  { key: "transactions", label: "Гүйлгээ", icon: ArrowLeftRight },
  { key: "annual", label: "Жилийн тайлан", icon: BarChart3 },
  { key: "forms", label: "Маягт", icon: FileSpreadsheet },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function Finance() {
  const { session } = useSession();
  const searchParams = useSearchParams();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const [active, setActive] = useState<TabKey>(
    () => TABS.find((t) => t.key === searchParams.get("tab"))?.key ?? "balance",
  );

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Төлбөрийн нэгтгэл"
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <Button asChild variant="secondary" size="sm">
              <Link href="/invoices">
                <Art name="finance" size={18} className="size-[18px]" />
                Нэхэмжлэл
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/finance/audit-log">
                <ScrollText size={16} aria-hidden="true" />
                Аудит
              </Link>
            </Button>
          </div>
        }
      />

      <div
        role="tablist"
        aria-label="Төлбөрийн нэгтгэл"
        className="flex gap-1 overflow-x-auto rounded-card border border-border bg-surface px-2"
      >
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active === key}
            onClick={() => setActive(key)}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-body font-medium whitespace-nowrap transition-colors",
              active === key
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            <Icon size={16} aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {kindergartenId && active === "balance" ? (
        <BalancesTab kindergartenId={kindergartenId} />
      ) : null}
      {kindergartenId && active === "invoicing" ? (
        <InvoicingTab kindergartenId={kindergartenId} />
      ) : null}
      {active === "transactions" ? <TransactionsTab /> : null}
      {kindergartenId && active === "annual" ? <AnnualTab kindergartenId={kindergartenId} /> : null}
      {kindergartenId && active === "forms" ? <FormsTab kindergartenId={kindergartenId} /> : null}
    </div>
  );
}
