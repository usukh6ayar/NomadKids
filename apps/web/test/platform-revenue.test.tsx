import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi, type RouteStub } from "./support/render";
import PlatformRevenuePage from "@/app/(app)/platform/revenue/page";

/*
 * ★ The platform's income is two sources since 2026-10-12 — access fees and
 * teaching-material sales (the user's decision) — and the shares are taken
 * from their sum.
 */
afterEach(() => vi.unstubAllGlobals());

const operator = () => {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
};

const PARTNER = "77777777-7777-4777-8777-777777777777";
const KINDERGARTEN = "88888888-8888-4888-8888-888888888888";

const DISTRIBUTION = {
  month: "2026-10",
  accessFees: "15000.00",
  accessPayments: 3,
  materialSales: "8000.00",
  materialPayments: 2,
  total: "23000.00",
  allocatedPercent: "0",
  unallocated: "23000.00",
  shares: [],
};

const REVENUE = {
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
};

const partner = (overrides: Record<string, unknown> = {}) => ({
  id: PARTNER,
  name: "Бат-Эрдэнэ",
  sharePercent: "30",
  effectiveFrom: "2026-09-01",
  effectiveTo: null,
  note: null,
  ...overrides,
});

/** The screen's three reads, each overridable; `extra` goes first so it wins. */
function renderRevenue({
  revenue = REVENUE,
  distribution = DISTRIBUTION,
  partners = [] as unknown[],
  extra = [] as RouteStub[],
} = {}) {
  const api = stubApi([
    ...extra,
    { path: "/auth/me", body: operator() },
    { path: "/platform/partners", method: "GET", body: partners },
    { path: "/platform/revenue/distribution", body: distribution },
    { path: "/platform/revenue", body: revenue },
  ]);
  renderWithProviders(<PlatformRevenuePage />);
  return api;
}

