import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminDashboard } from "@kinder/contracts";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import AdminAssessmentPage from "@/app/(app)/admin/assessment/page";

const GROUP_ONE = "44444444-4444-4444-8444-444444444441";
const GROUP_TWO = "44444444-4444-4444-8444-444444444442";
const GROUP_THREE = "44444444-4444-4444-8444-444444444443";
const LANGUAGE = "55555555-5555-4555-8555-555555555551";
const COGNITIVE = "55555555-5555-4555-8555-555555555552";

const DASHBOARD: AdminDashboard = {
  currentTerm: {
    id: "66666666-6666-4666-8666-666666666666",
    number: 1,
    name: "2026 оны 1-р улирал",
  },
  counts: { children: 60, groups: 3, staff: 8, guardians: 77 },
  childrenAMonthAgo: 58,
  attendanceToday: { expected: 60, recorded: 57, present: 54 },
  attendanceByGroup: [],
  recentActivity: [],
  storage: null,
  assessmentCoverage: [
    { groupId: GROUP_ONE, name: "Дэлбээ", children: 20, assessed: 20 },
    { groupId: GROUP_TWO, name: "Солонго", children: 20, assessed: 18 },
    { groupId: GROUP_THREE, name: "Одод", children: 20, assessed: 14 },
  ],
  domainAveragesByGroup: [
    {
      groupId: GROUP_ONE,
      name: "Дэлбээ",
      sampleSize: 40,
      averageByDomain: { [LANGUAGE]: 3.8, [COGNITIVE]: 3.6 },
    },
    {
      groupId: GROUP_TWO,
      name: "Солонго",
      sampleSize: 34,
      averageByDomain: { [LANGUAGE]: 3.2, [COGNITIVE]: 3 },
    },
    {
      groupId: GROUP_THREE,
      name: "Одод",
      sampleSize: 20,
      averageByDomain: { [LANGUAGE]: 2.5 },
    },
  ],
};

const DOMAINS = [
  {
    id: LANGUAGE,
    name: "Хэл яриа",
    code: "LANGUAGE",
    color: null,
    description: null,
    order: 1,
    isActive: true,
    isSystem: true,
  },
  {
    id: COGNITIVE,
    name: "Танин мэдэхүй",
    code: "COGNITIVE",
    color: null,
    description: null,
    order: 2,
    isActive: true,
    isSystem: true,
  },
];

