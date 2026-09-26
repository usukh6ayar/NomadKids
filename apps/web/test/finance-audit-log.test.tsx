import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import FinancialAuditLogPage from "@/app/(app)/finance/audit-log/page";

/**
 * «Өмнөх утга → Шинэ утга» — нэмэлт.md §14, 2026-09-26.
 *
 * The log recorded before and after and then printed them as raw JSON under
 * English keys. §14 asks for the change to be readable by the accountant, so
 * what this pins is the table: a Mongolian field name, what it was, what it
 * became.
 */

const KINDERGARTEN = "33333333-3333-4333-8333-333333333333";

function entry(metadata: Record<string, unknown>) {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    action: "UPDATE",
    objectType: "FundingRule",
    objectId: "66666666-6666-4666-8666-666666666666",
    childId: null,
    actorUserId: null,
    actorLabel: "Нягтлан",
    metadata,
    createdAt: "2026-09-26T03:00:00.000Z",
  };
}

function render(metadata: Record<string, unknown>) {
  stubApi([
    { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
    {
      path: `/kindergartens/${KINDERGARTEN}/financial-audit-log`,
      body: { items: [entry(metadata)], total: 1, page: 1, pageSize: 25, totalPages: 1 },
    },
  ]);
  renderWithProviders(<FinancialAuditLogPage />);
}

describe("the financial audit log", () => {
  it("shows a change as field, before and after, in Mongolian", async () => {
    render({
      before: { name: "Энгийн тариф", dailyRate: "5000" },
      after: { name: "Шинэчилсэн тариф", dailyRate: "5000" },
    });

    const table = await screen.findByRole("table", { name: "Өмнөх → Шинэ утга" });
    const nameRow = within(table).getByText("Нэр").closest("tr")!;
    expect(nameRow).toHaveTextContent("Энгийн тариф");
    expect(nameRow).toHaveTextContent("Шинэчилсэн тариф");
    expect(within(table).getByText("Өдрийн тариф")).toBeInTheDocument();
    expect(screen.queryByText(/"before"/)).not.toBeInTheDocument();
  });

  it("writes a missing value as a dash, not as null", async () => {
    render({ before: { note: null }, after: { note: "Хугацаа сунгасан" } });

    const table = await screen.findByRole("table", { name: "Өмнөх → Шинэ утга" });
    const noteRow = within(table).getByText("Тайлбар").closest("tr")!;
    expect(noteRow).toHaveTextContent("—");
    expect(noteRow).not.toHaveTextContent("null");
  });
});
