import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import FinanceDashboardPage from "@/app/(app)/finance/dashboard/page";

const KG_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
});

function board(overrides: Record<string, unknown> = {}) {
  return {
    month: "2026-03",
    income: {
      total: "1500000.00",
      parents: "900000.00",
      state: "600000.00",
      statePending: "0.00",
    },
    unpaid: {
      amount: "150000.00",
      invoices: 12,
      children: 4,
      overdueCount: 0,
      overdueAmount: "0.00",
    },
    meals: { total: "300000.00", perChild: "30000.00", children: 10, fedDays: 220 },
    alerts: [],
    ...overrides,
  };
}

/**
 * Нягтлангийн самбар — the accountant's landing screen.
 *
 * ★ These assert on the rendered Mongolian and the formatted amounts, which is
 * what an accountant reads. The arithmetic is proved by the API's own suite
 * (`apps/api/test/finance-board.test.ts`); this proves the screen shows it —
 * and, in two cases, that it shows the *right relationship* between figures,
 * which is the part a payload test cannot see.
 */
describe("the accountant's board", () => {
  function stub(body: Record<string, unknown> = board()) {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
      { path: `/kindergartens/${KG_ID}/finance/board`, body },
    ]);
  }

  it("names the four figures and the attention list", async () => {
    stub();
    renderWithProviders(<FinanceDashboardPage />);

    expect(await screen.findByText("Энэ сарын нийт орлого")).toBeInTheDocument();
    expect(screen.getByText("Төлөгдөөгүй төлбөр")).toBeInTheDocument();
    expect(screen.getByText("Төлбөр төлөх ёстой хүүхэд")).toBeInTheDocument();
    expect(screen.getByText("Хоолны зардал")).toBeInTheDocument();
    expect(screen.getByText("Анхаарах зүйлс")).toBeInTheDocument();
  });

  it("formats every amount rather than printing the raw decimal", async () => {
    stub();
    renderWithProviders(<FinanceDashboardPage />);

    expect(await screen.findByText("1 500 000₮")).toBeInTheDocument();
    expect(screen.getByText("150 000₮")).toBeInTheDocument();
    expect(screen.getByText("300 000₮")).toBeInTheDocument();
    expect(screen.queryByText("1500000.00")).not.toBeInTheDocument();
  });

  /**
   * ★ The distinction the hero card exists to make: income is money that
   * arrived, and funding the state has approved but not sent sits beside it.
   */
  it("says the income is what arrived, and names what is still pending", async () => {
    stub(
      board({
        income: {
          total: "600000.00",
          parents: "0.00",
          state: "600000.00",
          statePending: "200000.00",
        },
      }),
    );
    renderWithProviders(<FinanceDashboardPage />);

    expect(await screen.findByText(/Орсон дүн/)).toBeInTheDocument();
    expect(screen.getByText(/улсаас хүлээгдэж буй 200 000₮/)).toBeInTheDocument();
  });

  it("counts the children who owe, not the invoices", async () => {
    stub();
    renderWithProviders(<FinanceDashboardPage />);

    const tile = (await screen.findByText("Төлбөр төлөх ёстой хүүхэд")).closest(
      "[data-ui='card']",
    )!;
    expect(within(tile as HTMLElement).getByText("4")).toBeInTheDocument();
  });

  it("prices the meals per child who ate, and says how many days", async () => {
    stub();
    renderWithProviders(<FinanceDashboardPage />);

    expect(await screen.findByText(/Нэг хүүхдэд 30 000₮ · 220 хооллосон өдөр/)).toBeInTheDocument();
  });

  it("says so when there is nothing to attend to", async () => {
    stub();
    renderWithProviders(<FinanceDashboardPage />);

    expect(await screen.findByText(/Анхаарах зүйл алга/)).toBeInTheDocument();
  });

  /**
   * ★★ An alert names a problem *and* the screen that fixes it. One that only
   * named it would be a notification, not a dashboard.
   */
  it("links each alert at the screen that answers it", async () => {
    stub(
      board({
        alerts: [
          {
            key: "overdue",
            tone: "warn",
            title: "Хугацаа хэтэрсэн төлбөр",
            detail: "3 нэхэмжлэл, бүх сарын дүнгээр",
            href: "/invoices",
          },
        ],
      }),
    );
    renderWithProviders(<FinanceDashboardPage />);

    const link = await screen.findByRole("link", { name: /Хугацаа хэтэрсэн төлбөр/ });
    expect(link).toHaveAttribute("href", "/invoices");
  });
});
