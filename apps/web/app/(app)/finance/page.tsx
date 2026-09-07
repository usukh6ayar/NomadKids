"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, ChevronRight, Receipt, ScrollText } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import {
  FUNDING_SOURCE_LABEL,
  fundingMonthSchema,
  fundingRuleSchema,
  type FundingSource,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { FinanceDashboardPanel } from "@/components/finance/finance-dashboard";
import { FinanceReports } from "@/components/finance/finance-reports";
import { formatDate } from "@/lib/format";

const rulesSchema = z.array(fundingRuleSchema);

/** `"126900.00"` → `"126 900₮"`, formatted from the string — never parsed. */
function money(value: string | null): string {
  if (!value) return "—";
  const [whole = "0", cents] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return cents && cents !== "00" ? `${grouped}.${cents}₮` : `${grouped}₮`;
}

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Санхүүжилт — one kindergarten's own money.
 *
 * ★ 832 lines of API with no screen, until now.
 *
 * `/kindergartens/:id/funding` shipped with `нэмэлт.md` §4–§6: tariffs, the
 * monthly calculation run from the attendance and meal registers, and what the
 * state approved and actually paid. Nothing rendered any of it.
 *
 * ★★ Not `/platform/revenue`, and the difference is the whole point of the
 * accountant role. That screen is the operator's income across every
 * kindergarten and carries no per-child anything. This one names children,
 * because reconciling a transfer means knowing who was funded for how many
 * days — and `assertCanReadFinance` keeps it to the two roles whose job that
 * is.
 *
 * ★★★ **Rearranged 2026-09-02, on the client's report that it was too much
 * at once.** It used to paint seven blocks with equal weight — тойм, totals,
 * the run button, a hundred per-child rows, eight reports and the tariff list
 * — leaving the accountant to work out which of them was their job today. It
 * now opens on one question ("энэ сарын тооцоо хийгдсэн үү") and the button
 * that answers it, then the §9 summary. The register, the reports and the
 * tariffs are all still here and are all one press away; none of them is work
 * that happens on every visit.
 *
 * Nothing about **what** is fetched or **who** may read it changed: the
 * payloads, `assertCanReadFinance` and §10's rule that a guardian never
 * receives `funding` are all untouched. This is layout.
 */
export default function FinancePage() {
  return (
    <RequireRole roles={["ACCOUNTANT", "ADMIN"]}>
      <Finance />
    </RequireRole>
  );
}

function Finance() {
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const [month, setMonth] = useState(thisMonth());

  const funding = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.kindergartenFunding(kindergartenId ?? "", month),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/funding?month=${month}`, fundingMonthSchema),
  });

  const rules = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.fundingRules(kindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${kindergartenId}/funding/rules`, rulesSchema),
  });

  const items = funding.data?.items ?? [];
  const totals = funding.data?.totals ?? [];

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Санхүүжилт"
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <Button asChild variant="secondary" size="sm">
              <Link href="/invoices">
                <Receipt size={16} aria-hidden="true" />
                Нэхэмжлэл
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/finance/audit-log">
                <ScrollText size={16} aria-hidden="true" />
                Аудит
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

      {funding.isLoading ? <LoadingState rows={3} /> : null}
      {funding.isError ? <ErrorState description={errorMessage(funding.error)} /> : null}

      {/*
        ★ The month's one action, above everything that reports on it.

        An accountant opening this screen has exactly one recurring job — run
        the month once the registers are complete — and it used to sit fourth,
        below two summaries that are both blank until it has been pressed.
      */}
      {kindergartenId && funding.data ? (
        <RunMonth
          kindergartenId={kindergartenId}
          month={month}
          hasRules={(rules.data ?? []).length > 0}
          done={totals.length > 0}
          children_={totals.reduce((sum, total) => sum + total.children, 0)}
        />
      ) : null}

      {/*
        ★★ The §9 dashboard. It loads independently: a slow aggregate must not
        hold up the register, and a failing one must not blank the screen.
      */}
      {kindergartenId ? (
        <FinanceDashboardPanel kindergartenId={kindergartenId} month={month} />
      ) : null}

      {/*
        ★★★ Everything below opens closed.

        Each is real work, and none of it is *this visit's* work. The register
        is what a transfer is reconciled against — needed on the day a payment
        lands, not on the day the month is run. The reports are produced from a
        month that is already right. The tariffs are read-only reference.
      */}
      {funding.data ? (
        <Disclosure
          title="Хүүхэд тус бүрээр"
          hint={items.length > 0 ? `${items.length} мөр` : "Тооцоо хийгдээгүй"}
          disabled={items.length === 0}
        >
          <div className="flex flex-col gap-4">
            <Totals totals={totals} />
            <MonthRows items={items} />
          </div>
        </Disclosure>
      ) : null}

      {kindergartenId ? (
        <Disclosure title="Тайлан" hint="Excel, PDF">
          <FinanceReports kindergartenId={kindergartenId} />
        </Disclosure>
      ) : null}

      <Disclosure title="Тариф" hint={rules.data ? `${rules.data.length} дүрэм` : undefined}>
        <Rules rules={rules} />
      </Disclosure>
    </div>
  );
}