function renderPage({ a79 = { body: { children: [] } } as object } = {}) {
  stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: "/dashboard/admin", body: DASHBOARD },
    { path: `/groups/${GROUP_ONE}/a79-summary`, ...a79 },
    { path: `/groups/${GROUP_TWO}/a79-summary`, ...a79 },
    {
      path: "/kindergartens/33333333-3333-4333-8333-333333333333/development-domains",
      body: DOMAINS,
    },
  ]);

  return renderWithProviders(<AdminAssessmentPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("the administrator assessment overview", () => {
  it("shows the whole kindergarten's assessment progress in one view", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Үнэлгээ" })).toBeInTheDocument();
    expect(await screen.findByText("2026 оны 1-р улирал")).toBeInTheDocument();

    // One table since 2026-09-25 — no summary, no lede, no legend.
    expect(screen.queryByRole("table", { name: "Үнэлгээний товч мэдээлэл" })).toBeNull();
    expect(screen.queryByText(/бүлгийн хүүхдийн хөгжлийн явцын тойм/)).toBeNull();
    expect(screen.queryByText(/ба түүнээс дээш/)).toBeNull();

    const comparison = screen.getByRole("region", { name: "Бүлгүүдийн харьцуулалт" });
    for (const group of ["Дэлбээ", "Солонго", "Одод"]) {
      expect(within(comparison).getByText(group)).toBeInTheDocument();
    }
    expect(within(comparison).getByText("100%")).toBeInTheDocument();
    expect(within(comparison).getByText("90%")).toBeInTheDocument();
    expect(within(comparison).getByText("70%")).toBeInTheDocument();
  });

  /*
    ★ Removed — client, 2026-09-25: "Хөгжлийн бүх үзүүлэлт … Анхаарах бүлгүүд
    Шилдэг бүлгүүд гэсэн график хэрэггүй устга", and the page is tables with
    no charts at all.
  */
  it("carries no domain panels, no rankings and no charts", async () => {
    renderPage();
    await screen.findByRole("table", { name: "Бүлгүүдийн үнэлгээний гүйцэтгэл" });

    for (const title of ["Хөгжлийн бүх үзүүлэлт", "Анхаарах бүлгүүд", "Шилдэг бүлгүүд"]) {
      expect(screen.queryByRole("heading", { name: title })).toBeNull();
    }
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("lays each group's counts and percentage out in columns", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Бүлгүүдийн үнэлгээний гүйцэтгэл" });

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["№", "Бүлэг", "Хүүхэд", "Үнэлсэн", "Дутуу", "Гүйцэтгэл"]);
    // No status column — removed 2026-09-25.
    expect(within(table).queryByText("Сайн")).toBeNull();
  });

  it("keeps every group linked to its detailed assessment sheet", async () => {
    renderPage();

    const comparison = await screen.findByRole("region", { name: "Бүлгүүдийн харьцуулалт" });
    await waitFor(() =>
      expect(within(comparison).getByRole("link", { name: /Солонго/ })).toHaveAttribute(
        "href",
        `/groups/${GROUP_TWO}/assessment`,
      ),
    );
  });

  /*
    ★ Progress and result, as a teacher has on their group — 2026-10-08, the
    client: "удирдлага үнэлгээ дээр явцын ба үр дүнгийнх бас харагдана".
  */
  it("switches between progress and result, the view in the address", async () => {
    renderPage();

    const nav = await screen.findByRole("navigation", { name: "Үнэлгээний төрөл" });
    expect(within(nav).getByRole("link", { name: "Явцын үнэлгээ" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Үр дүнгийн үнэлгээ" })).toHaveAttribute(
      "href",
      "/admin/assessment?view=results",
    );
  });

  it("lists the groups, each opening its result, on «Үр дүнгийн үнэлгээ»", async () => {
    setSearchParams("view=results");
    renderPage();

    const table = await screen.findByRole("table", { name: "Бүлгүүдийн үр дүнгийн үнэлгээ" });
    expect(within(table).getByRole("link", { name: /Солонго/ })).toHaveAttribute(
      "href",
      `/groups/${GROUP_TWO}/results`,
    );
    const nav = screen.getByRole("navigation", { name: "Үнэлгээний төрөл" });
    expect(within(nav).getByRole("link", { name: "Үр дүнгийн үнэлгээ" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows each group's Мэдлэг, Чадвар, Төлөвшил and Нийт", async () => {
    setSearchParams("view=results");
    const child = (id: string, achieved: [number, number, number]) => ({
      childId: id,
      firstName: "Ану",
      lastName: "Бат",
      level: "III",
      achieved: achieved[0] + achieved[1] + achieved[2],
      total: 40,
      byDomain: [
        { domain: "Мэдлэг", achieved: achieved[0], total: 10 },
        { domain: "Чадвар", achieved: achieved[1], total: 20 },
        { domain: "Төлөвшил", achieved: achieved[2], total: 10 },
      ],
    });
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: "/dashboard/admin", body: DASHBOARD },
      {
        path: `/groups/${GROUP_ONE}/a79-summary`,
        body: {
          children: [
            // 80% and 50% of Мэдлэг → 65%; 36/40 and 20/40 overall → 90% and 50% → 70%.
            child("c1111111-1111-4111-8111-111111111111", [8, 18, 10]),
            child("c2222222-2222-4222-8222-222222222222", [5, 10, 5]),
          ],
        },
      },
      { path: `/groups/${GROUP_TWO}/a79-summary`, body: { children: [] } },
    ]);
    renderWithProviders(<AdminAssessmentPage />);

    const table = await screen.findByRole("table", { name: "Бүлгүүдийн үр дүнгийн үнэлгээ" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["№", "Бүлэг", "Хүүхэд", "Мэдлэг", "Чадвар", "Төлөвшил", "Нийт", "Үр дүн"]);
    const row = within(table).getByRole("link", { name: "Дэлбээ" }).closest("tr")!;
    await waitFor(() =>
      expect(
        within(row)
          .getAllByRole("cell")
          .map((td) => td.textContent),
      ).toEqual(["1", "Дэлбээ", "20", "65%", "70%", "75%", "70%", "Ахиж байна"]),
    );
    // A group with no children yet shows dashes, not a 0% it did not earn.
    const empty = within(table).getByRole("link", { name: "Солонго" }).closest("tr")!;
    await waitFor(() => expect(within(empty).getAllByRole("cell")[6]).toHaveTextContent("—"));
  });

  // ★ No invented figures while the endpoint answers 404 — 2026-10-08.
  it("says there is no result yet, and draws no table, while the endpoint answers 404", async () => {
    setSearchParams("view=results");
    renderPage({ a79: { status: 404, body: { title: "Not found", status: 404 } } });

    expect(await screen.findByText("Үр дүн хараахан гараагүй байна")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Бүлгүүдийн үр дүнгийн үнэлгээ" })).toBeNull();
    expect(screen.queryByText(/Жишээ/)).toBeNull();
  });
});
