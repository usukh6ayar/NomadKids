import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, selectOption, sessionFor, stubApi } from "./support/render";
import FinancePage from "@/app/(app)/finance/page";

const KG_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
});

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    month: "2026-02",
    state: {
      children: 12,
      calculated: "240000.00",
      approved: "240000.00",
      received: "180000.00",
      pending: "60000.00",
    },
    parents: {
      invoices: 12,
      billed: "600000.00",
      paid: "450000.00",
      unpaid: "150000.00",
      overdueCount: 0,
      overdueAmount: "0",
    },
    meals: {
      total: "300000.00",
      fedDays: 220,
      children: 10,
      perChild: "30000.00",
      bySource: [],
    },
    ...overrides,
  };
}

/**
 * The financial dashboard — `нэмэлт.md` §9.
 *
 * ★ **Stub order matters**: `stubApi` matches on `startsWith`, and
 * `/kindergartens/:id/invoices/dashboard` shares a prefix with nothing here,
 * but `/funding` and `/funding/rules` do. Longest path first.
 *
 * ★★ These assert on the rendered Mongolian and the formatted amounts, which
 * is what an accountant reads. The API's own tests
 * (`apps/api/test/finance-dashboard.test.ts`) prove the arithmetic; these prove
 * the screen shows it.
 */
describe("the financial dashboard", () => {
  function stub(body: Record<string, unknown> = dashboard()) {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
      { path: `/kindergartens/${KG_ID}/invoices/dashboard`, body },
      { path: `/kindergartens/${KG_ID}/funding/rules`, body: [] },
      {
        path: `/kindergartens/${KG_ID}/funding`,
        body: { month: "2026-02", items: [], totals: [] },
      },
    ]);
  }

  it("groups the nine figures by who owes them", async () => {
    stub();
    renderWithProviders(<FinancePage />);

    expect(await screen.findByText("Санхүүгийн тойм")).toBeInTheDocument();
    expect(screen.getByText("Улсын санхүүжилт")).toBeInTheDocument();
    expect(screen.getByText("Эцэг эхийн төлбөр")).toBeInTheDocument();
    expect(screen.getByText("Хоолны зардал")).toBeInTheDocument();

    // Formatted, never raw: "60000.00" would mean the money helper was skipped.
    expect(screen.getByText("60 000₮")).toBeInTheDocument();
    expect(screen.getByText("150 000₮")).toBeInTheDocument();
    expect(screen.getByText("30 000₮")).toBeInTheDocument();
  });

  it("says the overdue figure covers every month, not the selected one", async () => {
    // Every other number on this screen is scoped to the month; this one is
    // not, and without the words an accountant reads a constant as a bug.
    stub(
      dashboard({
        parents: {
          invoices: 12,
          billed: "600000.00",
          paid: "450000.00",
          unpaid: "150000.00",
          overdueCount: 3,
          overdueAmount: "90000",
        },
      }),
    );

    renderWithProviders(<FinancePage />);

    expect(await screen.findByText(/Хугацаа хэтэрсэн төлбөр: 90 000₮/)).toBeInTheDocument();
    expect(screen.getByText(/3 нэхэмжлэл, бүх сарын дүнгээр/)).toBeInTheDocument();
  });

  it("stays quiet when nothing is overdue", async () => {
    stub();
    renderWithProviders(<FinancePage />);

    expect(await screen.findByText("Санхүүгийн тойм")).toBeInTheDocument();
    expect(screen.queryByText(/Хугацаа хэтэрсэн төлбөр/)).not.toBeInTheDocument();
  });

  it("names the meal denominator, so the average cannot be misread", async () => {
    stub();
    renderWithProviders(<FinancePage />);

    // "10 хүүхэд" is the number the per-child figure divides by — enrolment is
    // a different, larger number and the two must not be confused.
    expect(await screen.findByText("10 хүүхэд · 220 хооллосон өдөр")).toBeInTheDocument();
  });

  it("says so when there is no meal register rather than showing a bare zero", async () => {
    stub(
      dashboard({
        meals: { total: "0.00", fedDays: 0, children: 0, perChild: "0.00", bySource: [] },
      }),
    );

    renderWithProviders(<FinancePage />);

    expect(await screen.findByText("Хоолны бүртгэл алга")).toBeInTheDocument();
  });

  it("splits the meal cost by source when there is more than one", async () => {
    stub(
      dashboard({
        meals: {
          total: "300000.00",
          fedDays: 220,
          children: 10,
          perChild: "30000.00",
          bySource: [
            { source: "STATE", amount: "200000" },
            { source: "PARENT", amount: "100000" },
          ],
        },
      }),
    );

    renderWithProviders(<FinancePage />);

    const heading = await screen.findByText("Хоолны зардал, эх үүсвэрээр");

    /*
     * Scoped to the breakdown card. "Улсын" also labels the funding register's
     * own totals further down the page, so an unscoped query matches two
     * elements — and a test that "fixed" that by loosening to `getAllByText`
     * would stop proving which section the figure landed in.
     */
    const card = within(heading.closest("div")!);
    expect(card.getByText("Улсын")).toBeInTheDocument();
    expect(card.getByText("200 000₮")).toBeInTheDocument();
    expect(card.getByText("100 000₮")).toBeInTheDocument();
  });

  it("does not blank the page when the summary fails", async () => {
    // The register below is a separate query; a failing aggregate must not take
    // the whole screen with it.
    stubApi([
      { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
      { path: `/kindergartens/${KG_ID}/invoices/dashboard`, status: 500, body: {} },
      { path: `/kindergartens/${KG_ID}/funding/rules`, body: [] },
      {
        path: `/kindergartens/${KG_ID}/funding`,
        body: { month: "2026-02", items: [], totals: [] },
      },
    ]);

    renderWithProviders(<FinancePage />);

    // The page header and the register's own empty state still render.
    expect(await screen.findByText("Санхүүжилт")).toBeInTheDocument();
  });
});

