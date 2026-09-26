"use client";

import { useQuery } from "@tanstack/react-query";
import { FUNDING_SOURCE_LABEL, mealCostSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Card, SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { TONE_CARD, TONE_INK, type Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";
import { money } from "./money";

/**
 * «Хоолны зардал эх үүсвэрээр» — `нэмэлт.md` §3, 2026-09-26.
 *
 * «Хүүхдийн тоо × хооллосон өдөр × тухайн үеийн тариф», one tile per source
 * the client named. The figures are the month's calculation summed over its
 * meal-priced rows, so they agree with the register below by construction.
 *
 * ★ Four tiles always. A source nothing paid for reads «0₮»; a tile that
 * disappeared would read as a source nobody had thought about.
 */
const TONE: Record<string, Tone> = {
  STATE: "sky",
  PARENT: "peach",
  KINDERGARTEN: "mint",
  OTHER: "cornflower",
};

export function MealCostBySource({
  kindergartenId,
  month,
}: {
  kindergartenId: string;
  month: string;
}) {
  const cost = useQuery({
    queryKey: ["funding", kindergartenId, "meal-cost", month],
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/funding/meal-cost?month=${month}`, mealCostSchema),
    enabled: Boolean(kindergartenId),
  });

  return (
    <section aria-labelledby="meal-cost-heading">
      <SectionHeader
        id="meal-cost-heading"
        title="Хоолны зардал эх үүсвэрээр"
        lede="Хүүхдийн тоо × хооллосон өдөр × тариф — сарын тооцооноос."
        action={
          cost.data ? (
            <span className="text-body font-semibold tabular-nums text-ink">
              Нийт {money(cost.data.total)}
            </span>
          ) : null
        }
      />

      {cost.isLoading ? <LoadingState rows={2} /> : null}
      {cost.isError ? <ErrorState description={errorMessage(cost.error)} /> : null}

      {cost.data ? (
        <ul
          aria-label="Хоолны зардал эх үүсвэрээр"
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          {cost.data.sources.map((row) => {
            const tone = TONE[row.source] ?? "sky";
            return (
              <li key={row.source}>
                <Card pad="compact" className={cn("h-full", TONE_CARD[tone])}>
                  <p className={cn("text-body font-medium", TONE_INK[tone])}>
                    {FUNDING_SOURCE_LABEL[row.source] ?? row.source}
                  </p>
                  <p className="mt-1 text-title font-semibold tabular-nums text-ink">
                    {money(row.amount)}
                  </p>
                  <p className={cn("mt-1 text-caption", TONE_INK[tone])}>
                    {row.children} хүүхэд · {row.daysFed} хооллосон өдөр
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
