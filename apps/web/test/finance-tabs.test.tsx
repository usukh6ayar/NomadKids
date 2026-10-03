import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  selectOption,
  sessionFor,
  setSearchParams,
  stubApi,
  type RouteStub,
} from "./support/render";
import FinancePage from "@/app/(app)/finance/page";

const KG = "33333333-3333-4333-8333-333333333333";
const YEAR = "55555555-5555-4555-8555-555555555555";
const GROUP_A = "77777777-7777-4777-8777-777777777777";
const GROUP_B = "99999999-9999-4999-8999-999999999999";
const GROUP_C = "88888888-8888-4888-8888-888888888888";

function page(items: unknown[]) {
  return { items, page: 1, pageSize: 100, total: items.length, totalPages: items.length ? 1 : 0 };
}

function group(id: string, name: string) {
  return {
    id,
    name,
    ageBand: "MIDDLE",
    kindergartenId: KG,
    schoolYearId: YEAR,
    status: "ACTIVE",
    schoolYear: { id: YEAR, name: "2026-2027", isCurrent: true },
    _count: { enrollments: 1 },
    photoMediaFileId: null,
  };
}

const GROUPS = [
  group(GROUP_A, "Дунд бүлэг"),
  group(GROUP_B, "Бага бүлэг"),
  group(GROUP_C, "Ахлах бүлэг"),
];

function invoice(
  id: string,
  child: { lastName: string; firstName: string; group: { id: string; name: string } },
  amounts: { totalDue: string; paidAmount: string; discountAmount: string; balance: string },
) {
  return {
    id,
    number: null,
    month: "2026-10",
    baseAmount: amounts.totalDue,
    mealAmount: "0.00",
    extraAmount: "0.00",
    previousBalance: "0.00",
    dueDate: "2026-10-25",
    status: amounts.balance === "0.00" ? "PAID" : "PARTIALLY_PAID",
    note: null,
    child: { id: `${id.slice(0, -1)}c`, ...child },
    createdAt: "2026-10-01T00:00:00.000Z",
    ...amounts,
  };
}

const INVOICES = [
  invoice(
    "11111111-1111-4111-8111-111111111111",
    { lastName: "Авирмэд", firstName: "Баянмөнх", group: { id: GROUP_A, name: "Дунд бүлэг" } },
    {
      totalDue: "90000.00",
      paidAmount: "50000.00",
      discountAmount: "10000.00",
      balance: "40000.00",
    },
  ),
  invoice(
    "22222222-2222-4222-8222-222222222222",
    { lastName: "Болд", firstName: "Сараа", group: { id: GROUP_A, name: "Дунд бүлэг" } },
    { totalDue: "80000.50", paidAmount: "80000.50", discountAmount: "0.00", balance: "0.00" },
  ),
  invoice(
    "44444444-4444-4444-8444-444444444444",
    { lastName: "Дорж", firstName: "Тэмүүлэн", group: { id: GROUP_B, name: "Бага бүлэг" } },
    { totalDue: "60000.00", paidAmount: "0.00", discountAmount: "5000.00", balance: "60000.00" },
  ),
];