/**
 * The financial reports panel — `нэмэлт.md` §16.
 *
 * ★ The definitions live in `apps/api/src/invoices/finance-reports.test.ts`.
 * What these prove is what only the screen can: that the period control follows
 * the report, that money is formatted rather than dumped, and that an empty
 * report says so instead of rendering a bare grid.
 */
describe("the financial reports panel", () => {
  function table(overrides: Record<string, unknown> = {}) {
    return {
      title: "Сарын улсын санхүүжилтийн тайлан",
      columns: [
        { key: "child", header: "Хүүхэд" },
        { key: "daysAttended", header: "Ирсэн өдөр" },
        { key: "calculated", header: "Тооцсон", money: true },
      ],
      rows: [{ child: "Болд Номин", daysAttended: 20, calculated: "20000.00" }],
      totals: { child: "1 хүүхэд", daysAttended: 20, calculated: "20000.00" },
      ...overrides,
    };
  }

  function stubReports(body: Record<string, unknown> = table()) {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
      { path: `/kindergartens/${KG_ID}/invoices/reports`, body },
      { path: `/kindergartens/${KG_ID}/invoices/dashboard`, body: dashboard() },
      { path: `/kindergartens/${KG_ID}/funding/rules`, body: [] },
      {
        path: `/kindergartens/${KG_ID}/funding`,
        body: { month: "2026-02", items: [], totals: [] },
      },
    ]);
  }

  it("renders the rows and the bold total, with money formatted", async () => {
    stubReports();
    renderWithProviders(<FinancePage />);

    // ★ Awaits the row, not the heading. The heading renders regardless of the
    // query, so asserting on it first and then reading the table synchronously
    // races the fetch — and fails intermittently rather than never.
    expect(await screen.findByText("Болд Номин")).toBeInTheDocument();
    // Formatted, not "20000.00" — the raw string would mean `money()` was skipped.
    expect(screen.getAllByText("20 000₮").length).toBeGreaterThan(0);
    expect(screen.getByText("1 хүүхэд")).toBeInTheDocument();
  });

  it("offers a month picker for a monthly report", async () => {
    stubReports();
    renderWithProviders(<FinancePage />);

    await screen.findByText("Санхүүгийн тайлан");
    // Two month inputs: the page's own and the report panel's.
    expect(screen.getAllByLabelText("Сар").length).toBeGreaterThan(1);
    expect(screen.queryByLabelText("Хичээлийн жил")).not.toBeInTheDocument();
  });

  it("swaps the month picker for a school year on the annual report", async () => {
    const user = userEvent.setup();
    stubReports();
    renderWithProviders(<FinancePage />);

    await screen.findByText("Санхүүгийн тайлан");
    await selectOption(user, "Тайлан", "Хичээлийн жилийн санхүүгийн нэгтгэл");

    // The annual report is September-to-August, so a month picker would be
    // the wrong control entirely.
    expect(await screen.findByLabelText("Хичээлийн жил")).toBeInTheDocument();
  });

  it("shows no period control at all for the unpaid report", async () => {
    const user = userEvent.setup();
    stubReports();
    renderWithProviders(<FinancePage />);

    await screen.findByText("Санхүүгийн тайлан");
    await selectOption(user, "Тайлан", "Төлөгдөөгүй төлбөрийн тайлан");

    // Arrears are not a property of a month; a picker beside them would imply
    // a filter that does not apply.
    await waitFor(() => {
      expect(screen.getAllByLabelText("Сар")).toHaveLength(1);
    });
    expect(screen.queryByLabelText("Хичээлийн жил")).not.toBeInTheDocument();
  });

  it("says an empty report is empty rather than rendering a bare grid", async () => {
    stubReports(table({ rows: [], totals: undefined }));
    renderWithProviders(<FinancePage />);

    expect(await screen.findByText("Энэ хугацаанд бичлэг алга")).toBeInTheDocument();
  });

  it("shows the report's own caveat when it carries one", async () => {
    stubReports(
      table({ note: "Зөвхөн зөрүүтэй мөрүүд. Бүрэн хүлээн авсан тооцоо энд харагдахгүй." }),
    );
    renderWithProviders(<FinancePage />);

    expect(await screen.findByText(/Зөвхөн зөрүүтэй мөрүүд/)).toBeInTheDocument();
  });

  it("links the export rather than fetching it", async () => {
    stubReports();
    renderWithProviders(<FinancePage />);

    await screen.findByText("Санхүүгийн тайлан");

    // An anchor: the session cookie rides a navigation and the browser handles
    // Content-Disposition. Fetching would hold the whole file in memory.
    const link = screen.getByRole("link", { name: /Excel татах/ });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("reports/export?report=state-funding"),
    );
  });
});

