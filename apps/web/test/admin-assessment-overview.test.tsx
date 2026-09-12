import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminDashboard } from "@kinder/contracts";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
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

function renderPage() {
  stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: "/dashboard/admin", body: DASHBOARD },
    {
      path: "/kindergartens/33333333-3333-4333-8333-333333333333/development-domains",
      body: DOMAINS,
    },
  ]);

  return renderWithProviders(<AdminAssessmentPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the administrator assessment overview", () => {
  it("shows the whole kindergarten's assessment progress in one view", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Явцын үнэлгээ" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("2026 оны 1-р улирал")).toBeInTheDocument();

    const summary = screen.getByRole("region", { name: "Үнэлгээний товч мэдээлэл" });
    for (const label of ["Нийт бүлэг", "Үнэлгээний гүйцэтгэл", "Анхаарах бүлэг", "Үнэлгээ дутуу"]) {
      expect(within(summary).getByText(label)).toBeInTheDocument();
    }
    expect(within(summary).getAllByText("87%")).toHaveLength(2);
    expect(within(summary).getByText("8")).toBeInTheDocument();

    const comparison = screen.getByRole("region", { name: "Бүлгүүдийн харьцуулалт" });
    for (const group of ["Дэлбээ", "Солонго", "Одод"]) {
      expect(within(comparison).getByText(group)).toBeInTheDocument();
    }
    expect(within(comparison).getByText("100%")).toBeInTheDocument();
    expect(within(comparison).getByText("90%")).toBeInTheDocument();
    expect(within(comparison).getByText("70%")).toBeInTheDocument();
  });

  it("renders every configured development domain for every group without tabs", async () => {
    renderPage();

    const domains = await screen.findByRole("region", { name: "Хөгжлийн бүх үзүүлэлт" });

    expect(within(domains).getAllByText("Хэл яриа")).toHaveLength(4);
    expect(within(domains).getAllByText("Танин мэдэхүй")).toHaveLength(4);
    expect(
      within(domains).getByRole("img", { name: "Одод, Танин мэдэхүй — үнэлгээгүй" }),
    ).toBeInTheDocument();
    expect(within(domains).queryByRole("tab")).toBeNull();
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
});
