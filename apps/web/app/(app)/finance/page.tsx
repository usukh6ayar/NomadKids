"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Receipt, ScrollText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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
import { Card, SectionHeader } from "@/components/ui/card";
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

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Санхүүжилт"
        lede="Сарын тооцоо, тариф. Ирц болон хоолны бүртгэлээс автоматаар бодогдоно."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <Button asChild variant="secondary" size="sm">
              <Link href="/invoices">
                <Receipt size={16} aria-hidden="true" />
                Эцэг эхийн нэхэмжлэл
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

      {/*
        ★ The dashboard leads — `нэмэлт.md` §9. It answers "how is the month
        going" from the same rows the register below prices child by child, so
        it is the summary of what follows rather than a second source. It loads
        independently: a slow aggregate must not hold up the register, and a
        failing one must not blank the screen.
      */}
      {kindergartenId ? (
        <FinanceDashboardPanel kindergartenId={kindergartenId} month={month} />
      ) : null}

      {funding.isLoading ? <LoadingState rows={3} /> : null}
      {funding.isError ? <ErrorState description={errorMessage(funding.error)} /> : null}

      {funding.data ? (
        <>
          <Totals totals={funding.data.totals} />
          {kindergartenId ? (
            <RunMonth
              kindergartenId={kindergartenId}
              month={month}
              hasRules={(rules.data ?? []).length > 0}
            />
          ) : null}
          <MonthRows items={funding.data.items} />
        </>
      ) : null}

      {/*
        ★ §16's reports sit below the register rather than above it. The
        register is the month's working document — the thing an accountant
        opens daily and reconciles against — and the reports are what they
        produce from it once it is right.
      */}
      {kindergartenId ? <FinanceReports kindergartenId={kindergartenId} /> : null}

      <Rules rules={rules} />
    </div>
  );
}

/**
 * The month's totals, one card per funding source.
 *
 * Тооцсон → Баталгаажсан → Орж ирсэн, in the order money actually moves. The
 * gap between the first and the last is the accountant's real question.
 */
function Totals({ totals }: { totals: z.infer<typeof fundingMonthSchema>["totals"] }) {
  if (totals.length === 0) {
    return (
      <Card pad="roomy">
        <p className="text-body text-muted">
          Энэ сарын тооцоо хийгдээгүй байна. Доорх товчоор гүйцэтгэнэ.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {totals.map((total) => (
        <Card key={total.source} pad="roomy" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lead font-semibold text-ink">
              {FUNDING_SOURCE_LABEL[total.source]}
            </h2>
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
 * button an accountant may press twice without fear.
 */
function RunMonth({
  kindergartenId,
  month,
  hasRules,
}: {
  kindergartenId: string;
  month: string;
  hasRules: boolean;
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
    <Card pad="roomy" className="flex flex-wrap items-end gap-3">
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
        {run.isPending ? "Бодож байна…" : "Сарын тооцоо хийх"}
      </Button>

      {/*
        The API answers "Энэ сард хүчинтэй санхүүжилтийн дүрэм алга" with a 400.
        Saying it before the press is the same information, one round trip
        earlier — and it names the fix.
      */}
      {!hasRules ? <p className="text-caption text-muted">Эхлээд доор тариф үүсгэнэ үү.</p> : null}
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
    <section aria-labelledby="rows-heading">
      <SectionHeader id="rows-heading" title="Хүүхэд тус бүрээр" />
      <Card className="divide-y divide-border-soft">
        {sorted.map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
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
    </section>
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
    <section aria-labelledby="rules-heading">
      <SectionHeader id="rules-heading" title="Тариф" lede="Хүчинтэй санхүүжилтийн дүрмүүд." />

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
    </section>
  );
}
