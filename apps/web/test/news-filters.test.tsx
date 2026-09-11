import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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
  it("gives a teacher no all-groups escape hatch", async () => {
    stubBoard(["TEACHER"]);
    renderWithProviders(<NotificationsPage />);

    await screen.findByText("Дэлбээ бүлэг");
    expect(screen.queryByText("Бүх бүлэг")).not.toBeInTheDocument();
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
