import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { PaymentReport as AdminPaymentReportPage } from "@/components/finance/payment-report";

const KG = "33333333-3333-4333-8333-333333333333";
const YEAR = "55555555-5555-4555-8555-555555555555";
const GROUP = "77777777-7777-4777-8777-777777777777";
const CHILD = "66666666-6666-4666-8666-666666666666";
const INVOICE = "88888888-8888-4888-8888-888888888888";
const MONTHS = [
  "2026-09",
  "2026-10",
  "2026-11",
  "2026-12",
  "2027-01",
  "2027-02",
  "2027-03",
  "2027-04",
  "2027-05",
  "2027-06",
];

function page(items: unknown[]) {
  return { items, page: 1, pageSize: 100, total: items.length, totalPages: items.length ? 1 : 0 };
}

function invoice(month: string) {
  return {
    id: INVOICE,
    number: "INV-001",
    month,
    baseAmount: "100000.00",
    mealAmount: "0.00",
    extraAmount: "0.00",
    discountAmount: "10000.00",
    previousBalance: "0.00",
    totalDue: "90000.00",
    paidAmount: "50000.00",
    balance: "40000.00",
    dueDate: `${month}-25`,
    status: "PARTIALLY_PAID",
    note: null,
    child: {
      id: CHILD,
      lastName: "Авирмэд",
      firstName: "Баянмөнх",
      group: { id: GROUP, name: "Дунд бүлэг" },
    },
    createdAt: `${month}-01T00:00:00.000Z`,
  };
}

function stub(esis: Record<string, unknown> = {}) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    {
      path: `/kindergartens/${KG}/school-years`,
      body: [
        {
          id: YEAR,
          name: "2026-2027",
          isCurrent: true,
          startsOn: "2026-09-01",
          endsOn: "2027-06-30",
        },
      ],
    },
    {
      path: "/groups",
      body: page([
        {
          id: GROUP,
          name: "Дунд бүлэг",
          ageBand: "MIDDLE",
          kindergartenId: KG,
          schoolYearId: YEAR,
          status: "ACTIVE",
          schoolYear: { id: YEAR, name: "2026-2027", isCurrent: true },
          _count: { enrollments: 1 },
          photoMediaFileId: null,
        },
      ]),
    },
    {
      path: `/kindergartens/${KG}/children/finance-roster`,
      body: page([
        {
          id: CHILD,
          lastName: "Авирмэд",
          firstName: "Баянмөнх",
          dateOfBirth: "2023-12-05",
          ...esis,
          enrollments: [
            {
              id: null,
              group: { id: GROUP, name: "Дунд бүлэг", ageBand: "MIDDLE" },
              schoolYear: { id: YEAR, name: "2026-2027" },
              startedOn: "2026-09-01",
              endedOn: null,
            },
          ],
        },
      ]),
    },
    ...MONTHS.map((month) => ({
      path: `/kindergartens/${KG}/invoices?month=${month}`,
      body: page(month === "2026-09" ? [invoice(month)] : []),
    })),
  ]);
}

beforeEach(() => vi.clearAllMocks());

