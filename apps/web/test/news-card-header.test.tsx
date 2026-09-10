import { screen, within } from "@testing-library/react";
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
 * The head of a notice card — one row on a phone, 2026-09-10, at the client's
 * request.
 *
 * ★ What they sent was the card read aloud, and it was five rows deep before a
 * word of the notice: the author's role, their name, the timestamp, a wrapped
 * strip of badges, and the audience on a line of its own.
 *
 * Two things came out of that and both are asserted here, because either can
 * be undone by a change that still looks reasonable in review:
 *
 *  - the **category and the audience are text on the meta line**, not badges.
 *    A category is administrator-editable, so putting it back in the badge
 *    strip re-opens the 2026-09-03 overflow this file's sibling comment
 *    records — a 405px row inside a 390px viewport that pushed the edit and
 *    delete buttons off-screen.
 *  - the meta line's **order** is name · time · audience · category. It reads
 *    as cosmetic and is not: the line truncates, so the order decides what a
 *    parent loses on a narrow phone, and the category is last because it is
 *    the one label with no bound on its length and the one the chip row above
 *    the feed already filters by.
 *
 * Neither fact had a test before this: `news-filters.test.tsx` covers the
 * controls above the feed and nothing covered the cards themselves.
 */

const GROUP_A = "44444444-4444-4444-8444-444444444444";
const AUTHOR = {
  id: "77777777-7777-4777-8777-777777777777",
  firstName: "Сувдаа",
  lastName: "Дорж",
};

const GROUPS = {
  items: [{ id: GROUP_A, name: "Дэлбээ бүлэг", ageBand: "MIDDLE", childCount: 18 }],
  page: 1,
  pageSize: 25,
  total: 1,
  totalPages: 1,
};

/**
 * ★ The category is the longest label the enum has.
 *
 * "Сургалт, үйл ажиллагаа" is the exact string that overflowed the card in
 * browser QA, so it is the one worth rendering in a test about this row.
 */
function notice(overrides: Record<string, unknown> = {}) {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    title: "Хэл ярианы хичээл",
    body: "Өнөөдөр үлгэрийн ном уншлаа",
    category: "ACTIVITY",
    status: "PUBLISHED",
    isImportant: false,
    publishedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    author: AUTHOR,
    reads: [],
    likeCount: 0,
    likedByMe: false,
    media: [],
    targets: [],
    ...overrides,
  };
}

function stubBoard(items: Record<string, unknown>[]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: "/children/mine", body: [] },
    { path: "/groups", body: GROUPS },
    {
      path: "/notifications",
      body: { items, page: 1, pageSize: 25, total: items.length, totalPages: 1 },
    },
  ]);
}

/** The card, found by the notice's own heading rather than by position. */
async function card() {
  const heading = await screen.findByRole("heading", { name: /Хэл ярианы хичээл/ });
  return within(heading.closest("article")!);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
  setSearchParams("");
});

describe("the notice card's header", () => {
  it("puts the name, the time, the audience and the category on one line", async () => {
    stubBoard([notice()]);
    renderWithProviders(<NotificationsPage />);

    expect(
      (await card()).getByText("Д.Сувдаа · Өнөөдөр · Бүх цэцэрлэг · Сургалт, үйл ажиллагаа"),
    ).toBeInTheDocument();
  });

  it("leads with the role, above that line", async () => {
    stubBoard([notice()]);
    renderWithProviders(<NotificationsPage />);

    expect((await card()).getByText("Бүлгийн багш")).toBeInTheDocument();
  });

  /**
   * ★ The audience is a phrase now, so a group notice has to read as one.
   *
   * It was an icon beside a list; the icon distinguished "the kindergarten"
   * from "some groups", which is exactly what the words already say.
   */
  it("names the groups a notice was aimed at, in the same line", async () => {
    stubBoard([
      notice({ targets: [{ groupId: GROUP_A, group: { id: GROUP_A, name: "Дэлбээ бүлэг" } }] }),
    ]);
    renderWithProviders(<NotificationsPage />);

    expect((await card()).getByText(/Дэлбээ бүлэг/)).toBeInTheDocument();
    expect((await card()).queryByText(/Бүх цэцэрлэг/)).not.toBeInTheDocument();
  });

  /**
   * ★ Children are counted, never named — unchanged by the move to text.
   *
   * A notice aimed at three children is aimed at three families, and printing
   * their names on a board every other family reads would tell each of them
   * who else was written to.
   */
  it("counts children rather than naming them", async () => {
    stubBoard([
      notice({
        targets: [
          {
            childId: "11111111-1111-4111-8111-111111111111",
            child: {
              id: "11111111-1111-4111-8111-111111111111",
              firstName: "Ану",
              lastName: "Бат",
            },
          },
          {
            childId: "22222222-2222-4222-8222-222222222222",
            child: {
              id: "22222222-2222-4222-8222-222222222222",
              firstName: "Тэмүүлэн",
              lastName: "Сүх",
            },
          },
        ],
      }),
    ]);
    renderWithProviders(<NotificationsPage />);

    const head = await card();
    expect(head.getByText(/2 хүүхэд/)).toBeInTheDocument();
    expect(head.queryByText(/Ану/)).not.toBeInTheDocument();
    expect(head.queryByText(/Тэмүүлэн/)).not.toBeInTheDocument();
  });

  /**
   * ★ Nothing administrator-editable is left in the badge strip.
   *
   * This is the assertion that guards the 2026-09-03 overflow. A category put
   * back beside "Чухал" would look like a tidy-up and would clip the menu off
   * a 390px screen again.
   */
  it("keeps only statuses as badges", async () => {
    stubBoard([notice({ isImportant: true, reads: [] })]);
    renderWithProviders(<NotificationsPage />);

    const badges = (await card())
      .getAllByText(/Чухал|Шинэ|Сургалт, үйл ажиллагаа/)
      .map((node) => node.textContent);

    expect(badges).toContain("Чухал");
    expect(badges).not.toContain("Сургалт, үйл ажиллагаа");
  });
});
