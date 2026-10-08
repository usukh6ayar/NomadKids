import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  selectOption,
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import NotificationsPage from "@/app/(app)/notifications/page";

/**
 * The class board's filters, and whose board it is.
 *
 * ★ Two client readings of the same screen, 2026-09-10.
 *
 * The filters fold behind one icon: nine categories, two flags and a date
 * range is four rows of chips above a feed, which on a phone is most of the
 * first screen spent on controls nobody has asked for yet. And "Бүх бүлэг"
 * became an administrator's chip — a teacher's board is their own group's, and
 * offering them every group invited the scroll past another group's notices
 * that the chip row exists to end.
 */

const GROUP_A = "44444444-4444-4444-8444-444444444444";
const GROUP_B = "55555555-5555-4555-8555-555555555555";

const GROUPS = {
  items: [
    { id: GROUP_A, name: "Дэлбээ бүлэг", ageBand: "MIDDLE", childCount: 18 },
    { id: GROUP_B, name: "Наран бүлэг", ageBand: "SENIOR", childCount: 20 },
  ],
  page: 1,
  pageSize: 25,
  total: 2,
  totalPages: 1,
};

function stubBoard(roles: Parameters<typeof sessionFor>[0]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    { path: "/children/mine", body: [] },
    { path: "/groups", body: GROUPS },
    {
      path: "/notifications",
      body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
  setSearchParams("");
});

