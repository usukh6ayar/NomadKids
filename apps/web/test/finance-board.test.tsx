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

    /*
      ★ The four are the register's own card since 2026-09-17 — the client
      asked for the board to read as the invoice screen does. "Төлбөр төлөх
      ёстой хүүхэд" folded into the unpaid tile's own detail line, and the
      state's pending transfer took the fourth place: it is money, and a count
      of children was the one tile here that was not.
    */
    expect(await screen.findByText("Энэ сарын нийт орлого")).toBeInTheDocument();
    expect(screen.getByText("Улсаас хүлээгдэж буй")).toBeInTheDocument();
    expect(screen.getByText("Төлөгдөөгүй төлбөр")).toBeInTheDocument();
    expect(screen.getByText("Хоолны зардал")).toBeInTheDocument();
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

    /* The tile names both halves of what arrived, and the pending transfer
       has a figure of its own beside it. */
    expect(await screen.findByText(/Эцэг эх 0₮ · Улс 600 000₮/)).toBeInTheDocument();
    const pending = screen.getByText("Улсаас хүлээгдэж буй").closest("[data-ui='card']")!;
    expect(within(pending as HTMLElement).getByText("200 000₮")).toBeInTheDocument();
    expect(within(pending as HTMLElement).getByText("Батлагдсан, шилжээгүй")).toBeInTheDocument();
  });

  it("names the invoices and the children behind the unpaid figure", async () => {
    stub();
    renderWithProviders(<FinanceDashboardPage />);

    const tile = (await screen.findByText("Төлөгдөөгүй төлбөр")).closest("[data-ui='card']")!;
    // Both counts, on the tile's own detail line rather than in a tile of
    // their own — the count of children was never money.
    expect(within(tile as HTMLElement).getByText(/12 нэхэмжлэл · 4 хүүхэд/)).toBeInTheDocument();
  });

  it("prices the meals per child who ate, and says how many days", async () => {
    stub();
    renderWithProviders(<FinanceDashboardPage />);

    expect(await screen.findByText(/Нэг хүүхдэд 30 000₮ · 220 өдөр/)).toBeInTheDocument();
  });

  /**
   * ★ Nothing at all when there is nothing to attend to — 2026-09-17, at the
   * client's request. The block used to print "Анхаарах зүйл алга" under its
   * own heading; a section that says only its own name is noise, and the
   * presence of this one is the signal.
   */
  it("draws no attention block when there is nothing to attend to", async () => {
    stub();
    renderWithProviders(<FinanceDashboardPage />);

    await screen.findByText("Энэ сарын нийт орлого");
    expect(screen.queryByText("Анхаарах зүйлс")).not.toBeInTheDocument();
    expect(screen.queryByText(/Анхаарах зүйл алга/)).not.toBeInTheDocument();
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