describe("the operator's revenue screen", () => {
  it("shows the total and each of the two incomes", async () => {
    renderRevenue();

    const card = (await screen.findByText("Платформын орлого")).parentElement!;
    expect(within(card).getByText("23 000₮")).toBeInTheDocument();
    expect(within(card).getByText("15 000₮")).toBeInTheDocument();
    expect(within(card).getByText("3 төлөлт")).toBeInTheDocument();
    expect(within(card).getByText("Материалын борлуулалт")).toBeInTheDocument();
    expect(within(card).getByText("8 000₮")).toBeInTheDocument();
    expect(within(card).getByText("2 худалдан авалт")).toBeInTheDocument();
  });

  it("lists each kindergarten's access fees, and says so when there are none", async () => {
    renderRevenue({
      revenue: {
        ...REVENUE,
        kindergartens: [
          {
            kindergartenId: KINDERGARTEN,
            name: "Нарлаг цэцэрлэг",
            entries: 12,
            calculated: "0.00",
            approved: "0.00",
            received: "1400000.00",
            accessFees: "15000.00",
            accessPayments: 3,
          },
        ],
      } as typeof REVENUE,
    });

    const section = await screen.findByRole("region", { name: "Цэцэрлэг тус бүрээр" });
    expect(within(section).getByText("Нарлаг цэцэрлэг")).toBeInTheDocument();
    expect(within(section).getByText("3 төлөлт · 12 санхүүжилтийн бүртгэл")).toBeInTheDocument();
    expect(within(section).getByTitle("Хандалтын төлбөр — платформын орлого")).toHaveTextContent(
      "15 000₮",
    );
    expect(within(section).getByTitle("Улсаас цэцэрлэгт")).toHaveTextContent("1 400 000₮");
  });

  it("says when no kindergarten paid anything this month", async () => {
    renderRevenue();

    const section = await screen.findByRole("region", { name: "Цэцэрлэг тус бүрээр" });
    expect(section).toHaveTextContent("Энэ сард хандалтын төлбөр төлөгдөөгүй");
  });

  it("divides the income by share, and shows what is left unallocated", async () => {
    renderRevenue({
      distribution: {
        ...DISTRIBUTION,
        allocatedPercent: "30",
        unallocated: "16100.00",
        shares: [
          { partnerId: PARTNER, name: "Бат-Эрдэнэ", sharePercent: "30", amount: "6900.00" },
        ] as never[],
      },
    });

    const section = await screen.findByRole("region", { name: "Хуваарилалт" });
    expect(within(section).getByText("Бат-Эрдэнэ")).toBeInTheDocument();
    expect(within(section).getByText("30%")).toBeInTheDocument();
    expect(within(section).getByText("6 900₮")).toBeInTheDocument();
    expect(
      within(section).getByText("Хуваарилаагүй үлдэгдэл — нийт 30% тохирсон"),
    ).toBeInTheDocument();
    expect(within(section).getByText("16 100₮")).toBeInTheDocument();
  });

  it("shows no remainder once the shares reach 100%", async () => {
    renderRevenue({
      distribution: {
        ...DISTRIBUTION,
        allocatedPercent: "100",
        unallocated: "0.00",
        shares: [
          { partnerId: PARTNER, name: "Бат-Эрдэнэ", sharePercent: "100", amount: "23000.00" },
        ] as never[],
      },
      partners: [partner({ sharePercent: "100" })],
    });

    const section = await screen.findByRole("region", { name: "Хуваарилалт" });
    expect(within(section).queryByText(/Хуваарилаагүй үлдэгдэл/)).toBeNull();
    // Nothing is left to give, so nobody can be added.
    const people = screen.getByRole("region", { name: "Хувь тохирсон хүмүүс" });
    expect(await within(people).findByText("Бат-Эрдэнэ")).toBeInTheDocument();
    expect(within(people).getByRole("button", { name: "Хүн нэмэх" })).toBeDisabled();
  });

  it("adds a partner with the share, the start date and a note", async () => {
    const user = userEvent.setup();
    const { calls } = renderRevenue({
      extra: [{ path: "/platform/partners", method: "POST", status: 201, body: partner() }],
    });

    const people = await screen.findByRole("region", { name: "Хувь тохирсон хүмүүс" });
    expect(await within(people).findByText("Хувь тохирсон хүн алга")).toBeInTheDocument();
    await user.click(within(people).getAllByRole("button", { name: "Хүн нэмэх" })[0]!);

    const dialog = screen.getByRole("dialog", { name: "Хувь тохирсон хүн нэмэх" });
    expect(within(dialog).getByText("Үлдсэн 100% хуваарилагдаагүй байна.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Нэр/), "  Бат-Эрдэнэ ");
    await user.type(within(dialog).getByLabelText(/Хувь/), "30");
    await user.type(within(dialog).getByLabelText("Тэмдэглэл"), "Гэрээ №12");
    await user.click(within(dialog).getByRole("button", { name: "Нэмэх" }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === "POST")?.body).toEqual({
        name: "Бат-Эрдэнэ",
        sharePercent: "30",
        effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}-01$/),
        note: "Гэрээ №12",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Хувь тохирсон хүн нэмэх" })).toBeNull(),
    );
  });

  it("asks before removing a partner, then removes them", async () => {
    const user = userEvent.setup();
    const { calls } = renderRevenue({
      partners: [partner({ note: "Гэрээ №12" })],
      extra: [{ path: `/platform/partners/${PARTNER}`, method: "DELETE", status: 204 }],
    });

    const people = await screen.findByRole("region", { name: "Хувь тохирсон хүмүүс" });
    expect(await within(people).findByText(/одоог хүртэл · Гэрээ №12/)).toBeInTheDocument();
    await user.click(within(people).getByRole("button", { name: "Хасах" }));

    // Nothing is sent before the confirmation (CLAUDE.md §5).
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    const confirm = screen.getByRole("dialog", { name: "Бат-Эрдэнэ-г хасах уу?" });
    await user.click(within(confirm).getByRole("button", { name: "Хасах" }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === "DELETE")?.url).toBe(
        `/platform/partners/${PARTNER}`,
      ),
    );
  });

  it("marks a partner whose agreement has ended", async () => {
    renderRevenue({ partners: [partner({ effectiveTo: "2026-09-30" })] });

    const people = await screen.findByRole("region", { name: "Хувь тохирсон хүмүүс" });
    expect(await within(people).findByText("Дууссан")).toBeInTheDocument();
    // An ended agreement holds no share now.
    expect(within(people).getByText("Одоогийн хуваарилалт 0%")).toBeInTheDocument();
  });
});