/**
 * A section that opens on demand.
 *
 * ★ A native `<details>`, not a scripted accordion. It opens with no
 * JavaScript, the browser gives it the right ARIA for free, and — the reason
 * that matters here — the browser's own "find in page" expands it to reveal a
 * match inside. An accountant searching a hundred-row register for one child's
 * name is a real thing to do, and a `useState` accordion silently fails it.
 *
 * ★★ `disabled` renders the row without a toggle rather than as a `<details>`
 * that opens onto nothing. "Тооцоо хийгдээгүй" beside it says why, which is
 * the same information the empty panel would have carried and one press
 * cheaper — CLAUDE.md §5, an empty state says what to do next.
 */
function Disclosure({
  title,
  hint,
  disabled = false,
  children,
}: {
  title: string;
  hint?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <Card pad="roomy" className="flex items-center justify-between gap-3">
        <span className="text-lead font-semibold text-faint">{title}</span>
        {hint ? <span className="text-caption text-muted">{hint}</span> : null}
      </Card>
    );
  }

  return (
    <details className="group rounded-card border border-border bg-surface">
      <summary className="flex min-h-[60px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={18}
          aria-hidden="true"
          className="shrink-0 text-muted transition-transform group-open:rotate-90"
        />
        <span className="flex-1 text-lead font-semibold text-ink">{title}</span>
        {hint ? <span className="shrink-0 text-caption text-muted">{hint}</span> : null}
      </summary>
      <div className="border-t border-border-soft px-4 py-4">{children}</div>
    </details>
  );
}

/**
 * The month's totals, one card per funding source.
 *
 * Тооцсон → Баталгаажсан → Орж ирсэн, in the order money actually moves. The
 * gap between the first and the last is the accountant's real question.
 */
function Totals({ totals }: { totals: z.infer<typeof fundingMonthSchema>["totals"] }) {
  if (totals.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {totals.map((total) => (
        <Card key={total.source} pad="roomy" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-lead font-semibold text-ink">
              {FUNDING_SOURCE_LABEL[total.source]}
            </h3>
            <span className="text-caption text-muted">{total.children} хүүхэд</span>
          </div>
          <dl className="flex flex-col gap-1">
            <Row label="Тооцсон" value={total.calculated} />
            <Row label="Баталгаажсан" value={total.approved} />
            <Row label="Орж ирсэн" value={total.received} accent />
          </dl>
        </Card>
      ))}
    </div>
  );
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-caption text-muted">{label}</dt>
      <dd
        className={`text-body font-semibold tabular-nums ${accent ? "text-primary" : "text-ink"}`}
      >
        {money(value)}
      </dd>
    </div>
  );
}

/**
 * Running the month.
 *
 * ★ It recalculates from the registers every time and supersedes the previous
 * run rather than overwriting it — `replaceMonth` soft-deletes the old rows so
 * a figure somebody already submitted stays traceable. That is why this is a
 * button an accountant may press twice without fear, and why the label changes
 * to "Дахин тооцох" rather than the button disappearing once it is done.
 */