describe("төлбөрийн тайлан", () => {
  it("shows the school-year payment grid without an ESIS action", async () => {
    stub();
    renderWithProviders(<AdminPaymentReportPage />);

    expect(await screen.findByRole("heading", { name: "Жилийн тайлан" })).toBeInTheDocument();
    const table = await screen.findByRole("table", {
      name: "Суралцагчдын хичээлийн жилийн төлбөрийн тайлан",
    });
    expect(within(table).getByText("Авирмэд Баянмөнх")).toBeInTheDocument();
    expect(within(table).getByText("Хөнгөлөлттэй")).toBeInTheDocument();
    expect(within(table).getByText("40,000 ₮")).toBeInTheDocument();
    expect(within(table).getAllByText("50,000 ₮").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /ESIS/ })).toBeNull();
  });

  it("filters the rows by learner name", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<AdminPaymentReportPage />);

    await screen.findByText("Авирмэд Баянмөнх");
    await user.type(screen.getByRole("searchbox", { name: "Суралцагч хайх" }), "Олдохгүй");
    expect(await screen.findByText("Суралцагч олдсонгүй")).toBeInTheDocument();
  });

  it("provides the visible school-year report as Excel", async () => {
    stub();
    renderWithProviders(<AdminPaymentReportPage />);

    const button = await screen.findByRole("button", { name: /Excel/ });
    await waitFor(() => expect(button).toBeEnabled());
  });

  /**
   * ★ Төлөв — 2026-10-01, the client: ESIS's enrolment state after Бүлэг, and
   * the date ESIS recorded it. The API is to send `esisProgramStatus` and
   * `esisActionDate` on the finance roster.
   */
  it("draws ESIS's state and its date after the group", async () => {
    stub({ esisProgramStatus: "Шилжсэн", esisActionDate: "2026-06-02" });
    renderWithProviders(<AdminPaymentReportPage />);

    const table = await screen.findByRole("table", {
      name: "Суралцагчдын хичээлийн жилийн төлбөрийн тайлан",
    });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers.slice(0, 4)).toEqual(["№", "Суралцагчийн нэр", "Бүлэг", "Төлөв"]);
    expect(within(table).getByText("Шилжсэн")).toBeInTheDocument();
    expect(within(table).getByText("2026-06-02")).toBeInTheDocument();
  });

  /**
   * №, the name and the group are frozen while the months scroll — 2026-10-01.
   * jsdom lays nothing out, so this pins the contract rather than the pixels.
   */
  it("freezes №, the name and the group", async () => {
    stub();
    renderWithProviders(<AdminPaymentReportPage />);

    const table = await screen.findByRole("table", {
      name: "Суралцагчдын хичээлийн жилийн төлбөрийн тайлан",
    });
    const headers = within(table).getAllByRole("columnheader");
    for (const header of headers.slice(0, 3)) expect(header).toHaveClass("sticky");
    expect(headers[3]).not.toHaveClass("sticky");
  });

  /** Until the API sends the fields, the column says nothing rather than failing. */
  it("reads — while the API does not send ESIS's state yet", async () => {
    stub();
    renderWithProviders(<AdminPaymentReportPage />);

    const table = await screen.findByRole("table", {
      name: "Суралцагчдын хичээлийн жилийн төлбөрийн тайлан",
    });
    const row = within(table).getByText("Авирмэд Баянмөнх").closest("tr")!;
    expect(within(row).getAllByRole("cell")[3]).toHaveTextContent("—");
  });

  /**
   * ★ 2026-10-02, the client's reference: totals above the table, and Нийт
   * ирц, Нэхэмжилсэн, Төлсөн, Илүү төлөлт and Өр per child.
   */
  it("totals the year and splits each child's balance into overpaid and owed", async () => {
    stub();
    renderWithProviders(<AdminPaymentReportPage />);

    expect(await screen.findByText("Нийт суралцагч: 1")).toBeInTheDocument();
    expect(screen.getByText("Нэхэмжилсэн: 90,000 ₮")).toBeInTheDocument();
    expect(screen.getByText("Төлсөн: 50,000 ₮")).toBeInTheDocument();

    const table = screen.getByRole("table", {
      name: "Суралцагчдын хичээлийн жилийн төлбөрийн тайлан",
    });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers.slice(5, 10)).toEqual([
      "Нийт ирц",
      "Нэхэмжилсэн дүн",
      "Төлсөн дүн",
      "Илүү төлөлт",
      "Өр",
    ]);
    const cells = within(within(table).getByText("Авирмэд Баянмөнх").closest("tr")!).getAllByRole(
      "cell",
    );
    // No register stubbed: attendance reads "—" and the money still draws.
    expect(cells[5]).toHaveTextContent("—");
    expect(cells[6]).toHaveTextContent("90,000 ₮");
    expect(cells[8]).toHaveTextContent("—");
    expect(cells[9]).toHaveTextContent("40,000 ₮");
  });
});
