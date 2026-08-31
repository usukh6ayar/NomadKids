"use client";

import { useQuery } from "@tanstack/react-query";
import { FUNDING_SOURCE_LABEL, childFinanceSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Card, SectionHeader } from "@/components/ui/card";
import { money, monthLabel } from "./money";

/**
 * A child's balance and — for finance staff only — their funding history.
 * `нэмэлт.md` §10.
 *
 * ★ The state funding section renders **only when the API sent it**. It is
 * omitted from a guardian's payload entirely (see `FinanceDashboardService`),
 * so `funding === undefined` is an authorization outcome rather than an empty
 * month. Rendering "Түүх алга" for a parent would tell them a section exists
 * that they are not allowed to see, which is worse than silence.
 *
 * ★★ Fails quietly. This sits above the invoice list on a page a parent opens
 * to pay a bill; a red error box because a summary aggregate timed out would
 * make the page look broken while the thing they came for still works.
 */
export function ChildFinanceSummary({ childId }: { childId: string }) {
  const finance = useQuery({
    queryKey: qk.childFinance(childId),
    queryFn: () => get(`/children/${childId}/finance`, childFinanceSchema),
    retry: false,
  });

  if (!finance.data) return null;

  const data = finance.data;
  const inCredit = data.balance.startsWith("-");

  return (
    <div className="flex flex-col gap-4">
      <Card pad="roomy" tone={inCredit ? "mint" : undefined}>
        <p className="text-body-sm text-muted">{inCredit ? "Илүү төлсөн" : "Нийт үлдэгдэл"}</p>
        <p className="mt-1 text-h2 font-semibold text-ink">
          {/*
            An overpayment is shown as a positive credit rather than a negative
            debt: "−10 000₮ үлдэгдэл" reads as an error, "10 000₮ илүү төлсөн"
            reads as the fact it is.
          */}
          {money(inCredit ? data.balance.slice(1) : data.balance)}
        </p>

        <dl className="mt-4 grid gap-2">
          <Row label="Нийт нэхэмжилсэн" value={money(data.billed)} />
          <Row label="Төлсөн" value={money(data.paid)} />
          {data.discounts !== "0.00" && <Row label="Хөнгөлөлт" value={money(data.discounts)} />}
        </dl>
      </Card>

      {data.funding && data.funding.length > 0 && (
        <section aria-labelledby="funding-history-heading">
          <SectionHeader
            id="funding-history-heading"
            title="Улсын санхүүжилтийн түүх"
            lede="Ирц, хоолны бүртгэлээс бодогдсон. Зөвхөн санхүүгийн ажилтанд харагдана."
          />
          <Card pad="none" className="overflow-hidden">
            <ul className="divide-y divide-border">
              {data.funding.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium text-ink">{monthLabel(row.month)}</p>
                    <p className="mt-0.5 text-caption text-muted">
                      {FUNDING_SOURCE_LABEL[row.source]}
                      {" · "}
                      {/*
                        §10's "Ирцэд үндэслэсэн тооцоо" — the working, not just
                        the answer. Which counter was used depends on the rule,
                        so the label follows `basis` rather than assuming.
                      */}
                      {row.basis === "MEALS"
                        ? `${row.daysFed} хооллосон өдөр`
                        : `${row.daysAttended} ирсэн өдөр`}
                      {row.dailyRate && ` × ${money(row.dailyRate)}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-body-sm font-medium text-ink">{money(row.calculated)}</p>
                    {row.received && (
                      <p className="mt-0.5 text-caption text-muted">орсон {money(row.received)}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-body-sm text-muted">{label}</dt>
      <dd className="text-body-sm font-medium text-ink">{value}</dd>
    </div>
  );
}
