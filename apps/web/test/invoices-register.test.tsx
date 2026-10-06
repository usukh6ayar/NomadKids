import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import InvoicesPage from "@/app/(app)/invoices/page";

/**
 * «Нэхэмжлэл», minimal — client, 2026-10-06 ("маш минимал цэгцтэй … хэт
 * олон сонголт"): the status chips, one search with «Шүүлтүүр» and an Excel
 * icon beside it, one line of money, and four columns.
 */

const KG = "33333333-3333-4333-8333-333333333333";

const bucket = (count: number, billed: string, outstanding: string) => ({
  count,
  billed,
  outstanding,
});

const SUMMARY = {
  month: "2026-10",
  total: 3,
  billed: "570000.00",
  outstanding: "240000.00",
  byStatus: {
    UNPAID: bucket(1, "190000.00", "190000.00"),
    PARTIALLY_PAID: bucket(1, "190000.00", "40000.00"),
    PAID: bucket(1, "190000.00", "0.00"),
    OVERDUE: bucket(0, "0.00", "0.00"),
    REFUNDED: bucket(0, "0.00", "0.00"),
  },
};

const INVOICE = {
  id: "66666666-6666-4666-8666-666666666666",
  number: "НЭ-0001",
  month: "2026-10",
  baseAmount: "150000",
  mealAmount: "40000",
  extraAmount: "0",
  discountAmount: "0",
  previousBalance: "0",
  totalDue: "190000",
  paidAmount: "0",
  balance: "190000",
  dueDate: "2026-10-25",
  status: "UNPAID",
  note: null,
  child: {
    id: "22222222-2222-4222-8222-222222222222",
    lastName: "Бат",
    firstName: "Сараа",
    group: { id: "44444444-4444-4444-8444-444444444444", name: "Дэлбээ" },
  },
  createdAt: "2026-10-01T02:00:00.000Z",
};

function stub(items: unknown[] = [INVOICE]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
    // Before the list: the stubs match by prefix.
    { path: `/kindergartens/${KG}/invoices/summary`, body: SUMMARY },
    {
      path: `/kindergartens/${KG}/invoices?`,
      body: { items, page: 1, pageSize: 25, total: items.length, totalPages: 1 },
    },
    { path: "/groups", body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 } },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the invoice register, minimal", () => {
  it("keeps the chips, one money line and four columns, and drops the rest", async () => {
    stub();
    renderWithProviders(<InvoicesPage />);

    const table = await screen.findByRole("table", { name: "Нэхэмжлэлийн жагсаалт" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["№", "Хүүхэд", "Дүн", "Төлөв"]);
    const row = within(table).getByText("НЭ-0001").closest("tr")!;
    expect(within(row).getByText("Бат Сараа")).toBeInTheDocument();
    // The group sits under the name now.
    expect(within(row).getByText("Дэлбээ")).toBeInTheDocument();
    expect(within(row).getByText("190 000₮")).toBeInTheDocument();

    // Quiet text tabs, not boxed chips (2026-10-06).
    const tab = screen.getByRole("tab", { name: "Төлөгдөөгүй 1" });
    expect(tab.className).not.toMatch(/rounded-pill|\bborder-border\b/);
    expect(screen.getByRole("tab", { name: "Бүгд 3" })).toHaveAttribute("aria-selected", "true");
    // Unpaid 190 000 + part-paid 40 000 still owed.
    expect(screen.getByText("230 000₮")).toBeInTheDocument();

    // Gone: the four tiles, the lede, the page-size picker, two columns.
    expect(screen.queryByText("Нийт нэхэмжлэл")).toBeNull();
    expect(screen.queryByLabelText("Хуудсанд харуулах тоо")).toBeNull();
    expect(screen.queryByText("Үүсгэсэн")).toBeNull();
    expect(screen.queryByText("Төлбөрийн төрөл")).toBeNull();
    expect(screen.getByRole("link", { name: "Excel татах" })).toBeInTheDocument();
    // The month as two small pickers, not «2026 оны 10-р сар».
    expect(screen.getByLabelText("Он")).toBeInTheDocument();
    expect(screen.getByLabelText("Сар")).toBeInTheDocument();
  });

  it("folds Бүлэг and Төлбөрийн төрөл behind «Шүүлтүүр»", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<InvoicesPage />);

    const toggle = await screen.findByRole("button", { name: /Шүүлтүүр/ });
    expect(screen.queryByLabelText("Бүлгээр шүүх")).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Бүлгээр шүүх")).toBeInTheDocument();
    expect(screen.getByLabelText("Төлбөрийн төрлөөр шүүх")).toBeInTheDocument();
  });

  /** Client, 2026-10-06: the empty register says only that it is empty. */
  it("shows a bare «Нэхэмжлэл алга» when nothing matches", async () => {
    stub([]);
    renderWithProviders(<InvoicesPage />);

    expect(await screen.findByText("Нэхэмжлэл алга")).toBeInTheDocument();
    expect(screen.queryByText(/тохирох нэхэмжлэл байхгүй/)).toBeNull();
  });
});
