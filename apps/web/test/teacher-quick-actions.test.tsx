import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import DashboardPage from "@/app/(app)/dashboard/page";

/**
 * The teacher dashboard's tile band — the six doors under the greeting.
 *
 * ★ Six since 2026-09-10, at the client's request: "Тайлан" and "Баримт
 * бичгийн сан" joined Ирц · Мэдээ · Судалгаа · Явцын үнэлгээ.
 *
 * Both destinations already existed and were already in the sidebar. What
 * this file is really guarding is the pair of things that made them worth
 * adding here and can silently rot: that the hrefs are real routes, and that
 * every tile carries its own illustration. `sidebar.test.tsx` exists because
 * eight section rows once shipped with no icon at all and nothing failed.
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
  it("offers all six doors, each with its own drawing", async () => {
    stubDashboard();
    renderWithProviders(<DashboardPage />);
    const band = await tiles();

    const expected = [
      ["Ирц", "/attendance", "icon-attendance-3d.png"],
      ["Мэдээ", "/notifications/new", "icon-notice-3d.png"],
      ["Судалгаа", "/surveys", "icon-survey-3d.png"],
      ["Явцын үнэлгээ", "/assessment", "icon-progress-3d.png"],
      ["Тайлан", "/reports", "icon-report-3d.png"],
      ["Баримт бичгийн сан", "/documents", "icon-documents-3d.png"],
    ] as const;

    expect(band.getAllByRole("link")).toHaveLength(expected.length);

    for (const [title, href, asset] of expected) {
      const tile = band.getByRole("link", { name: new RegExp(title) });
      expect(tile.getAttribute("href"), `${title} points somewhere unexpected`).toContain(href);
      expect(
        within(tile).getByRole("presentation", { hidden: true }).getAttribute("src"),
        `${title} has no drawing`,
      ).toContain(asset);
    }
  });

  it("sends the two new tiles at the routes that exist", async () => {
    stubDashboard();
    renderWithProviders(<DashboardPage />);
    const band = await tiles();

    expect(band.getByRole("link", { name: /Тайлан/ })).toHaveAttribute("href", "/reports");
    expect(band.getByRole("link", { name: /Баримт бичгийн сан/ })).toHaveAttribute(
      "href",
      "/documents",
    );
  });

  /*
   * Four of the tiles resolve the teacher's group; the two new ones are
   * kindergarten-wide and take no id. This is what keeps a teacher with no
   * group from meeting `/groups/undefined/reports` — the failure the
   * group-scoped tiles already guard against with their own fallbacks.
   */
  it("keeps the two new tiles group-independent when a teacher has no group", async () => {
    stubDashboard(false);
    renderWithProviders(<DashboardPage />);
    const band = await tiles();

    await waitFor(() =>
      expect(band.getByRole("link", { name: /Ирц/ })).toHaveAttribute("href", "/attendance"),
    );
    expect(band.getByRole("link", { name: /Тайлан/ })).toHaveAttribute("href", "/reports");
    expect(band.getByRole("link", { name: /Баримт бичгийн сан/ })).toHaveAttribute(
      "href",
      "/documents",
    );
  });
});