function RunMonth({
  kindergartenId,
  month,
  hasRules,
  done,
  children_,
}: {
  kindergartenId: string;
  month: string;
  hasRules: boolean;
  done: boolean;
  /** How many children the month's rows cover — the one figure that says the
   * run actually did something. Trailing underscore: `children` is React's. */
  children_: number;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [source, setSource] = useState<FundingSource>("STATE");

  const run = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/funding/calculate`, z.unknown(), {
        method: "POST",
        body: { month, source },
      }),
    onSuccess: () => {
      toast.success("Сарын тооцоо гүйцэтгэлээ.");
      void queryClient.invalidateQueries({
        queryKey: qk.kindergartenFunding(kindergartenId, month),
      });
      /*
       * ★ The dashboard reads the same calculations, so it goes stale the
       * moment they are re-run. Without this, an accountant presses "Тооцоолох"
       * and watches the register update while the summary above it keeps
       * showing the previous month's figures — which reads as the two
       * disagreeing about the money.
       */
      void queryClient.invalidateQueries({
        queryKey: qk.financeDashboard(kindergartenId, month),
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lead font-semibold text-ink">Энэ сарын тооцоо</h2>
        {done ? (
          <Badge tone="mint">Хийгдсэн · {children_} хүүхэд</Badge>
        ) : (
          <Badge tone="neutral">Хийгдээгүй</Badge>
        )}
      </div>

      <p className="text-body text-muted">
        {done
          ? "Ирц, хоолны бүртгэл өөрчлөгдсөн бол дахин тооцоолоорой. Өмнөх тооцоо архивт үлдэнэ."
          : "Ирц болон хоолны бүртгэлээс хүүхэд тус бүрийн дүнг бодно."}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Эх үүсвэр">
          {({ id }) => (
            <Select
              id={id}
              value={source}
              onChange={(event) => setSource(event.target.value as FundingSource)}
              className="w-[180px]"
            >
              {Object.entries(FUNDING_SOURCE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Button disabled={run.isPending || !hasRules} onClick={() => run.mutate()}>
          <Calculator size={16} aria-hidden="true" />
          {run.isPending ? "Бодож байна…" : done ? "Дахин тооцох" : "Сарын тооцоо хийх"}
        </Button>
      </div>

      {/*
        The API answers "Энэ сард хүчинтэй санхүүжилтийн дүрэм алга" with a 400.
        Saying it before the press is the same information, one round trip
        earlier — and it names the fix.
      */}
      {!hasRules ? (
        <p className="text-caption text-muted">
          Эхлээд тариф үүсгэнэ үү — доорх “Тариф” хэсгээс харна.
        </p>
      ) : null}
    </Card>
  );
}

/** Per child, which is what a transfer is reconciled against. */
function MonthRows({ items }: { items: z.infer<typeof fundingMonthSchema>["items"] }) {
  if (items.length === 0) return null;

  /*
    Sorted by child, then by source. The API orders by `child.lastName`, which
    already interleaves the two sources per child — but only because both rows
    share a name. Making it explicit keeps the pairing when a child is funded
    from one source and not the other.
  */
  const sorted = [...items].sort(
    (a, b) =>
      `${a.child.lastName ?? ""}${a.child.firstName}`.localeCompare(
        `${b.child.lastName ?? ""}${b.child.firstName}`,
      ) || a.source.localeCompare(b.source),
  );

  return (
    <Card className="divide-y divide-border-soft">
      {sorted.map((item) => (
        <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            {/*
              ★ The source is on the row, not only in the totals above.

              A child appears once per funding source — the state pays a
              subsidy and the family pays a fee for the same fourteen days —
              so without this badge the list reads as each name duplicated at
              two different rates, which is exactly what it looked like the
              first time this screen rendered real data.
            */}
            <p className="flex flex-wrap items-center gap-2">
              <span className="truncate text-body font-medium text-ink">
                {item.child.lastName ? `${item.child.lastName} ` : ""}
                {item.child.firstName}
              </span>
              <Badge tone="sky">{FUNDING_SOURCE_LABEL[item.source]}</Badge>
            </p>
            <p className="text-caption text-muted">
              {item.daysAttended} хоног ирсэн
              {item.dailyRate ? ` · ${money(item.dailyRate)}/хоног` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-baseline gap-4 tabular-nums">
            <span className="text-caption text-muted">{money(item.calculatedAmount)}</span>
            <span className="text-body font-semibold text-primary">
              {money(item.receivedAmount)}
            </span>
          </div>
        </div>
      ))}
    </Card>
  );
}

/**
 * The tariffs.
 *
 * ★ Read-only here, deliberately.
 *
 * A rate cannot be edited at all — `updateFundingRuleSchema` accepts only a
 * name, an end date and a note, because a month's calculation is evidence of
 * the rate it was billed under. Creating one is an administrative act with six
 * fields and its own validation; this screen shows what is in force so the
 * accountant can see *why* a figure came out as it did, which is the question
 * they actually have when a transfer does not match.
 */
function Rules({ rules }: { rules: ReturnType<typeof useQuery<z.infer<typeof rulesSchema>>> }) {
  return (
    <>
      {rules.isLoading ? <LoadingState rows={2} /> : null}

      {rules.data && rules.data.length === 0 ? (
        <EmptyState
          title="Тариф үүсгээгүй байна"
          description="Санхүүжилтийн дүрэмгүйгээр сарын тооцоо хийгдэхгүй. Удирдлагын хэсгээс үүсгэнэ."
        />
      ) : null}

      {rules.data && rules.data.length > 0 ? (
        <Card className="divide-y divide-border-soft">
          {rules.data.map((rule) => (
            <div
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-body font-medium text-ink">{rule.name}</span>
                  <Badge tone="sky">{FUNDING_SOURCE_LABEL[rule.source]}</Badge>
                  {rule.effectiveTo ? <Badge tone="neutral">Дууссан</Badge> : null}
                </p>
                <p className="text-caption text-muted">
                  {formatDate(rule.effectiveFrom)}
                  {rule.effectiveTo ? ` — ${formatDate(rule.effectiveTo)}` : " — одоог хүртэл"}
                </p>
              </div>
              <span className="shrink-0 text-body font-semibold tabular-nums text-ink">
                {rule.dailyRate
                  ? `${money(rule.dailyRate)}/хоног`
                  : money(rule.monthlyRate ?? null)}
              </span>
            </div>
          ))}
        </Card>
      ) : null}
    </>
  );
}
