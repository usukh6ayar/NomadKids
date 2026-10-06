import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import KitchenDashboardPage from "@/app/(app)/kitchen/dashboard/page";

const KG_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_A = "44444444-4444-4444-8444-444444444441";
const GROUP_B = "44444444-4444-4444-8444-444444444442";

/**
 * Тогоочийн самбар — the client's 2026-09-17 design.
 *
 * ★ What these cases hold is the distinction the screen exists to make:
 * **ирсэн** is the attendance register, **тараасан порц** is the meal
 * register, and **нийт хүүхэд** is the roster. A board that blurred them would
 * tell a kitchen it had cooked when nobody had filled anything in.
 */
function board(overrides: Record<string, unknown> = {}) {
  return {
    attendanceToday: { expected: 46, recorded: 23, present: 43 },
    attendanceByGroup: [],
    pendingFoodOrders: 1,
    lowStockCount: 2,
    groups: [
      { groupId: GROUP_A, name: "Дэлбээ", enrolled: 25, present: 23, recorded: 25 },
      { groupId: GROUP_B, name: "Солонго", enrolled: 21, present: 0, recorded: 0 },
    ],
    meals: {
      byKind: [
        { kind: "BREAKFAST", portions: 41 },
        { kind: "LUNCH", portions: 43 },
      ],
      served: 84,
      special: 4,
      excused: 3,
      allergyChildren: 6,
    },
    ...overrides,
  };
}

function stub(data: Record<string, unknown> = board()) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["COOK"]) },
    { path: "/dashboard/cook", body: data },
    {
      path: `/kindergartens/${KG_ID}/menu/with-warnings`,
      body: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          date: new Date().toISOString().slice(0, 10),
          dishes: [
            {
              name: "Сүүтэй овъёосны каш",
              kind: "BREAKFAST",
              time: "08:00",
              photoMediaFileId: "77777777-7777-4777-8777-777777777777",
            },
            { name: "Үхрийн махтай шөл", kind: "SNACK", time: "12:30" },
          ],
          totalCalories: null,
          status: "APPROVED",
          warnings: [],
        },
      ],
    },
    {
      path: `/kindergartens/${KG_ID}/stock`,
      body: [
        {
          ingredient: {
            id: "11111111-1111-4111-8111-111111111112",
            name: "Сонгино",
            unit: "GRAM",
          },
          onHand: "5",
          minStock: "10",
          low: true,
        },
        {
          ingredient: {
            id: "11111111-1111-4111-8111-111111111113",
            name: "Гурил",
            unit: "GRAM",
          },
          onHand: "50",
          minStock: "10",
          low: false,
        },
      ],
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the cook's board", () => {
  /**
   * ★ Client, 2026-10-06: the kindergarten's attendance and the groups' table
   * under it, in place of «Өнөөдөр хоолох хүүхэд», «Тараасан порц»,
   * «Тусгай хоол» and «Анхаарах зүйлс».
   */
  it("leads with today's attendance and the groups' table under it", async () => {
    stub();
    renderWithProviders(<KitchenDashboardPage />);

    const card = (await screen.findByRole("heading", { name: "Өнөөдрийн ирц" })).closest(
      "section",
    )!;
    expect(within(card).getByText("43")).toBeInTheDocument();
    expect(within(card).getByText("/ 46 хүүхэд ирсэн")).toBeInTheDocument();
    expect(within(card).getByText("93%")).toBeInTheDocument();

    const table = screen.getByRole("heading", { name: "Бүлгүүдийн ирц" });
    expect(card.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      table.compareDocumentPosition(screen.getByRole("heading", { name: "Өнөөдрийн цэс" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    for (const gone of [
      "Өнөөдөр хоолох хүүхэд",
      "Тараасан порц",
      "Тусгай хоол",
      "Анхаарах зүйлс",
    ]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it("says how many groups have filled the register in, and warns about the rest", async () => {
    stub();
    renderWithProviders(<KitchenDashboardPage />);

    expect(await screen.findByText("2 бүлгээс 1 бүлгийн ирц бүртгэгдсэн")).toBeInTheDocument();
    expect(screen.getByText("1 бүлэг ирцээ оруулаагүй байна")).toBeInTheDocument();
  });

  /** A group with no register shows a dash: "nobody came" is not "nobody said". */
  it("draws a dash for a group whose register is empty", async () => {
    stub();
    renderWithProviders(<KitchenDashboardPage />);

    const row = (await screen.findByText("Солонго")).closest("tr")!;
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(row).getByText("Ирц дутуу")).toBeInTheDocument();
  });

  it("shows today's menu by sitting", async () => {
    stub();
    renderWithProviders(<KitchenDashboardPage />);

    expect(await screen.findByText(/Сүүтэй овъёосны каш/)).toBeInTheDocument();
    expect(screen.getByText("Өглөөний хоол")).toBeInTheDocument();
  });

  /**
   * ★ Client, 2026-10-06: the menu with pictures, and no clock. A sitting
   * whose dishes carry no photo gets a plate on a tint, not a stand-in image.
   */
  it("leads each sitting with its dish's photo, and prints no time", async () => {
    stub();
    renderWithProviders(<KitchenDashboardPage />);

    const breakfast = await screen.findByRole("listitem", { name: "Өглөөний хоол" });
    const photo = within(breakfast).getByRole("img", { name: "Сүүтэй овъёосны каш" });
    expect(photo.getAttribute("src")).toContain("/media/77777777-7777-4777-8777-777777777777");

    const soup = screen.getByRole("listitem", { name: "Шөл" });
    expect(within(soup).queryByRole("img")).toBeNull();
    expect(screen.queryByText("08:00")).toBeNull();
    expect(screen.queryByText("12:30")).toBeNull();
  });

  it("flags the ingredients that are low and leaves the rest alone", async () => {
    stub();
    renderWithProviders(<KitchenDashboardPage />);

    await screen.findByText("Хүнсний нөөц");
    const low = (await screen.findByText("Сонгино")).closest("div")!;
    expect(within(low.parentElement as HTMLElement).getByText("Нөөц бага")).toBeInTheDocument();
  });

  it("raises no warning once every group has filled its register in", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["COOK"]) },
      {
        path: "/dashboard/cook",
        body: board({
          pendingFoodOrders: 0,
          lowStockCount: 0,
          groups: [{ groupId: GROUP_A, name: "Дэлбээ", enrolled: 25, present: 23, recorded: 25 }],
          meals: { byKind: [], served: 0, special: 0, excused: 0, allergyChildren: 0 },
        }),
      },
      { path: `/kindergartens/${KG_ID}/menu/with-warnings`, body: [] },
      { path: `/kindergartens/${KG_ID}/stock`, body: [] },
    ]);
    renderWithProviders(<KitchenDashboardPage />);

    expect(await screen.findByText("1 бүлгээс 1 бүлгийн ирц бүртгэгдсэн")).toBeInTheDocument();
    expect(screen.queryByText(/ирцээ оруулаагүй/)).toBeNull();
  });
});
