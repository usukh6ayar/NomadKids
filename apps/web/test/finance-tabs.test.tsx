import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import FinancePage from "@/app/(app)/finance/page";

/**
 * Төлбөрийн нэгтгэл — the finance screen's five tabs, client, 2026-09-27.
 *
 * ★ Pinned beyond the layout: every figure comes from an endpoint that exists,
 * and every figure no endpoint serves reads "—" rather than a guessed zero.
 * The Маягт tab shows ESIS figures only from a LIVE read.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "55555555-5555-4555-8555-555555555555";
const CHILD = "66666666-6666-4666-8666-666666666666";

const groups = {
  items: [{ id: GROUP, name: "Бага А", ageBand: "JUNIOR", kindergartenId: KG }],
  page: 1,
  pageSize: 100,
  total: 1,
  totalPages: 1,
};

function esisRead(source: "MOCK" | "LIVE", rows: Record<string, string>[]) {
  return {
    resource: "livelihoodForm1",
    source,
    status: "SUCCEEDED",
    errorCode: null,
    count: rows.length,
    durationMs: 5,
    fields: [],
    rows,
    response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: rows },
  };
}

function stub(form1: ReturnType<typeof esisRead> = esisRead("MOCK", [])) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    {
      path: `/kindergartens/${KG}/invoices/reports`,
      body: {
        title: "Төлөгдөөгүй төлбөрийн тайлан",
        columns: [
          { key: "child", header: "Хүүхэд" },
          { key: "outstanding", header: "Үлдэгдэл", money: true },
        ],
        rows: [{ child: "Болд Номин", outstanding: "45000.00" }],
      },
    },
    {
      path: `/kindergartens/${KG}/invoices/dashboard`,
      body: {
        month: "2026-09",
        state: { children: 0, calculated: "0", approved: "0", received: "0", pending: "0" },
        parents: {
          invoices: 3,
          billed: "600000.00",
          paid: "450000.00",
          unpaid: "150000.00",
          overdueCount: 0,
          overdueAmount: "0",
        },
        meals: { total: "0", fedDays: 0, children: 0, perChild: "0", bySource: [] },
      },
    },
    {
      path: `/kindergartens/${KG}/invoices/generate-month`,
      method: "POST",
      body: { created: 1, invoiceIds: ["x"], skipped: [] },
    },
    {
      path: `/kindergartens/${KG}/attendance/register`,
      body: {
        items: [
          {
            childId: CHILD,
            child: { id: CHILD, lastName: "Ганбаатар", firstName: "Амартүвшин", status: "ACTIVE" },
            group: {
              id: GROUP,
              name: "Бага А",
              ageBand: null,
              programKind: "MAIN",
              attendanceForm: "STANDARD",
            },
            days: [],
            counts: { PRESENT: 16, HALF_DAY: 2, SICK: 1 },
            recorded: 19,
          },
        ],
        page: 1,
        pageSize: 200,
        total: 1,
        totalPages: 1,
        from: "2026-09-01",
        to: "2026-09-27",
        days: [],
        totals: {},
        groups: [],
      },
    },
    { path: `/kindergartens/${KG}/esis/resource?resource=livelihoodForm1`, body: form1 },
    {
      path: "/children",
      body: {
        items: [
          {
            id: CHILD,
            lastName: "Ганбаатар",
            firstName: "Амартүвшин",
            nationalId: null,
            sex: "MALE",
            dateOfBirth: "2021-04-12",
            kindergartenId: KG,
            enrollments: [
              { id: "88888888-8888-4888-8888-000000000001", group: { id: GROUP, name: "Бага А" } },
            ],
          },
        ],
        page: 1,
        pageSize: 100,
        total: 1,
        totalPages: 1,
      },
    },
    { path: "/groups", body: groups },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("Төлбөрийн нэгтгэл", () => {
  it("opens on Төлбөрийн үлдэгдэл, the arrears report", async () => {
    stub();
    renderWithProviders(<FinancePage />);

    expect(await screen.findByRole("tab", { name: /Төлбөрийн үлдэгдэл/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("Болд Номин")).toBeInTheDocument();
    expect(screen.getByText("45 000₮")).toBeInTheDocument();
    expect(await screen.findByText("Ганбаатар Амартүвшин")).toBeInTheDocument();
    for (const heading of [
      "Хүүхэд",
      "Нэхэмжлэл",
      "Сар",
      "Төлөх хугацаа",
      "Хоцорсон хоног",
      "Үлдэгдэл",
    ]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText("Нийт 1 хүүхэд")).toBeInTheDocument();
    expect(screen.queryByText("Төлбөрийн үлдэгдэлтэй суралцагчид")).not.toBeInTheDocument();
    expect(screen.queryByText(/Бүх сарын дүнгээр/)).not.toBeInTheDocument();
    for (const tab of ["Төлбөрийн нэхэмжлэл", "Гүйлгээ", "Жилийн тайлан", "Маягт"]) {
      expect(screen.getByRole("tab", { name: new RegExp(tab) })).toBeInTheDocument();
    }
  });

  it("bills a group's month from the Нэхэмжлэх button, figures from the dashboard", async () => {
    const user = userEvent.setup();
    const { calls } = stub();
    renderWithProviders(<FinancePage />);

    await user.click(await screen.findByRole("tab", { name: /Төлбөрийн нэхэмжлэл/ }));
    expect(await screen.findByText("600 000₮")).toBeInTheDocument();
    expect(screen.getByText("450 000₮")).toBeInTheDocument();
    expect(screen.getByText("150 000₮")).toBeInTheDocument();

    const table = await screen.findByRole("table", { name: "Бүлгээрх нэхэмжлэл" });
    const cells = within(table).getAllByRole("row")[1]!.querySelectorAll("td");
    expect([...cells].slice(0, 6).map((cell) => cell.textContent)).toEqual([
      "1",
      "Бага А",
      "—",
      "—",
      "—",
      "—",
    ]);

    await user.click(within(table).getByRole("button", { name: /Нэхэмжлэх/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Нэхэмжлэх" }));

    await vi.waitFor(() => {
      const post = calls.find((call) => call.url.endsWith("/invoices/generate-month"));
      expect(post?.body).toMatchObject({ childIds: [CHILD] });
    });
  });

  it("draws Гүйлгээ without claiming there were none", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<FinancePage />);

    await user.click(await screen.findByRole("tab", { name: /Гүйлгээ/ }));
    expect(screen.getByText("Гүйлгээний жагсаалт удахгүй нэмэгдэнэ")).toBeInTheDocument();
    expect(screen.getByLabelText("Гүйлгээ хайх")).toBeDisabled();
    expect(screen.queryByText("0₮")).toBeNull();
  });

  it("counts each child's attended days for the year", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<FinancePage />);

    await user.click(await screen.findByRole("tab", { name: /Жилийн тайлан/ }));
    const table = await screen.findByRole("table", { name: "Жилийн тайлан" });
    const cells = within(table).getAllByRole("row")[1]!.querySelectorAll("td");
    // PRESENT 16 + a legacy HALF_DAY 2 per register window.
    expect(Number(cells[3]!.textContent) % 18).toBe(0);
    expect(cells[4]!.textContent).toBe("—");
  });

  it("fills Маягт-1 only from a LIVE ESIS read", async () => {
    const user = userEvent.setup();
    stub(esisRead("MOCK", [{ orgName: "Жишээ", studentCnt: "10" }]));
    renderWithProviders(<FinancePage />);

    await user.click(await screen.findByRole("tab", { name: /Маягт/ }));
    expect(
      await screen.findByText("ESIS-тэй бодитоор холбогдоогүй тул маягтын дүнг харуулахгүй."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Жишээ")).toBeNull();
    expect(screen.getByRole("button", { name: /ESIS илгээх/ })).toBeDisabled();
  });

  it("draws a LIVE Маягт-1 as the form", async () => {
    const user = userEvent.setup();
    stub(
      esisRead("LIVE", [
        {
          orgName: "115-р цэцэрлэг",
          studentCnt: "240",
          livelihoodCnt: "12",
          livelihoodBudget: "1848000",
          livelihoodAmount: "1616000",
        },
      ]),
    );
    renderWithProviders(<FinancePage />);

    await user.click(await screen.findByRole("tab", { name: /Маягт/ }));
    const table = await screen.findByRole("table", { name: "Маягт-1" });
    expect(await within(table).findByText("240")).toBeInTheDocument();
    expect(within(table).getByText("1 848 000₮")).toBeInTheDocument();
    expect(within(table).getByText("1 616 000₮")).toBeInTheDocument();
  });

  it("has no Санхүүжилт tab — removed 2026-09-27", async () => {
    setSearchParams("tab=funding");
    stub();
    renderWithProviders(<FinancePage />);

    expect(await screen.findByRole("tab", { name: /Төлбөрийн үлдэгдэл/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("tab", { name: /Санхүүжилт/ })).toBeNull();
  });
});