describe("the news filter button", () => {
  it("hides the filters behind one unlabelled icon", async () => {
    stubBoard(["TEACHER"]);
    renderWithProviders(<NotificationsPage />);

    const trigger = await screen.findByRole("button", { name: "Шүүлтүүр" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // The client asked for an icon, not a word: the accessible name carries
    // the meaning a sighted reader gets from the glyph.
    expect(trigger).toHaveTextContent("");
    // The panel stays mounted so its ids hold for `aria-controls`; `toBeVisible`
    // is therefore the assertion that can tell open from closed.
    expect(screen.getByText("Зөвлөмж")).not.toBeVisible();
  });

  it("opens every filter the client listed", async () => {
    const user = userEvent.setup();
    stubBoard(["TEACHER"]);
    renderWithProviders(<NotificationsPage />);

    await user.click(await screen.findByRole("button", { name: "Шүүлтүүр" }));

    for (const label of [
      "Бүгд",
      "Зарлал",
      "Мэдээлэл",
      "Зөвлөмж",
      "Сургалт, үйл ажиллагаа",
      "Өдрийн дэглэм",
      "Зугаалга",
      "Өдөрлөг",
      "Төрсөн өдөр",
      "Бусад",
      "Уншаагүй",
      "Чухал",
      "Огноогоор",
    ]) {
      expect(screen.getByText(label), `${label} is missing`).toBeVisible();
    }
  });

  /*
   * ★ A filter that is on must never be invisible — the concern the date
   * chip's own note already records, now that the chips themselves can be
   * folded away.
   */
  it("counts the filters that are on, on the icon itself", async () => {
    const user = userEvent.setup();
    stubBoard(["TEACHER"]);
    renderWithProviders(<NotificationsPage />);

    const trigger = await screen.findByRole("button", { name: "Шүүлтүүр" });
    expect(within(trigger).queryByText("1")).not.toBeInTheDocument();

    await user.click(trigger);
    await user.click(screen.getByText("Уншаагүй"));

    await waitFor(() => expect(within(trigger).getByText("1")).toBeInTheDocument());

    await user.click(screen.getByText("Чухал"));
    // The two are exclusive, so turning one on turns the other off — still one.
    await waitFor(() => expect(within(trigger).getByText("1")).toBeInTheDocument());
  });

  it("closes again when the icon is pressed a second time", async () => {
    const user = userEvent.setup();
    stubBoard(["TEACHER"]);
    renderWithProviders(<NotificationsPage />);

    const trigger = await screen.findByRole("button", { name: "Шүүлтүүр" });
    await user.click(trigger);
    expect(screen.getByText("Зөвлөмж")).toBeVisible();

    await user.click(trigger);
    await waitFor(() => expect(screen.getByText("Зөвлөмж")).not.toBeVisible());
  });
});

describe("whose board a teacher sees", () => {
  /*
    ★ One row, on a phone too: the quiet group choice and «Шинэ мэдээ», which
    has no icon — 2026-10-08, the client.
  */
  it("puts the group choice and Шинэ мэдээ on one row, the button without an icon", async () => {
    stubBoard(["TEACHER"]);
    renderWithProviders(<NotificationsPage />);

    const button = await screen.findByRole("link", { name: "Шинэ мэдээ" });
    expect(button.querySelector("svg")).toBeNull();
    const select = await screen.findByLabelText("Бүлгийн самбар");
    expect(select.closest("label")!.parentElement).toBe(button.parentElement);
  });

  /*
    ★ Reversed 2026-10-08, the client: "багш мэдээ хэсэгт өөрийн болон бусад
    бүлгийг харах боломжтой болго". A teacher still lands on their own group;
    «Бүх бүлэг» and the other groups the notices name are one choice away.
  */
  it("offers a teacher Бүх бүлэг, and the other groups the notices name", async () => {
    const user = userEvent.setup();
    const GROUP_C = "66666666-6666-4666-8666-666666666666";
    const notice = (id: string, group: { id: string; name: string }) => ({
      id,
      title: `${group.name}-ийн мэдээ`,
      body: "Маргааш",
      reads: [],
      targets: [{ groupId: group.id, group }],
    });
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/children/mine", body: [] },
      // A teacher's own groups only — `GET /groups` gives them nothing else.
      { path: "/groups", body: { ...GROUPS, items: [GROUPS.items[0]], total: 1 } },
      {
        path: "/notifications",
        body: {
          items: [
            notice("cccccccc-cccc-4ccc-8ccc-000000000001", { id: GROUP_A, name: "Дэлбээ бүлэг" }),
            notice("cccccccc-cccc-4ccc-8ccc-000000000002", { id: GROUP_C, name: "Хонгор бүлэг" }),
          ],
          page: 1,
          pageSize: 25,
          total: 2,
          totalPages: 1,
        },
      },
    ]);
    renderWithProviders(<NotificationsPage />);

    await screen.findByText("Хонгор бүлэг-ийн мэдээ");
    // The other groups' names come from one bounded read across the kindergarten.
    expect(api.calls.some((call) => call.url === "/notifications?page=1&pageSize=50")).toBe(true);
    await selectOption(user, "Бүлгийн самбар", "Хонгор бүлэг");
    await waitFor(() =>
      expect(api.calls.some((call) => call.url.includes(`groupId=${GROUP_C}`))).toBe(true),
    );
    await selectOption(user, "Бүлгийн самбар", "Бүх бүлэг");
    await waitFor(() =>
      expect(
        api.calls.some(
          (call) => call.url.startsWith("/notifications?") && !call.url.includes("groupId"),
        ),
      ).toBe(true),
    );
  });

  it("lands a teacher on their own group rather than an unfiltered feed", async () => {
    const api = stubBoard(["TEACHER"]);
    renderWithProviders(<NotificationsPage />);

    await screen.findByText("Дэлбээ бүлэг");
    // Without a "Бүх бүлэг" chip, an empty groupId would show every group's
    // board with nothing lit to say so.
    await waitFor(() =>
      expect(api.calls.some((call) => call.url.includes(`groupId=${GROUP_A}`))).toBe(true),
    );
  });

  it("keeps Бүх бүлэг for an administrator, who reads across the kindergarten", async () => {
    stubBoard(["ADMIN"]);
    renderWithProviders(<NotificationsPage />);

    expect(await screen.findByText("Бүх бүлэг")).toBeInTheDocument();
  });
});

/*
 * ★ The board opens for the roles whose shell has no selected child —
 * 2026-09-26. `(app)/layout.tsx` gives the cook, the accountant and the
 * platform operator their shell *before* `SelectedChildProvider`, and this
 * page called `useSelectedChild()`, which throws outside it: all three got
 * «Алдаа гарлаа» on the notice board. Found by walking the screens in a
 * browser; every test passed because the render helper supplied the provider
 * the real layout never mounts.
 */
describe("the board without a selected child", () => {
  it.each([["COOK"], ["ACCOUNTANT"]] as const)("opens for a %s", async (role) => {
    stubBoard([role]);
    renderWithProviders(<NotificationsPage />, { selectedChild: false });

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText("Алдаа гарлаа")).not.toBeInTheDocument();
  });
});
