import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import KitchenAttendancePage from "@/app/(app)/kitchen/attendance/page";

/**
 * The cook's «Ирц», today made plain — client, 2026-10-06: the board's
 * attendance card, one table a group a line with each status in its own
 * column and the day's total at the foot. «Тараалт» was taken off the same day.
 */

const GROUP_A = "44444444-4444-4444-8444-444444444441";
const GROUP_B = "44444444-4444-4444-8444-444444444442";

function stub() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["COOK"]) },
    {
      path: "/dashboard/cook",
      body: {
        attendanceToday: { expected: 46, recorded: 25, present: 23 },
        attendanceByGroup: [
          {
            groupId: GROUP_A,
            name: "Дэлбээ",
            counts: { PRESENT: 22, HALF_DAY: 1, SICK: 1, EXCUSED: 1 },
          },
        ],
        pendingFoodOrders: 0,
        lowStockCount: 0,
        groups: [
          { groupId: GROUP_A, name: "Дэлбээ", enrolled: 25, present: 23, recorded: 25 },
          { groupId: GROUP_B, name: "Солонго", enrolled: 21, present: 0, recorded: 0 },
        ],
        meals: { byKind: [], served: 0, special: 0, excused: 0, allergyChildren: 0 },
      },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the cook's attendance, today", () => {
  it("opens on the attendance card and a table of the groups with the day's total", async () => {
    stub();
    renderWithProviders(<KitchenAttendancePage />);

    const card = (await screen.findByRole("heading", { name: "Өнөөдрийн ирц" })).closest(
      "section",
    )!;
    expect(within(card).getByText("/ 46 хүүхэд")).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Бүлгүүдийн өнөөдрийн ирц" });
    const cells = (name: string) =>
      within(table)
        .getAllByRole("row")
        .map((row) =>
          within(row)
            .queryAllByRole("cell")
            .map((cell) => cell.textContent),
        )
        .find((row) => row[0] === name);

    // Бүлэг · Нийт · Ирсэн · Өвчтэй · Чөлөөтэй · Тасалсан · Бүртгээгүй
    expect(cells("Дэлбээ")).toEqual(["Дэлбээ", "25", "23", "1", "1", "0", "0"]);
    // No register yet: dashes, and the whole roll unanswered for.
    expect(cells("Солонго")).toEqual(["Солонго", "21", "—", "—", "—", "—", "21"]);
    expect(cells("Нийт")).toEqual(["Нийт", "46", "23", "1", "1", "0", "21"]);

    // The three tiles it replaced are gone.
    expect(screen.queryByText("Өнөөдөр хоолох хүүхэд")).toBeNull();
    expect(screen.queryByText("Тараалт бүртгэсэн бүлэг")).toBeNull();
  });

  /** Client, 2026-10-06: nothing else read it, so it went. */
  it("has no Тараалт and asks nothing about it", async () => {
    const api = stub();
    renderWithProviders(<KitchenAttendancePage />);

    expect(
      await screen.findByRole("table", { name: "Бүлгүүдийн өнөөдрийн ирц" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Тараалт/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Өглөөний хоол" })).toBeNull();
    expect(api.calls.some((call) => call.url.includes("meal-servings"))).toBe(false);
  });

  /** Client, 2026-10-06: «бүлгийн ирц дээр хайх». */
  it("narrows the table to the groups whose name matches, totals included", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<KitchenAttendancePage />);

    const table = await screen.findByRole("table", { name: "Бүлгүүдийн өнөөдрийн ирц" });
    await user.type(screen.getByLabelText("Бүлгийн нэрээр хайх"), "солон");

    expect(within(table).queryByText("Дэлбээ")).toBeNull();
    expect(within(table).getByText("Солонго")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 бүлэг")).toBeInTheDocument();
    const total = within(table).getByText("Нийт", { selector: "td" }).closest("tr")!;
    expect(within(total).getAllByRole("cell")[1]).toHaveTextContent("21");

    await user.clear(screen.getByLabelText("Бүлгийн нэрээр хайх"));
    await user.type(screen.getByLabelText("Бүлгийн нэрээр хайх"), "наран");
    expect(screen.getByText("«наран» нэртэй бүлэг олдсонгүй.")).toBeInTheDocument();
  });
});
