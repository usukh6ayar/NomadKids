"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { financeBoardSchema, type FinanceBoard } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { YearMonthSelect } from "@/components/ui/year-month-select";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { money, monthLabel } from "@/components/finance/money";
import { cn } from "@/lib/utils";

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Нягтлангийн самбар — where an accountant lands after signing in.
 *
 * ★ **The rail's first row, above the sections.** The accountant's menu used to
 * open on "Санхүүжилт", a row that answered a narrower question than the
 * heading above it promised. This is the screen above it: what came in, what
 * went out, what is left over, and what needs a decision today. `/finance` is
 * unchanged and keeps its own name — every panel it had is still there.
 *
 * ★★ **Not a second copy of the §9 summary.** `FinanceDashboardPanel` still
 * renders inside `/finance` and still answers §9's question — how do this
 * month's funding and billing stand. This one adds the two halves §9 has no
 * figure for, income against expenditure, and both screens read the same
 * repository, so a number quoted on both cannot drift.
 *
 * ★★★ **Four figures in one card, then what needs attention** — the minimal
 * layout of 2026-10-06. See `Figures` and `Alerts`.
 */
export default function FinanceDashboardPage() {
  return (
    <RequireRole roles={["ACCOUNTANT", "ADMIN"]}>
      <FinanceBoardScreen />
    </RequireRole>
  );
}

function FinanceBoardScreen() {
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const [month, setMonth] = useState(thisMonth());

  const board = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.financeBoard(kindergartenId ?? "", month),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/finance/board?month=${month}`, financeBoardSchema),
  });

  /*
    ★ Minimal — client, 2026-10-06 ("нягтлан самбар … цэгцтэй, минимал"):
    no lede, and no «Санхүүжилт» / «Нэхэмжлэл» buttons — both are rows of the
    side menu one glance away. The month is the header's only control.
  */
  const header = (
    <PageHeader
      title="Самбар"
      actions={<YearMonthSelect value={month} onValueChange={setMonth} />}
    />
  );

  if (!kindergartenId) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState
          title="Цэцэрлэг холбогдоогүй байна"
          description="Таны эрх ямар нэг цэцэрлэгт холбогдоогүй байна. Удирдлагатайгаа холбогдоно уу."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header}

      {board.isLoading ? <LoadingState rows={3} /> : null}
      {board.isError ? (
        <ErrorState
          description={errorMessage(board.error)}
          action={
            <Button variant="secondary" onClick={() => void board.refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      ) : null}

      {board.data ? <Figures data={board.data} month={month} /> : null}
      {board.data ? <Alerts alerts={board.data.alerts} /> : null}
    </div>
  );
}

/**
 * The month's four figures, in one card.
 *
 * ★ One card split by hairlines, not four boxes, and no icons — client,
 * 2026-10-06 ("цэгцтэй, минимал"). Each figure is its name, the amount and
 * one line of what it is made of. Two by two on a phone, four across from
 * `lg`. The hairlines are the card's own colour showing through a 1px gap.
 *
 * ★★ No tone on any of them. There is no expenditure figure in this product,
 * so "ашигтай"/"алдагдалтай" is not a judgement this screen may make; colour
 * is kept for «Анхаарах зүйлс», where it means something.
 */
function Figures({ data, month }: { data: FinanceBoard; month: string }) {
  const pending = data.income.statePending;
  const hasPending = pending !== "0.00";

  return (
    <section aria-label={`${monthLabel(month)}-ын санхүүгийн тойм`}>
      <Card pad="none" className="overflow-hidden">
        <dl className="grid grid-cols-2 gap-px bg-border-soft lg:grid-cols-4">
          <BoardStat
            label="Нийт орлого"
            value={money(data.income.total)}
            detail={`Эцэг эх ${money(data.income.parents)} · Улс ${money(data.income.state)}`}
          />
          <BoardStat
            label="Улсаас хүлээгдэж буй"
            value={money(pending)}
            detail={hasPending ? "Батлагдсан, шилжээгүй" : "Бүрэн шилжсэн"}
          />
          <BoardStat
            label="Төлөгдөөгүй төлбөр"
            value={money(data.unpaid.amount)}
            detail={
              data.unpaid.overdueCount > 0
                ? `Хугацаа хэтэрсэн ${money(data.unpaid.overdueAmount)}`
                : `${data.unpaid.invoices} нэхэмжлэл · ${data.unpaid.children} хүүхэд`
            }
          />
          <BoardStat
            label="Хоолны зардал"
            value={money(data.meals.total)}
            /*
              ★ Says what it is derived from. This is `daysFed × dailyRate` out
              of the funding register — a cost to serve, computed whether or
              not a supplier has been paid — and not money observed leaving an
              account.
            */
            detail={
              data.meals.children > 0
                ? `Нэг хүүхдэд ${money(data.meals.perChild)} · ${data.meals.fedDays} өдөр`
                : "Хоолны бүртгэл алга"
            }
          />
        </dl>
      </Card>
    </section>
  );
}

/**
 * One figure: its name, the amount, and what it is made of.
 *
 * ★ Proportional figures, not `tabular-nums`: tabular gives every digit the
 * width of a `0`, which lines up a column and makes a large standalone number
 * look loose. Columns align; headline figures do not have to.
 */
function BoardStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-3 py-3 sm:px-4">
      <dt className="truncate text-caption text-muted">{label}</dt>
      <dd className="truncate text-lead font-bold leading-tight text-ink">{value}</dd>
      <dd className="text-caption leading-snug text-muted">{detail}</dd>
    </div>
  );
}

/**
 * «Анхаарах зүйлс» — one plain card, a line each.
 *
 * ★ Colour on a dot only — client, 2026-10-06. Each alert was a tinted card
 * of its own; now the dot says which kind (peach: act on it, sky: worth
 * knowing) and the row stays white, so two alerts no longer read as a band
 * of paint. Nothing at all when there is nothing to attend to (2026-09-17).
 */
function Alerts({ alerts }: { alerts: FinanceBoard["alerts"] }) {
  if (alerts.length === 0) return null;

  return (
    <section aria-labelledby="finance-alerts-heading" className="flex flex-col gap-1.5">
      <h2 id="finance-alerts-heading" className="text-caption font-semibold text-muted">
        Анхаарах зүйлс
      </h2>
      <Card pad="none" className="divide-y divide-border-soft overflow-hidden">
        {alerts.map((alert) => (
          <Link
            key={alert.key}
            href={alert.href}
            className="flex min-h-[52px] items-center gap-3 px-3 py-2.5 hover:bg-canvas sm:px-4"
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-pill",
                alert.tone === "warn" ? "bg-peach-solid" : "bg-sky-ink",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-ink">{alert.title}</span>
              <span className="block text-caption text-muted">{alert.detail}</span>
            </span>
            <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted" />
          </Link>
        ))}
      </Card>
    </section>
  );
}
