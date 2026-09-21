import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import AdminFundingPage from "@/app/(app)/admin/funding/page";

/**
 * Ирц ба тооцоолол — the month's register, and the money beside it.
 *
 * ★ What these assert is that the two tabs describe **one** month.
 *
 * The screen's whole premise (see the page's docblock) is that the attendance
 * table and the funding table are the same rows read twice. A regression that
 * fetched them separately, or paged one and totalled the other, would still
 * render two plausible tables — so the assertions here are about agreement: the
 * same children in both, the footer summing the whole filter rather than the
 * page, and a deduction that equals gross minus net.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const CHILD = "66666666-6666-4666-8666-666666666666";
const GROUP = "77777777-7777-4777-8777-777777777777";
const CALC = "88888888-8888-4888-8888-888888888888";
const RULE = "99999999-9999-4999-8999-999999999999";

function row(over: Record<string, unknown> = {}) {
  return {
    child: { id: CHILD, lastName: "Батмөнх", firstName: "Тэмүүлэн" },
    group: { id: GROUP, name: "Дунд бүлэг" },
    counts: { PRESENT: 17, HALF_DAY: 1, EXCUSED: 1, SICK: 2, ABSENT: 1, OTHER: 0 },
    mealDays: 18,
    undocumentedDays: 0,
    funding: {
      id: CALC,
      source: "PARENT",
      daysAttended: 18,
      daysFed: 18,
      dailyRate: "5000",
      grossAmount: "105000",
      deductionAmount: "15000",
      netAmount: "90000",
      approvedAmount: null,
      receivedAmount: null,
      note: null,
    },
    state: "CALCULATED",
    ...over,
  };
}

function register(over: Record<string, unknown> = {}) {
  return {
    items: [row()],
    page: 1,
    pageSize: 25,
    total: 1,
    totalPages: 1,
    month: "2026-08",
    source: null,
    workingDays: 21,
    totals: {
      children: 120,
      counts: { PRESENT: 89, HALF_DAY: 7, EXCUSED: 5, SICK: 7, ABSENT: 4, OTHER: 0 },
      mealDays: 90,
      grossAmount: "450000",
      deductionAmount: "45000",
      netAmount: "405000",
      approvedAmount: "0",
      receivedAmount: "0",
      needingCheck: 0,
      missingDocuments: 0,
    },
    rules: [
      {
        id: RULE,
        name: "Эцэг эхийн хоолны төлбөр",
        source: "PARENT",
        effectiveFrom: "2026-08-01",
        effectiveTo: null,
        ageBand: null,
        dailyRate: "5000",
        monthlyRate: null,
        dependsOnAttendance: false,
        dependsOnMeals: true,
        note: null,
      },
    ],
    calculatedAt: "2026-08-28T19:44:24.159Z",
    ...over,
  };
}

function stub(over: Record<string, unknown> = {}) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: `/kindergartens/${KG}/funding/register`, body: register(over) },
    // `GET /groups` — the route that exists. Mocking
    // `/kindergartens/:id/groups` is what let a 404 ship: that path is POST
    // only, and the page's select was empty against the real API.
    {
      path: "/groups",
      body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("ирц ба тооцоолол", () => {
  it("names the month it is showing", async () => {
    stub();
    renderWithProviders(<AdminFundingPage />);

    expect(await screen.findByRole("heading", { name: "Ирц ба тооцоолол" })).toBeInTheDocument();
  });

  it("shows the four figures the client's design asks for", async () => {
    stub();
    renderWithProviders(<AdminFundingPage />);

    // The cards render before the month does, showing "—" — so the assertion
    // waits for the figure rather than for the label it sits under.
    expect(await screen.findByText("120")).toBeInTheDocument();
    expect(screen.getByText("Нийт хүүхэд")).toBeInTheDocument();
    expect(screen.getByText("Ажлын өдөр")).toBeInTheDocument();
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(screen.getByText("Суутгалын дүн")).toBeInTheDocument();
    expect(screen.getByText("₮45,000")).toBeInTheDocument();
  });

  it("hides half-day and other from the management attendance view", async () => {
    stub({
      items: [
        row({
          counts: { PRESENT: 17, HALF_DAY: 1, EXCUSED: 1, SICK: 2, ABSENT: 1, OTHER: 2 },
        }),
      ],
      totals: {
        ...register().totals,
        counts: { PRESENT: 89, HALF_DAY: 7, EXCUSED: 5, SICK: 7, ABSENT: 4, OTHER: 9 },
      },
    });
    renderWithProviders(<AdminFundingPage />);

    const table = await screen.findByRole("table", {
      name: "Хүүхэд тус бүрийн сарын ирцийн задаргаа",
    });
    expect(within(table).queryByRole("columnheader", { name: "Хагас өдөр" })).toBeNull();
    expect(within(table).queryByRole("columnheader", { name: "Бусад" })).toBeNull();
    expect(screen.queryByText("Хагас өдөр")).toBeNull();
    expect(screen.queryByText("Бусад")).toBeNull();

    const childRow = within(table).getByText("Батмөнх Тэмүүлэн").closest("tr")!;
    expect(within(childRow).getAllByRole("cell")[1]).toHaveTextContent("18");
  });

  /**
   * ★ The footer is the month, not the page.
   *
   * The stub returns one row of 18 attended days and a total of 96 — a shape
   * that only exists to catch a footer summing what it can see. Both figures
   * include historical half-days inside Ирсэн without exposing a separate
   * status.
   */
  it("totals the whole filter rather than the visible page", async () => {
    stub();
    renderWithProviders(<AdminFundingPage />);

    const totalRow = within(await screen.findByRole("table"))
      .getByText("Нийт дүн")
      .closest("tr");
    expect(totalRow).not.toBeNull();
    expect(within(totalRow as HTMLElement).getByText("96")).toBeInTheDocument();
  });

  it("prices the same children on the funding tab", async () => {
    stub();
    const user = userEvent.setup();
    renderWithProviders(<AdminFundingPage />);

    expect(await screen.findByText("Батмөнх Тэмүүлэн")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Санхүүгийн тооцоо/ }));

    // The same child, now with the money — and the deduction reads as a
    // subtraction, which is what distinguishes it from a charge.
    expect(await screen.findByText("Батмөнх Тэмүүлэн")).toBeInTheDocument();
    expect(screen.getByText("₮90,000")).toBeInTheDocument();
    expect(screen.getByText("−₮15,000")).toBeInTheDocument();
  });

  it("explains the arithmetic behind the deduction", async () => {
    stub();
    renderWithProviders(<AdminFundingPage />);

    expect(await screen.findByText("Өдрийн тариф × ажлын 21 өдөр")).toBeInTheDocument();
    expect(screen.getByText("Нийт төлбөр − эцсийн төлбөр")).toBeInTheDocument();
  });

  it("shows the tariffs the month was priced under", async () => {
    stub();
    renderWithProviders(<AdminFundingPage />);

    expect(await screen.findByText("Эцэг эхийн хоолны төлбөр")).toBeInTheDocument();
    expect(screen.getByText("₮5,000/өдөр")).toBeInTheDocument();
  });

  /**
   * ★ The warning has to name a count, not just appear.
   *
   * "7 хүүхдийн акт дутуу" is the sentence somebody acts on; a generic banner
   * is one somebody dismisses.
   */
  it("counts the rows that need a document", async () => {
    stub({
      items: [row({ undocumentedDays: 3, state: "MISSING_DOCUMENT" })],
      totals: { ...register().totals, missingDocuments: 7 },
    });
    renderWithProviders(<AdminFundingPage />);

    const alert = await screen.findByText("Шалгах шаардлагатай мөр байна");
    const panel = alert.closest("div")?.parentElement as HTMLElement;
    expect(
      within(panel).getByText(/тасалсан хоногт баталгаажсан чөлөөний хүсэлт алга/),
    ).toBeInTheDocument();
    expect(within(panel).getByText("7")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Чөлөөний хүсэлт хянах" })).toHaveAttribute(
      "href",
      "/attendance-requests/review",
    );
  });

  it("says so when nothing needs checking", async () => {
    stub();
    renderWithProviders(<AdminFundingPage />);

    expect(await screen.findByText("Шалгах зүйл алга")).toBeInTheDocument();
  });

  /**
   * ★ A child with no calculation stays on the register.
   *
   * `calculateMonth` leaves out a child no rule covers rather than funding them
   * at zero, which is correct — and it makes this screen the only place that
   * absence is visible. A row that vanished with the calculation would hide
   * exactly the child an administrator needs to write a rule for.
   */
  it("keeps an uncalculated child visible, with the reason", async () => {
    stub({ items: [row({ funding: null, state: "PENDING" })] });
    const user = userEvent.setup();
    renderWithProviders(<AdminFundingPage />);

    await user.click(await screen.findByRole("tab", { name: /Санхүүгийн тооцоо/ }));

    expect(await screen.findByText(/Тооцоо хийгдээгүй/)).toBeInTheDocument();
    expect(screen.getByText("Батмөнх Тэмүүлэн")).toBeInTheDocument();
  });

  /**
   * ★ Recalculation is refused until a source is chosen, and says why.
   *
   * The API runs one source at a time, so a button that fired without one would
   * 400. It is disabled with the requirement in its tooltip instead.
   */
  it("will not recalculate without a funding source", async () => {
    stub();
    renderWithProviders(<AdminFundingPage />);

    const button = await screen.findByRole("button", { name: /Тооцоолол үүсгэх/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Санхүүжилтийн эх үүсвэрээ сонгоно уу");
  });

  it("offers the register as a spreadsheet, carrying the filters", async () => {
    stub();
    renderWithProviders(<AdminFundingPage />);

    const link = await screen.findByRole("link", { name: /Excel татах/ });
    expect(link.getAttribute("href")).toContain("/funding/register/export");
    expect(link.getAttribute("href")).toContain("month=");
  });

  /** A narrower filter is a new first page, never page four of two. */
  it("returns to the first page when a filter changes", async () => {
    const { calls } = stub({ page: 3, totalPages: 5, total: 120 });
    const user = userEvent.setup();
    renderWithProviders(<AdminFundingPage />);

    await screen.findByText("Батмөнх Тэмүүлэн");
    await user.type(screen.getByLabelText("Хүүхэд"), "Ану");

    await waitFor(() => {
      const last = calls.filter((c) => c.url.includes("/funding/register")).at(-1);
      expect(last?.url).toContain("page=1");
    });
  });
});