function stub(extra: RouteStub[] = []) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
    ...extra,
    { path: `/kindergartens/${KG}/invoices`, method: "GET", body: page(INVOICES) },
    { path: "/groups", body: page(GROUPS) },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("Санхүү — tabs", () => {
  it("opens on Төлбөрийн үлдэгдэл with the tabs in the reference's order", async () => {
    stub();
    renderWithProviders(<FinancePage />);

    const tabs = await screen.findByRole("tablist", { name: "Санхүүгийн хэсэг" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual([
      "Төлбөрийн үлдэгдэл",
      "Төлбөрийн нэхэмжлэл",
      "Гүйлгээ",
      "Жилийн тайлан",
      "Маягт",
      "Санхүүжилт",
    ]);
    expect(within(tabs).getByRole("tab", { name: "Төлбөрийн үлдэгдэл" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("lists only the children who owe, and everyone on request", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<FinancePage />);

    const table = await screen.findByRole("table", { name: "Хүүхдийн төлбөрийн үлдэгдэл" });
    expect(within(table).getByText("Авирмэд Баянмөнх")).toBeInTheDocument();
    expect(within(table).getByText("Дорж Тэмүүлэн")).toBeInTheDocument();
    expect(within(table).queryByText("Болд Сараа")).toBeNull();
    expect(screen.getByText("100 000₮")).toBeInTheDocument(); // Нийт үлдэгдэл

    await user.click(screen.getByRole("checkbox", { name: "Зөвхөн өртэй" }));
    expect(within(table).getByText("Болд Сараа")).toBeInTheDocument();
  });

  it("sums the month in cents and lists every group, billed or not", async () => {
    setSearchParams("tab=invoices");
    stub();
    renderWithProviders(<FinancePage />);

    const table = await screen.findByRole("table", { name: "Бүлгээр нэхэмжлэл" });
    // 90 000 + 80 000.50 + 60 000 — no float drift.
    expect(screen.getAllByText("230 000.50₮").length).toBeGreaterThan(0);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[1]!.textContent)).toEqual([
      "Дунд бүлэг",
      "Бага бүлэг",
      "Ахлах бүлэг",
    ]);
    expect(within(rows[2]!).getAllByText("0₮")).toHaveLength(4);
    expect(within(rows[0]!).getAllByRole("cell")[3]).toHaveTextContent("1"); // one discounted
  });

  it("bills one group's children through «Нэхэмжлэх»", async () => {
    const user = userEvent.setup();
    setSearchParams("tab=invoices");
    const roster = (id: string, groupId: string) => ({
      id,
      lastName: "Овог",
      firstName: "Нэр",
      dateOfBirth: "2022-01-01",
      enrollments: [
        {
          id: null,
          group: { id: groupId, name: "x", ageBand: "MIDDLE" },
          schoolYear: { id: YEAR, name: "2026-2027" },
          startedOn: "2026-09-01",
          endedOn: null,
        },
      ],
    });
    const { calls } = stub([
      {
        path: `/kindergartens/${KG}/children/finance-roster`,
        body: page([
          roster("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", GROUP_C),
          roster("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", GROUP_A),
        ]),
      },
      {
        path: `/kindergartens/${KG}/invoices/generate-month`,
        method: "POST",
        body: { created: 1, invoiceIds: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"], skipped: [] },
      },
    ]);
    renderWithProviders(<FinancePage />);

    const table = await screen.findByRole("table", { name: "Бүлгээр нэхэмжлэл" });
    const row = within(table).getByText("Ахлах бүлэг").closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Нэхэмжлэх" }));
    const dialog = await screen.findByRole("dialog", { name: /Ахлах бүлэг/ });
    await within(dialog).findByText(/1 хүүхдэд/);
    await user.click(within(dialog).getByRole("button", { name: "Нэхэмжлэх" }));

    expect(await screen.findByText("Ахлах бүлэг: 1 нэхэмжлэл үүсгэлээ.")).toBeInTheDocument();
    const posted = calls.find((call) => call.url.endsWith("/invoices/generate-month"));
    expect(posted?.body).toEqual({
      month: expect.stringMatching(/^\d{4}-\d{2}$/),
      dueDate: expect.stringMatching(/^\d{4}-\d{2}-25$/),
      childIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    });
  });

  it("says Гүйлгээ is on its way while the route answers 404", async () => {
    setSearchParams("tab=transactions");
    stub();
    renderWithProviders(<FinancePage />);

    expect(await screen.findByText("Гүйлгээний жагсаалт удахгүй нэмэгдэнэ")).toBeInTheDocument();
    expect(screen.getByLabelText("Эхлэх огноо")).toBeInTheDocument();
    expect(screen.getByLabelText("Дуусах огноо")).toBeInTheDocument();
  });

  it("lists payments over a date range with the four totals", async () => {
    setSearchParams("tab=transactions");
    const { calls } = stub([
      {
        path: `/kindergartens/${KG}/payments`,
        body: {
          ...page([
            {
              id: "55555555-5555-4555-8555-555555555555",
              kind: "REVERSAL",
              amount: "-12500.00",
              method: "CASH",
              note: null,
              voidedAt: null,
              createdAt: "2026-10-05T03:00:00.000Z",
              invoice: { id: INVOICES[0]!.id, number: "INV-7", month: "2026-10" },
              child: { ...INVOICES[0]!.child, registrationNumber: "ТА22010101" },
            },
          ]),
          summary: { income: "130000.00", expense: "0.00", net: "130000.00", count: 4 },
        },
      },
    ]);
    renderWithProviders(<FinancePage />);

    const table = await screen.findByRole("table", { name: "Төлбөрийн гүйлгээ" });
    expect(within(table).getByText("-12 500₮")).toBeInTheDocument();
    expect(within(table).getByText("Буцаалт")).toBeInTheDocument();
    expect(within(table).getByText("ТА22010101")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getAllByText("130 000₮").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(calls.some((call) => /\/payments\?from=\d{4}-\d{2}-01&to=/.test(call.url))).toBe(true),
    );
  });

  it("lays Маягт-1 out as the return and files it on «ESIS илгээх»", async () => {
    const user = userEvent.setup();
    setSearchParams("tab=esis");
    const form1 = `/kindergartens/${KG}/finance/esis-forms/form1`;
    const { calls } = stub([
      {
        path: `${form1}/draft`,
        body: {
          month: "2026-10",
          orgName: "Нийслэлийн 115-р цэцэрлэг",
          studentCnt: 83,
          livelihoodCnt: 65,
          livelihoodBudget: "1250000.00",
          livelihoodAmount: "980000.00",
          lastSubmittedAt: "2026-10-10T00:00:00.000Z",
        },
      },
      {
        path: `${form1}/submit`,
        method: "POST",
        body: {
          status: "SUCCEEDED",
          errorCode: null,
          message: null,
          submittedAt: "2026-10-12T03:00:00.000Z",
        },
      },
    ]);
    renderWithProviders(<FinancePage />);

    const sheet = await screen.findByRole("article", { name: "Маягт - 1" });
    expect(await within(sheet).findByText("1 250 000₮")).toBeInTheDocument();
    expect(within(sheet).getAllByText(/Нийслэлийн 115-р цэцэрлэг/).length).toBeGreaterThan(0);
    expect(within(sheet).getByText(/Эрхлэгч/)).toBeInTheDocument();
    expect(screen.getByText(/Сүүлд илгээсэн: 2026-10-10 00:00:00/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ESIS илгээх" }));
    const confirm = await screen.findByRole("dialog", { name: /ЭСИС рүү илгээх үү/ });
    await user.click(within(confirm).getByRole("button", { name: "Илгээх" }));

    expect(await screen.findByText("Маягт-1 ЭСИС рүү илгээгдлээ.")).toBeInTheDocument();
    const posted = calls.find((call) => call.url === `${form1}/submit`);
    expect(posted?.body).toEqual({ month: expect.stringMatching(/^\d{4}-\d{2}$/) });
  });

  it("holds «ESIS илгээх» while the route is missing, and asks for a group on Маягт-2", async () => {
    const user = userEvent.setup();
    setSearchParams("tab=esis");
    stub();
    renderWithProviders(<FinancePage />);

    await screen.findByRole("article", { name: "Маягт - 1" });
    expect(await screen.findByText(/сервер талд хийгдэж байна/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ESIS илгээх" })).toBeDisabled();

    await selectOption(user, "Маягт", "Маягт-2");
    expect(await screen.findByText("Маягт-2 бүлэг тус бүрээр илгээгдэнэ.")).toBeInTheDocument();
  });
});
