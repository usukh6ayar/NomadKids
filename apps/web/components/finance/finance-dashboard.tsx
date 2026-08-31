"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import {
  FUNDING_SOURCE_LABEL,
  financeDashboardSchema,
  type FinanceDashboard,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Card, SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { money } from "./money";

/**
 * The month's money, in one screen — `нэмэлт.md` §9.
 *
 * ★ Three groups, in the order an accountant asks about them: what the state
 * owes us, what families owe us, what the meals cost. §9 lists nine figures as
 * a flat bullet list; rendering them as nine identical tiles would make
 * "Хүлээгдэж буй санхүүжилт" and "Төлөгдөөгүй дүн" look like the same kind of
 * number, and they are owed by different people under different rules.
 *
 * ★★ Overdue gets its own tinted card rather than a tile. It is the only
 * figure here that is not about the selected month — arrears carry forward —
 * and the only one that is a call to action rather than a report.
 */
export function FinanceDashboardPanel({
  kindergartenId,
  month,
}: {
  kindergartenId: string;
  month: string;
}) {
  const dashboard = useQuery({
    queryKey: qk.financeDashboard(kindergartenId, month),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/invoices/dashboard?month=${month}`,
        financeDashboardSchema,
      ),
  });

  if (dashboard.isLoading) return <LoadingState rows={2} />;
  if (dashboard.isError) return <ErrorState description={errorMessage(dashboard.error)} />;

  const data = dashboard.data!;

  return (
    <section aria-labelledby="finance-dashboard-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="finance-dashboard-heading"
        title="Санхүүгийн тойм"
        lede="Ирц, хоол, нэхэмжлэлээс автоматаар нэгтгэв."
      />

      {data.parents.overdueCount > 0 && <OverdueCard parents={data.parents} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Group
          title="Улсын санхүүжилт"
          rows={[
            { label: "Баталгаажсан", value: data.state.approved },
            { label: "Хүлээн авсан", value: data.state.received },
            { label: "Хүлээгдэж буй", value: data.state.pending, emphasis: true },
          ]}
          footer={`${data.state.children} хүүхэд`}
        />

        <Group
          title="Эцэг эхийн төлбөр"
          rows={[
            { label: "Нийт нэхэмжилсэн", value: data.parents.billed },
            { label: "Төлөгдсөн", value: data.parents.paid },
            { label: "Төлөгдөөгүй", value: data.parents.unpaid, emphasis: true },
          ]}
          footer={`${data.parents.invoices} нэхэмжлэл`}
        />

        <Group
          title="Хоолны зардал"
          rows={[
            { label: "Нийт", value: data.meals.total },
            { label: "Нэг хүүхдэд", value: data.meals.perChild, emphasis: true },
          ]}
          footer={
            data.meals.children > 0
              ? `${data.meals.children} хүүхэд · ${data.meals.fedDays} хооллосон өдөр`
              : "Хоолны бүртгэл алга"
          }
        />
      </div>

      {data.meals.bySource.length > 0 && (
        <Card pad="roomy">
          <h3 className="text-body-sm font-medium text-ink">Хоолны зардал, эх үүсвэрээр</h3>
          <dl className="mt-3 grid gap-2">
            {data.meals.bySource.map((row) => (
              <div key={row.source} className="flex items-center justify-between gap-4">
                <dt className="text-body-sm text-muted">{FUNDING_SOURCE_LABEL[row.source]}</dt>
                <dd className="text-body-sm font-medium text-ink">{money(row.amount)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </section>
  );
}

/**
 * The overdue call-out.
 *
 * ★ Says "бүх сарын" explicitly, because every other figure on this screen is
 * scoped to the selected month and this one is not. Without the word, an
 * accountant switching months would read a constant number as a bug.
 */
function OverdueCard({ parents }: { parents: FinanceDashboard["parents"] }) {
  return (
    <Card pad="roomy" tone="peach" className="flex items-start gap-3">
      <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-peach-ink" />
      <div>
        <p className="text-body font-semibold text-ink">
          Хугацаа хэтэрсэн төлбөр: {money(parents.overdueAmount)}
        </p>
        <p className="mt-1 text-body-sm text-muted">
          {parents.overdueCount} нэхэмжлэл, бүх сарын дүнгээр.
        </p>
      </div>
    </Card>
  );
}

function Group({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: { label: string; value: string; emphasis?: boolean }[];
  footer: string;
}) {
  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <h3 className="text-lead font-semibold text-ink">{title}</h3>

      <dl className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-body-sm text-muted">{row.label}</dt>
            <dd
              className={
                row.emphasis
                  ? "text-lead font-semibold text-ink"
                  : "text-body-sm font-medium text-ink"
              }
            >
              {money(row.value)}
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-caption text-muted">{footer}</p>
    </Card>
  );
}
