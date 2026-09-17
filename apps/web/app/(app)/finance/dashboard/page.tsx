"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Info,
  Landmark,
  Receipt,
  UtensilsCrossed,
  Wallet,
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
import { cn } from "@/lib/utils";
import { Field } from "@/components/ui/field";
import { MonthSelect } from "@/components/ui/month-select";
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
      lede="Сарын орлого, төлөгдөөгүй төлбөр, хоолны зардлыг нэг дор харах"
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
              <MonthSelect id={id} value={month} onValueChange={setMonth} className="w-[170px]" />
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
    /*
      ★ No "Санхүүгийн тойм" heading — 2026-09-17, at the client's request.

      The screen is called Самбар and the four cards are the whole of what it
      shows, so a heading over them named the page a second time. The month it
      carried is on the page header's own lede instead, where the month picker
      that changes it already is.
    */
    <section aria-label={`${monthLabel(month)}-ын санхүүгийн тойм`} className="flex flex-col gap-4">
      {/*
        ★★★★ Four tiles across, in the accountant's own register shape —
        2026-09-17, the client: "нягтлан самбар хэсэг ийм болго."

        It was one wide tinted hero over three plain cards, which is two
        designs for four figures and put the月's most-quoted number in a
        different visual language from every other number this role reads.
        Same card, same chip, same "figure over its own detail" as
        `/invoices` — so the board and the register read as one product.

        The tones still mean what `tone.ts` says: sky for information, mint for
        money received, sun for what is still owed, peach for attention.
      */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BoardStat
          label="Энэ сарын нийт орлого"
          value={money(data.income.total)}
          detail={`Эцэг эх ${money(data.income.parents)} · Улс ${money(data.income.state)}`}
          tone="sky"
          icon={<Wallet size={20} aria-hidden="true" />}
        />
        <BoardStat
          label="Улсаас хүлээгдэж буй"
          value={money(pending)}
          detail={hasPending ? "Батлагдсан, шилжээгүй" : "Бүрэн шилжсэн"}
          tone="mint"
          icon={<Landmark size={20} aria-hidden="true" />}
        />
        <BoardStat
          label="Төлөгдөөгүй төлбөр"
          value={money(data.unpaid.amount)}
          detail={
            data.unpaid.overdueCount > 0
              ? `Хугацаа хэтэрсэн ${money(data.unpaid.overdueAmount)}`
              : `${data.unpaid.invoices} нэхэмжлэл · ${data.unpaid.children} хүүхэд`
          }
          tone="sun"
          icon={<Receipt size={20} aria-hidden="true" />}
        />
        <BoardStat
          label="Хоолны зардал"
          value={money(data.meals.total)}
          /*
            ★ Says what it is derived from. This is `daysFed × dailyRate` out of
            the funding register — a cost to serve, computed whether or not a
            supplier has been paid — and not money observed leaving an account.
          */
          detail={
            data.meals.children > 0
              ? `Нэг хүүхдэд ${money(data.meals.perChild)} · ${data.meals.fedDays} өдөр`
              : "Хоолны бүртгэл алга"
          }
          tone="peach"
          icon={<UtensilsCrossed size={20} aria-hidden="true" />}
        />
      </div>
    </section>
  );
}

/**
 * One of the board's four figures — the register's card, in the same shape
 * `/invoices` draws (2026-09-17).
 *
 * ★ White, with the tone on a 40px chip. Four tinted panels across the head of
 * a screen is a band of paint; the chip carries the same meaning in a tenth of
 * the area, and the figure keeps the card's own ink.
 *
 * ★★ Proportional figures, not `tabular-nums`: tabular gives every digit the
 * width of a `0`, which lines up a column and makes a large standalone number
 * look loose. Columns align; headline figures do not have to.
 */
function BoardStat({
  label,
  value,
  detail,
  tone,
  icon,
}: {
  label: string;
  value: string;
  detail: ReactNode;
  tone: "sky" | "mint" | "sun" | "peach";
  icon: ReactNode;
}) {
  const chips = {
    sky: "bg-sky text-sky-ink",
    mint: "bg-mint text-mint-ink",
    sun: "bg-sun text-sun-ink",
    peach: "bg-peach text-peach-ink",
  } as const;

  return (
    <Card pad="compact" className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={cn("grid size-10 shrink-0 place-items-center rounded-card", chips[tone])}
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-medium text-muted">{label}</span>
        <span className="mt-0.5 block truncate text-title font-bold leading-none text-ink">
          {value}
        </span>
        <span className="mt-1 block text-caption leading-snug text-muted">{detail}</span>
      </span>
    </Card>
  );
}

function Alerts({ alerts }: { alerts: FinanceBoard["alerts"] }) {
  /*
    ★ Nothing at all when there is nothing to attend to — 2026-09-17, at the
    client's request that the "Анхаарах зүйл алга" sentence go.

    The heading went with it rather than standing over an empty space: a
    section that says only its own name is the same noise the sentence was.
    The whole point of this block is that its presence means something.
  */
  if (alerts.length === 0) return null;

  return (
    <section aria-labelledby="finance-alerts-heading" className="flex flex-col gap-3">
      <SectionHeader id="finance-alerts-heading" title="Анхаарах зүйлс" as="h2" />

      {alerts.length === 0 ? null : (
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