/**
 * The PDF button — `нэмэлт.md` §16's "Excel болон PDF".
 *
 * ★ The Excel control is a link and this one is a button, and the difference is
 * the whole design: Chromium takes seconds and a gigabyte, so the PDF is a
 * queued job the screen polls. These tests hold that shape — a spinner while it
 * works, a download once it is ready, a retry when it fails.
 */
describe("the PDF export", () => {
  const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  function job(overrides: Record<string, unknown> = {}) {
    return {
      id: JOB_ID,
      report: "state-funding",
      period: "2026-02",
      status: "QUEUED",
      progressPercent: 0,
      pageCount: 0,
      fileSize: 0,
      errorMessage: null,
      requestedAt: "2026-02-20T10:00:00.000Z",
      completedAt: null,
      expiresAt: null,
      downloadable: false,
      ...overrides,
    };
  }

  function stubPdf(jobBody: Record<string, unknown>, extra: Parameters<typeof stubApi>[0] = []) {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
      ...extra,
      { path: `/finance-reports/${JOB_ID}`, body: jobBody },
      {
        path: `/kindergartens/${KG_ID}/invoices/reports/pdf`,
        method: "POST",
        body: job(),
      },
      {
        path: `/kindergartens/${KG_ID}/invoices/reports`,
        body: {
          title: "Сарын улсын санхүүжилтийн тайлан",
          columns: [{ key: "child", header: "Хүүхэд" }],
          rows: [{ child: "Болд Номин" }],
        },
      },
      { path: `/kindergartens/${KG_ID}/invoices/dashboard`, body: dashboard() },
      { path: `/kindergartens/${KG_ID}/funding/rules`, body: [] },
      {
        path: `/kindergartens/${KG_ID}/funding`,
        body: { month: "2026-02", items: [], totals: [] },
      },
    ]);
  }

  it("offers to create a PDF, not to download one that does not exist", async () => {
    stubPdf(job());
    renderWithProviders(<FinancePage />);

    expect(await screen.findByRole("button", { name: /PDF үүсгэх/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /PDF татах/ })).not.toBeInTheDocument();
  });

  it("shows it is working while the job is queued", async () => {
    const user = userEvent.setup();
    stubPdf(job({ status: "RUNNING" }));
    renderWithProviders(<FinancePage />);

    await user.click(await screen.findByRole("button", { name: /PDF үүсгэх/ }));

    // Chromium takes seconds; a button that looked idle would be pressed twice.
    expect(await screen.findByRole("button", { name: /бэлдэж байна/ })).toBeDisabled();
  });

  it("turns into a download once the job is finished", async () => {
    const user = userEvent.setup();
    stubPdf(job({ status: "DONE", downloadable: true, pageCount: 2 }));
    renderWithProviders(<FinancePage />);

    await user.click(await screen.findByRole("button", { name: /PDF үүсгэх/ }));

    expect(await screen.findByRole("button", { name: /PDF татах/ })).toBeInTheDocument();
  });

  it("offers a retry rather than a dead spinner when the job fails", async () => {
    const user = userEvent.setup();
    stubPdf(job({ status: "FAILED", errorMessage: "Тайлан үүсгэхэд алдаа гарлаа." }));
    renderWithProviders(<FinancePage />);

    await user.click(await screen.findByRole("button", { name: /PDF үүсгэх/ }));

    // A failed render is usually transient — a worker killed under memory
    // pressure — so the useful control is "try again", not an error message.
    expect(await screen.findByRole("button", { name: /дахин оролдох/i })).toBeInTheDocument();
  });
});
