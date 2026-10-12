import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import PlatformRevenuePage from "@/app/(app)/platform/revenue/page";

/*
 * ★ The platform's income is two sources since 2026-10-12 — access fees and
 * teaching-material sales (the user's decision) — and the shares are taken
 * from their sum.
 */
afterEach(() => vi.unstubAllGlobals());

const operator = () => {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
};

describe("the operator's revenue screen", () => {
  it("shows the total and each of the two incomes", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/partners", body: [] },
      {
        path: "/platform/revenue/distribution",
        body: {
          month: "2026-10",
          accessFees: "15000.00",
          accessPayments: 3,
          materialSales: "8000.00",
          materialPayments: 2,
          total: "23000.00",
          allocatedPercent: "0",
          unallocated: "23000.00",
          shares: [],
        },
      },
      {
        path: "/platform/revenue",
        body: {
          month: "2026-10",
          kindergartens: [],
          state: { calculated: "0.00", approved: "0.00", received: "0.00" },
          platform: {
            accessFees: "15000.00",
            accessPayments: 3,
            materialSales: "8000.00",
            materialPayments: 2,
            total: "23000.00",
          },
        },
      },
    ]);
    renderWithProviders(<PlatformRevenuePage />);

    const card = (await screen.findByText("Платформын орлого")).parentElement!;
    expect(within(card).getByText("23 000₮")).toBeInTheDocument();
    expect(within(card).getByText("15 000₮")).toBeInTheDocument();
    expect(within(card).getByText("3 төлөлт")).toBeInTheDocument();
    expect(within(card).getByText("Материалын борлуулалт")).toBeInTheDocument();
    expect(within(card).getByText("8 000₮")).toBeInTheDocument();
    expect(within(card).getByText("2 худалдан авалт")).toBeInTheDocument();
  });
});
