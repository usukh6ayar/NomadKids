"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, ScrollText } from "lucide-react";
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
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { Art } from "@/components/ui/art";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
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
 * `"2026-02"` → `"2026-02-28"`, as a string.
 *
 * ★ Compared as text, never as `Date`. ISO dates sort correctly as strings, so
 * this avoids parsing a bare calendar day into a `Date` — which is where a
 * timezone offset turns a rule that starts on the 1st into one that starts the
 * previous evening.
 */
function endOfMonth(month: string): string {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, index, 0));
  return last.toISOString().slice(0, 10);
}

/**
 * The calendar day out of whatever the API sent.
 *
 * ★ `FundingRule.effectiveFrom` is a `@db.Date` and reaches the browser as a
 * full instant — `"2026-02-28T00:00:00.000Z"`, not `"2026-02-28"`. Compared as
 * text against a bare `"2026-02-28"` the longer string sorts *after* it, so a
 * tariff starting on the last day of the month read as not yet in force and
 * the run button greyed out on a month the API would have calculated happily.
 * Ten characters is the whole fix, and it is why this is a named function
 * rather than an inline `<=`.
 */
const day = (value: string) => value.slice(0, 10);

/**
 * The screen's source filter: one of the four, or every one of them.
 *
 * ★ "ALL" is a UI state, not a `FundingSource`. The API expresses "every
 * source" by the query parameter being absent, and inventing a fifth enum
 * member here to mean the same thing would put a value on the wire that the
 * server has no rule for.
 */
