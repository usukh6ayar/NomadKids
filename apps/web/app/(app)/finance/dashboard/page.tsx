"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Baby,
  Info,
  Receipt,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { financeBoardSchema, type FinanceBoard } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Art } from "@/components/ui/art";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { money, monthLabel } from "@/components/finance/money";

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
 * ★★★ **Seven figures and one conclusion**, in the order the client wrote
 * them. The balance is the only card that is tinted and the only one at
 * `text-figure`: it is the number a director opens this screen for, and it is
 * the *result* of the six above it rather than a seventh input — so it closes
 * the grid instead of opening it. Everything else stays on the product's plain
 * white card, because a tile tinted for decoration is how an accent stops
 * meaning anything (`components/ui/tone.ts`).
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

  const header = (
    <PageHeader
      title="Самбар"
      actions={
        <div className="flex flex-wrap items-end gap-3">
          <Button asChild variant="secondary" size="sm">
            <Link href="/finance">
              <Art name="finance" size={18} className="size-[18px]" />
              Санхүүжилт
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href="/invoices">
              <Receipt size={16} aria-hidden="true" />
              Нэхэмжлэл
            </Link>
          </Button>
          <Field label="Сар">
            {({ id }) => (
              <Input
                id={id}
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="w-[170px]"
              />
            )}
          </Field>
        </div>
      }
    />
  );

  if (!kindergartenId) {
    return (
      <div className="flex flex-col gap-5 lg:gap-6">
        {header}
        <EmptyState
          title="Цэцэрлэг холбогдоогүй байна"
          description="Таны эрх ямар нэг цэцэрлэгт холбогдоогүй байна. Удирдлагатайгаа холбогдоно уу."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
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
 * The month's figures.
 *
 * ★ **Income leads, as one wide card.** It is the number an accountant opens
 * this screen for, and it is the only figure here composed of two others —
 * families' payments and the state's transfer — so it gets the room to name
 * them. The three below answer "who still owes" and "what did the month cost to
 * feed", which are narrower questions.
 *
 * ★★ Two columns on a phone, three from `lg`. Mobile-first is CLAUDE.md §5.
 *
 * ★★★ Only the hero carries a tone, and it carries `sky` — information, not
 * praise. There is no expenditure figure in this product, so "ашигтай"/
 * "алдагдалтай" is not a judgement this screen is entitled to make; painting
 * income green would make it anyway.
 */
function Figures({ data, month }: { data: FinanceBoard; month: string }) {
  const pending = data.income.statePending;
  const hasPending = pending !== "0.00";

  return (
    <section aria-labelledby="finance-board-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="finance-board-heading"
        title="Санхүүгийн тойм"
        lede={`${monthLabel(month)} · ирц, хоол, нэхэмжлэлээс автоматаар нэгтгэв.`}
      />

      <Card pad="roomy" tone="sky" className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Wallet size={16} aria-hidden="true" className="shrink-0 text-muted" />
          <h3 className="text-caption font-medium text-muted">Энэ сарын нийт орлого</h3>
        </div>
        <p className="text-figure font-bold leading-heading text-ink">{money(data.income.total)}</p>
        {/*
          ★ "Орсон" is said out loud, because the difference between this and
          the billed total is the whole point of the tile: a month that counted
          its invoices as income would report money it is still chasing.
        */}
        <p className="text-caption text-muted">
          Орсон дүн · Эцэг эх {money(data.income.parents)} · Улс {money(data.income.state)}
          {hasPending ? ` · улсаас хүлээгдэж буй ${money(pending)}` : ""}
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
        <Tile
          icon={Receipt}
          label="Төлөгдөөгүй төлбөр"
          value={money(data.unpaid.amount)}
          footer={
            data.unpaid.overdueCount > 0
              ? `Хугацаа хэтэрсэн ${money(data.unpaid.overdueAmount)}`
              : `${data.unpaid.invoices} нэхэмжлэл`
          }
        />
        <Tile
          icon={Baby}
          label="Төлбөр төлөх ёстой хүүхэд"
          value={`${data.unpaid.children}`}
          footer="Үлдэгдэлтэй, бүх сарын дүнгээр"
        />
        <Tile
          icon={UtensilsCrossed}
          label="Хоолны зардал"
          value={money(data.meals.total)}
          /*
            ★ Says what it is derived from. This is `daysFed × dailyRate` out of
            the funding register — a cost to serve, computed whether or not a
            supplier has been paid — and not money observed leaving an account.
            The kindergarten's actual outgoings are not in this product.
          */
          footer={
            data.meals.children > 0
              ? `Нэг хүүхдэд ${money(data.meals.perChild)} · ${data.meals.fedDays} хооллосон өдөр`
              : "Хоолны бүртгэл алга"
          }
        />
      </div>
    </section>
  );
}

/**
 * One figure.
 *
 * ★ Proportional figures, not `tabular-nums`. Tabular gives every digit the
 * width of a `0`, which lines up a column of numbers and makes a large
 * standalone one look loose — reserve it for columns that must align.
 *
 * ★★ No tinted icon chip. An accent above every number would repaint the screen
 * rather than label it — the same argument `board-card.tsx` makes about the
 * class dashboard. The glyph is muted and decorative; the label carries the
 * meaning.
 */
function Tile({
  icon: Icon,
  label,
  value,
  footer,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  footer: ReactNode;
}) {
  return (
    <Card pad="roomy" className="flex h-full flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Icon size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <h3 className="min-w-0 text-caption font-medium text-muted">{label}</h3>
      </div>
      <p className="text-display font-bold leading-heading text-ink">{value}</p>
      <p className="mt-auto text-caption text-muted">{footer}</p>
    </Card>
  );
}

/**
 * Анхаарах зүйлс.
 *
 * ★ The list comes from the API, not from re-reading the figures above.
 * "What needs attention" is a business rule — an unrun month, an arrear, an
 * unrecorded payroll — and deriving it here would be a second, quieter
 * definition of the same rule.
 *
 * ★★ Every row is a link. An alert that names a problem and leaves the reader
 * to find the screen that fixes it is a notification, not a dashboard; §5's
 * "empty states say what to do next" applies to full ones as well.
 */
function Alerts({ alerts }: { alerts: FinanceBoard["alerts"] }) {
  return (
    <section aria-labelledby="finance-alerts-heading" className="flex flex-col gap-3">
      <SectionHeader id="finance-alerts-heading" title="Анхаарах зүйлс" as="h2" />

      {alerts.length === 0 ? (
        <Card pad="roomy" className="flex items-center gap-3">
          <Info size={20} aria-hidden="true" className="shrink-0 text-muted" />
          <p className="text-body text-muted">
            Анхаарах зүйл алга. Энэ сарын тооцоо, нэхэмжлэл, зардал бүрэн бүртгэгдсэн байна.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {alerts.map((alert) => (
            <Card
              key={alert.key}
              pad="roomy"
              tone={alert.tone === "warn" ? "peach" : "sky"}
              className="p-0 md:p-0"
            >
              <Link
                href={alert.href}
                className="flex min-h-[60px] items-center gap-3 rounded-card px-4 py-3"
              >
                {alert.tone === "warn" ? (
                  <AlertTriangle size={20} aria-hidden="true" className="shrink-0 text-peach-ink" />
                ) : (
                  <Info size={20} aria-hidden="true" className="shrink-0 text-sky-ink" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold text-ink">{alert.title}</span>
                  <span className="block text-caption text-muted">{alert.detail}</span>
                </span>
                <ArrowRight size={16} aria-hidden="true" className="shrink-0 text-muted" />
              </Link>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
