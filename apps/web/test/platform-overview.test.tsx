import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROUTER, renderWithProviders, sessionFor, stubApi } from "./support/render";
import PlatformOverviewPage from "@/app/(app)/platform/overview/page";

/*
 * ★ «Самбар» — the operator's first screen (2026-10-13, the user): what is
 * waiting comes first, counted from the list routes that exist, and nothing
 * is shown for a queue the API cannot count.
 */
afterEach(() => vi.unstubAllGlobals());

const operator = () => {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
};

const page = (total: number) => ({ items: [], page: 1, pageSize: 1, total, totalPages: 1 });

describe("the operator's dashboard", () => {
  it("lists what is waiting, each row linking to the work", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: page(3) },
      { path: "/platform/solo-workspaces", body: page(2) },
    ]);
    renderWithProviders(<PlatformOverviewPage />);

    const applications = await screen.findByRole("link", { name: /байгууллагын хүсэлт/ });
    expect(applications).toHaveAttribute("href", "/platform/applications");
    expect(applications).toHaveTextContent("3 байгууллагын хүсэлт хүлээгдэж байна");
    expect(screen.getByRole("link", { name: /бие даасан багш/ })).toHaveAttribute(
      "href",
      "/platform/solo-workspaces",
    );
  });

  it("says nothing is waiting when both queues are empty", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: page(0) },
      { path: "/platform/solo-workspaces", body: page(0) },
    ]);
    renderWithProviders(<PlatformOverviewPage />);

    expect(await screen.findByText("Хүлээгдэж буй ажил алга.")).toBeInTheDocument();
  });

  it("shows the platform's figures and this month's income, linked to «Орлого»", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: page(0) },
      { path: "/platform/solo-workspaces", body: page(0) },
      {
        path: "/platform/stats",
        body: { kindergartens: 12, groups: 48, children: 1250, staff: 160, guardians: 980 },
      },
      {
        path: "/platform/revenue",
        body: {
          month: "2026-10",
          kindergartens: [],
          state: { calculated: "0.00", approved: "0.00", received: "0.00" },
          platform: {
            accessFees: "15000.00",
            accessPayments: 3,
            materialSales: "8000.00",
            materialPayments: 2,
            total: "23000.00",
          },
        },
      },
    ]);
    renderWithProviders(<PlatformOverviewPage />);

    const figures = await screen.findByRole("region", { name: "Системийн товч мэдээлэл" });
    for (const [label, value] of [
      ["Цэцэрлэг", "12"],
      ["Бүлэг", "48"],
      ["Хүүхэд", "1,250"],
      ["Багш, ажилтан", "160"],
      ["Идэвхтэй эцэг эх", "980"],
    ] as const) {
      expect(within(figures).getByText(label).nextElementSibling).toHaveTextContent(value);
    }

    const income = await screen.findByRole("region", { name: "Энэ сарын орлого" });
    expect(income).toHaveTextContent("23,000₮");
    expect(within(income).getByRole("link", { name: "Дэлгэрэнгүй" })).toHaveAttribute(
      "href",
      "/platform/revenue",
    );
  });

  it("is the operator's alone — anyone else is sent home and sees nothing", async () => {
    ROUTER.replace.mockClear();
    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"]) }]);
    renderWithProviders(<PlatformOverviewPage />);

    await vi.waitFor(() => expect(ROUTER.replace).toHaveBeenCalledWith("/"));
    expect(screen.queryByRole("heading", { name: "Самбар" })).toBeNull();
  });

  /*
   * ★ What should come into the account — 2026-10-14, the user checks the bank
   * by hand, so the board says who owes and how much.
   */
  it("says how many kindergartens owe and how much, when the API counts it", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: page(0) },
      { path: "/platform/solo-workspaces", body: page(0) },
      {
        path: "/platform/payments/summary",
        body: { waitingKindergartens: 4, waitingAmount: "144000.00", overdueKindergartens: 1 },
      },
    ]);
    renderWithProviders(<PlatformOverviewPage />);

    const row = await screen.findByRole("link", { name: /төлбөр хүлээгдэж байна/ });
    expect(row).toHaveTextContent("4 цэцэрлэгийн төлбөр хүлээгдэж байна · 144,000₮ (1 хоцорсон)");
    expect(row).toHaveAttribute("href", "/platform");
  });

  it("names the contracts that ended or end within 14 days, each linked filtered", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 14));
    try {
      const kg = (id: string, contractEndsOn: string) => ({
        id,
        name: id,
        address: null,
        phone: null,
        email: null,
        isActive: true,
        createdAt: "2026-09-01T00:00:00Z",
        contractEndsOn,
      });
      stubApi([
        { path: "/auth/me", body: operator() },
        { path: "/platform/applications", body: page(0) },
        { path: "/platform/solo-workspaces", body: page(0) },
        {
          path: "/platform/kindergartens",
          body: {
            items: [
              kg("11111111-1111-4111-8111-111111111111", "2026-10-01"),
              kg("22222222-2222-4222-8222-222222222222", "2026-09-30"),
              kg("33333333-3333-4333-8333-333333333333", "2026-10-20"),
              kg("44444444-4444-4444-8444-444444444444", "2027-05-31"),
            ],
            page: 1,
            pageSize: 100,
            total: 4,
            totalPages: 1,
          },
        },
      ]);
      renderWithProviders(<PlatformOverviewPage />);

      const ended = await screen.findByRole("link", { name: /гэрээ дууссан/ });
      expect(ended).toHaveTextContent("2 цэцэрлэгийн гэрээ дууссан");
      expect(ended).toHaveAttribute("href", "/platform?ending=ended");
      const ending = screen.getByRole("link", { name: /14 хоногт дуусна/ });
      expect(ending).toHaveTextContent("1 цэцэрлэгийн гэрээ 14 хоногт дуусна");
      expect(ending).toHaveAttribute("href", "/platform?ending=14");
    } finally {
      vi.useRealTimers();
    }
  });
});
