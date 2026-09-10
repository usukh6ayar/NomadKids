import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import DashboardPage from "@/app/(app)/dashboard/page";

/**
 * The teacher dashboard's tile band — the eight doors under the greeting.
 *
 * ★ Eight since 2026-09-10, all at the client's request and all in one day:
 * Ирц · Мэдээ · Судалгаа · Явцын үнэлгээ, then Тайлан and Баримт бичгийн сан,
 * then Хүүхдүүд and Хоол ба цэс.
 *
 * Every destination already existed and was already in the sidebar. What this
 * file is really guarding is the pair of things that made them worth adding
 * here and can silently rot: that the hrefs are real routes, and that every
 * tile carries its own illustration. `sidebar.test.tsx` exists because eight
 * section rows once shipped with no icon at all and nothing failed.
 *
 * ★★ The band is asserted **in order**, not as a set. Which tiles are on it is
 * the client's list; the order is a claim of its own — the first row is the
 * morning's work — and a set assertion would let a refactor reshuffle it into
 * the history's order without a word.
 */

const GROUP_ID = "66666666-6666-4666-8666-666666666666";

const emptyDashboard = {
  counts: { children: 0, groups: 0, pendingReviews: 0, observationsThisWeek: 0 },
  needsAttention: { childrenMissingAssessment: [], pendingReviews: 0 },
  recentObservations: [],
  currentTerm: null,
  birthdaysToday: [],
  termProgress: { assessed: 0, total: 0 },
};

function stubDashboard(withGroup = true) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: "/dashboard/teacher", body: emptyDashboard },
    {
      path: "/groups",
      body: withGroup
        ? {
            items: [{ id: GROUP_ID, name: "Дэлбээ бүлэг", ageBand: "MIDDLE", childCount: 18 }],
            page: 1,
            pageSize: 25,
            total: 1,
            totalPages: 1,
          }
        : { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

/**
 * The tile band alone.
 *
 * ★ Scoped by testid rather than queried off `screen`. The rest of the
 * dashboard carries its own links — `AttendanceToday` has an "Ирц бүртгэх"
 * button — so a bare `/Ирц/` would sometimes match two nodes and fail with a
 * message about ambiguity rather than about the band.
 */
async function tiles() {
  return within(await screen.findByTestId("teacher-quick-actions"));
}

describe("the teacher dashboard's quick actions", () => {
  it("offers all eight doors in order, each with its own drawing", async () => {
    stubDashboard();
    renderWithProviders(<DashboardPage />);
    const band = await tiles();

    const expected = [
      ["Ирц", "/attendance", "icon-attendance-3d.png"],
      ["Хүүхдүүд", "/children", "icon-children-3d.png"],
      ["Хоол ба цэс", "/meals", "icon-food-3d.png"],
      ["Мэдээ", "/notifications/new", "icon-notice-3d.png"],
      ["Судалгаа", "/surveys", "icon-survey-3d.png"],
      ["Явцын үнэлгээ", "/assessment", "icon-progress-3d.png"],
      ["Тайлан", "/reports", "icon-report-3d.png"],
      ["Баримт бичгийн сан", "/documents", "icon-documents-3d.png"],
    ] as const;

    const links = band.getAllByRole("link");
    expect(links).toHaveLength(expected.length);

    expected.forEach(([title, href, asset], index) => {
      const tile = links[index]!;
      expect(tile.textContent, `tile ${index} is not ${title}`).toContain(title);
      expect(tile.getAttribute("href"), `${title} points somewhere unexpected`).toContain(href);
      expect(
        within(tile).getByRole("presentation", { hidden: true }).getAttribute("src"),
        `${title} has no drawing`,
      ).toContain(asset);
    });
  });

  it("sends the kindergarten-wide tiles at the routes that exist", async () => {
    stubDashboard();
    renderWithProviders(<DashboardPage />);
    const band = await tiles();

    expect(band.getByRole("link", { name: /Тайлан/ })).toHaveAttribute("href", "/reports");
    expect(band.getByRole("link", { name: /Баримт бичгийн сан/ })).toHaveAttribute(
      "href",
      "/documents",
    );
    expect(band.getByRole("link", { name: /Хүүхдүүд/ })).toHaveAttribute("href", "/children");
  });

  /**
   * ★ Хоол ба цэс is group-scoped, like Ирц and Явцын үнэлгээ.
   *
   * `/meals` is a doorway that resolves the first group and forwards, so the
   * bare route works — but a teacher who has a group should not spend a
   * redirect on a question their session already answers. Asserted on the
   * exact href rather than a substring: `/meals` alone would pass against the
   * scoped URL too, which is the assertion that would notice nothing.
   */
  it("takes the teacher's own group straight to its meal sheet", async () => {
    stubDashboard();
    renderWithProviders(<DashboardPage />);
    const band = await tiles();

    await waitFor(() =>
      expect(band.getByRole("link", { name: /Хоол ба цэс/ })).toHaveAttribute(
        "href",
        `/groups/${GROUP_ID}/meals`,
      ),
    );
  });

  /*
   * Four of the tiles resolve the teacher's group; the two new ones are
   * kindergarten-wide and take no id. This is what keeps a teacher with no
   * group from meeting `/groups/undefined/reports` — the failure the
   * group-scoped tiles already guard against with their own fallbacks.
   */
  it("falls back to the doorways when a teacher has no group", async () => {
    stubDashboard(false);
    renderWithProviders(<DashboardPage />);
    const band = await tiles();

    await waitFor(() =>
      expect(band.getByRole("link", { name: /Ирц/ })).toHaveAttribute("href", "/attendance"),
    );
    expect(band.getByRole("link", { name: /Хоол ба цэс/ })).toHaveAttribute("href", "/meals");
    expect(band.getByRole("link", { name: /Тайлан/ })).toHaveAttribute("href", "/reports");
    expect(band.getByRole("link", { name: /Баримт бичгийн сан/ })).toHaveAttribute(
      "href",
      "/documents",
    );
  });
});