type SourceFilter = FundingSource | "ALL";

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
  /*
    ★ The screen's working source — "ALL" until an accountant narrows it.

    It used to be local state inside `RunMonth`, where it named the source the
    button would calculate and nothing else. The register below and the totals
    beside it ignored it entirely, so a control labelled "Эх үүсвэр" changed
    nothing visible until the button was pressed — reported 2026-09-09 as
    "ажиллахгүй байна", and fairly.

    Now it is the page's: it scopes what the register lists, what the totals
    add up, and what the button runs. One control, one meaning.
  */
  const [source, setSource] = useState<SourceFilter>("ALL");

  const funding = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.kindergartenFunding(kindergartenId ?? "", month, source),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/funding?month=${month}` +
          (source === "ALL" ? "" : `&source=${source}`),
        fundingMonthSchema,
      ),
  });

  const rules = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.fundingRules(kindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${kindergartenId}/funding/rules`, rulesSchema),
  });

  const items = funding.data?.items ?? [];
  const totals = funding.data?.totals ?? [];

  /*
    ★★ "Is there a tariff to bill under, for what is selected?" — asked here
    rather than by pressing the button and reading a 400.

    A rule is in force for a month when it started on or before the month's last
    day and has not been closed before it. `sourcesInForce` on the API applies
    exactly this test; the button would otherwise offer to run a source the
    server is about to refuse.
  */
  const monthEnd = endOfMonth(month);
  const rulesInForce = (rules.data ?? []).filter(
    (rule) =>
      day(rule.effectiveFrom) <= monthEnd &&
      (!rule.effectiveTo || day(rule.effectiveTo) >= monthEnd),
  );
  const hasRules =
    source === "ALL"
      ? rulesInForce.length > 0
      : rulesInForce.some((rule) => rule.source === source);

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Санхүүжилт"
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <Badge tone="peach">ESIS finance API · NOT ENABLED</Badge>
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
            {/*
              ★ Beside the month, because it is the same kind of control: both
              say which slice of the ledger this screen is about. It sat inside
              the "Энэ сарын тооцоо" card, where it looked like a filter and
              behaved like an argument to one button.
            */}
            <Field label="Эх үүсвэр">
              {({ id }) => (
                <Select
                  id={id}
                  value={source}
                  onChange={(event) => setSource(event.target.value as SourceFilter)}
                  className="w-[170px]"
                >
                  <option value="ALL">Бүгд</option>
                  {Object.entries(FUNDING_SOURCE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
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
          source={source}
          hasRules={hasRules}
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
          /*
            ★ The active source is named in the hint, because this section is
            closed by default: a filter whose only visible effect is inside a
            collapsed panel is a filter nobody can see working.
          */
          hint={
            items.length > 0
              ? `${items.length} мөр${source === "ALL" ? "" : ` · ${FUNDING_SOURCE_LABEL[source]}`}`
              : source === "ALL"
                ? "Тооцоо хийгдээгүй"
                : `${FUNDING_SOURCE_LABEL[source]} — тооцоо хийгдээгүй`
          }
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

      {/*
        ★ The ministry's own food-income statements — 2026-09-09, at the
        client's request ("хоолны төвлөрүүлэх орлого маягт 1, 2").

        Маягт 1 is the month in one row: how many children, how many carry the
        livelihood discount, what is owed and what came in. Маягт 2 is the same
        month broken to a child at a time, with the days each attended. They sit
        under Тариф because that is the order the figures are built in — the
        rate, then what the month made of it.

        ★★ Both are read-only here. The catalog carries a `save` for each, and
        neither is wired: filing a return is a decision an accountant makes
        against their own ledger, and this screen is not yet the thing that
        files it.
      */}
      <EsisDataPanel
        resource="livelihoodForm1"
        title="Хоолны төвлөрүүлэх орлого — маягт 1"
        description="Сарын нэгдсэн дүн: сурагчийн тоо, төвлөрүүлэх ба төвлөрүүлсэн орлого"
      />
      <EsisDataPanel
        resource="livelihoodForm2"
        title="Хоолны төвлөрүүлэх орлого — маягт 2"
        description="Бүлгийн хүүхэд тус бүрийн ирц, төлөх ба төлсөн дүн"
      />
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
  source,
  hasRules,
  done,
  children_,
}: {
  kindergartenId: string;
  month: string;
  /** The screen's filter. "ALL" runs every source that has a tariff in force. */
  source: SourceFilter;
  hasRules: boolean;
  done: boolean;
  /** How many children the month's rows cover — the one figure that says the
   * run actually did something. Trailing underscore: `children` is React's. */
  children_: number;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const run = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/funding/calculate`, z.unknown(), {
        method: "POST",
        // ★ The key is omitted for "Бүгд", not sent as a sentinel: the API
        // reads an absent `source` as "every source with a tariff in force".
        body: source === "ALL" ? { month } : { month, source },
      }),
    onSuccess: () => {
      toast.success(
        source === "ALL"
          ? "Бүх эх үүсвэрийн сарын тооцоо гүйцэтгэлээ."
          : `${FUNDING_SOURCE_LABEL[source]} эх үүсвэрийн тооцоо гүйцэтгэлээ.`,
      );
      /*
       * ★ The month's prefix, not this filter's exact key. A run for "Бүгд"
       * rewrites every source's rows, and an accountant who then switches the
       * filter must not be shown what that view read before the press.
       */
      void queryClient.invalidateQueries({
        queryKey: qk.kindergartenFundingMonth(kindergartenId, month),
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

      {/*
        ★ No source picker here any more — the page header carries it, and this
        button follows it. Two controls named "Эх үүсвэр" on one screen, one
        filtering and one arming a button, is the confusion this card created.

        The sentence below names what will run, so the header's selection is
        legible from the button rather than only from the control that set it.
      */}
      <p className="text-caption text-muted">
        {source === "ALL"
          ? "Тариф хүчинтэй бүх эх үүсвэрээр тооцно."
          : `${FUNDING_SOURCE_LABEL[source]} эх үүсвэрээр тооцно.`}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <Button disabled={run.isPending || !hasRules} onClick={() => run.mutate()}>
          <Calculator size={16} aria-hidden="true" />
          {run.isPending ? "Бодож байна…" : done ? "Дахин тооцох" : "Сарын тооцоо хийх"}
        </Button>
      </div>

      {/*
        The API answers "Энэ сард хүчинтэй санхүүжилтийн дүрэм алга" with a 400.
        Saying it before the press is the same information, one round trip
        earlier — and it names the fix.

        ★ Scoped to the selection: a kindergarten with a state tariff and no
        parent tariff must be told that *this* source has none, not that it has
        no tariffs at all.
      */}
      {!hasRules ? (
        <p className="text-caption text-muted">
          {source === "ALL"
            ? "Энэ сард хүчинтэй тариф алга — доорх “Тариф” хэсгээс үүсгэнэ үү."
            : `${FUNDING_SOURCE_LABEL[source]} эх үүсвэрт энэ сард хүчинтэй тариф алга — доорх “Тариф” хэсгээс үүсгэнэ үү.`}
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
