import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import AdminPaymentReportPage from "@/app/(app)/admin/funding/page";

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

function stub() {
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

    expect(await screen.findByRole("heading", { name: "Төлбөрийн тайлан" })).toBeInTheDocument();
    const table = await screen.findByRole("table", {
      name: "Суралцагчдын хичээлийн жилийн төлбөрийн тайлан",
    });
    expect(within(table).getByText("Авирмэд Баянмөнх")).toBeInTheDocument();
    expect(within(table).getByText("Хөнгөлөлттэй")).toBeInTheDocument();
    expect(within(table).getByText("40,000 ₮")).toBeInTheDocument();
    expect(within(table).getByText("50,000 ₮")).toBeInTheDocument();
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
});
