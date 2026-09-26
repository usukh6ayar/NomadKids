import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MealCost } from "@kinder/contracts";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { MealCostBySource } from "@/components/finance/meal-cost";

/**
 * «Хоолны зардал эх үүсвэрээр» — `нэмэлт.md` §3, 2026-09-26.
 *
 * What this pins is the client's four sources, always all four, with the
 * month's total — a source with nothing shows nought rather than vanishing.
 */

const KINDERGARTEN = "33333333-3333-4333-8333-333333333333";

const COST: MealCost = {
  month: "2026-09",
  sources: [
    { source: "STATE", children: 10, daysFed: 84, amount: "268800.00" },
    { source: "PARENT", children: 10, daysFed: 84, amount: "126000.00" },
    { source: "KINDERGARTEN", children: 0, daysFed: 0, amount: "0.00" },
    { source: "OTHER", children: 0, daysFed: 0, amount: "0.00" },
  ],
  total: "394800.00",
};

describe("MealCostBySource", () => {
  it("shows every source, the empty ones as nought, and the month's total", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
      { path: `/kindergartens/${KINDERGARTEN}/funding/meal-cost`, body: COST },
    ]);
    renderWithProviders(<MealCostBySource kindergartenId={KINDERGARTEN} month="2026-09" />, {
      selectedChild: false,
    });

    const list = await screen.findByRole("list", { name: "Хоолны зардал эх үүсвэрээр" });
    const item = (label: RegExp) => within(list).getByText(label).closest("li")!;
    expect(item(/Улсын/)).toHaveTextContent("268 800₮");
    expect(item(/Эцэг эх/)).toHaveTextContent("126 000₮");
    expect(item(/Цэцэрлэг/)).toHaveTextContent("0₮");
    expect(item(/Бусад/)).toHaveTextContent("0₮");
    expect(screen.getByText(/394 800₮/)).toBeInTheDocument();
  });
});
