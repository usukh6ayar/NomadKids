import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { LowNotesReminder, childrenBehind } from "@/components/assessment/low-notes-reminder";

/*
 * ★ «Тэмдэглэл цөөн хүүхэд» — 2026-10-08, the client: on «Явцын үнэлгээ», the
 * children with fewer notes than the rest, each hidden with an ×.
 */

const GROUP = "44444444-4444-4444-8444-444444444444";
const id = (n: number) => `c${n}c${n}c${n}c${n}-0000-4000-8000-00000000000${n}`;

describe("who is behind", () => {
  const kids = [1, 2, 3, 4].map((n) => ({ id: id(n) }));

  it("names children under half the group's average, fewest first", () => {
    // Average 3 → under 1.5.
    const counts = [
      { childId: id(1), count: 6 },
      { childId: id(2), count: 5 },
      { childId: id(3), count: 1 },
    ];
    expect(childrenBehind(kids, counts)).toEqual([
      { id: id(4), count: 0 },
      { id: id(3), count: 1 },
    ]);
  });

  it("names nobody while the group itself has under a note a child", () => {
    expect(childrenBehind(kids, [{ childId: id(1), count: 3 }])).toEqual([]);
    expect(childrenBehind(kids, [])).toEqual([]);
  });
});

describe("the reminder", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  function stub() {
    const child = (n: number, first: string) => ({
      id: id(n),
      firstName: first,
      lastName: "Болд",
      dateOfBirth: "2021-04-02",
      kindergartenId: "33333333-3333-4333-8333-333333333333",
    });
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/groups/${GROUP}/observation-stats`,
        body: {
          total: 12,
          enrolled: 4,
          childrenWithNotes: 3,
          byChild: [
            { childId: id(1), count: 6 },
            { childId: id(2), count: 5 },
            { childId: id(3), count: 1 },
          ],
        },
      },
      {
        path: "/children",
        body: {
          items: [child(1, "Ану"), child(2, "Сарнай"), child(3, "Тэмүүлэн"), child(4, "Намуун")],
          page: 1,
          pageSize: 100,
          total: 4,
          totalPages: 1,
        },
      },
    ]);
  }

  it("names the children behind, each opening their notes, and hides one with ×", async () => {
    const user = userEvent.setup();
    stub();
    const first = renderWithProviders(<LowNotesReminder groupId={GROUP} />);

    const box = await screen.findByRole("region", { name: "Тэмдэглэл цөөн хүүхэд" });
    const links = within(box).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Б.Намуун · 0", "Б.Тэмүүлэн · 1"]);
    expect(links[0]).toHaveAttribute("href", `/children/${id(4)}/observations?type=daily`);
    expect(within(box).queryByText(/Ану/)).toBeNull();

    await user.click(within(box).getByRole("button", { name: "Б.Намуун-г нуух" }));
    expect(within(box).queryByText(/Намуун/)).toBeNull();

    // Still hidden after leaving and coming back this month.
    first.unmount();
    renderWithProviders(<LowNotesReminder groupId={GROUP} />);
    const again = await screen.findByRole("region", { name: "Тэмдэглэл цөөн хүүхэд" });
    expect(within(again).getByText(/Тэмүүлэн/)).toBeInTheDocument();
    expect(within(again).queryByText(/Намуун/)).toBeNull();
  });

  it("disappears once every name is hidden", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<LowNotesReminder groupId={GROUP} />);

    const box = await screen.findByRole("region", { name: "Тэмдэглэл цөөн хүүхэд" });
    await user.click(within(box).getByRole("button", { name: "Б.Намуун-г нуух" }));
    await user.click(within(box).getByRole("button", { name: "Б.Тэмүүлэн-г нуух" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Тэмдэглэл цөөн хүүхэд" })).toBeNull(),
    );
  });
});
