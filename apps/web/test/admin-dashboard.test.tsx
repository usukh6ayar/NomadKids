import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import AdminPage from "@/app/(app)/admin/page";

/**
 * The administrator's landing screen — `/admin`.
 *
 * ★ What this protects is a decision, not a layout.
 *
 * Until 2026-09-04 this URL was six tiles linking to the administration
 * screens, and every one of those destinations had since grown its own sidebar
 * row — so the page was a list of what the menu two inches away already named.
 * The tiles went and `AdminOverview` moved onto the URL from a branch inside
 * `/dashboard` that the login redirect never reached.
 *
 * The figures then became the navigation: a count is read and acted on, and the
 * act is "show me them". These assertions pin **which figures navigate and
 * which do not** — the second half being the one that rots, because the
 * tempting fix for an unlinked card is to point it at the nearest plausible
 * route rather than to build the screen it wants.
 */

const ADMIN_DASHBOARD = {
  currentTerm: null,
  counts: { children: 24, groups: 3, staff: 7, guardians: 31 },
  childrenAMonthAgo: 20,
  attendanceToday: { expected: 24, recorded: 24, present: 22 },
  attendanceByGroup: [],
  domainAveragesByGroup: [],
  assessmentCoverage: [],
  recentActivity: [],
  storage: {
    totalBytes: 2048,
    fileCount: 5,
    documents: { count: 9, totalBytes: 1024 },
    reports: { total: 2, done: 2, failed: 0 },
  },
};

/**
 * Only the session and the dashboard are stubbed. `SurveySummary` and
 * `DomainAverages` fetch on their own and get the helper's 404, which is what
 * they render an error state for — enough for the figures above them, and
 * fewer stubs standing between the assertion and what it is about.
 */
function renderAdminDashboard() {
  stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: "/dashboard/admin", body: ADMIN_DASHBOARD },
  ]);

  return renderWithProviders(<AdminPage />);
}

/**
 * The row of figures, by its accessible name.
 *
 * ★ Scoped rather than searched globally, because "Бүлэг" is not unique on this
 * screen — the attendance panels below carry a column of group names and one of
 * their own headings. A bare `getByText` matches several and throws, and the
 * version of this helper that narrowed by `closest("div")` instead would have
 * gone on passing while pointing at whichever element happened to be first.
 */
function figures() {
  return screen.getByRole("region", { name: "Товч мэдээлэл" });
}

/** The card whose label is `label`, as the link that wraps it — or null. */
function cardLink(label: string): HTMLAnchorElement | null {
  return within(figures()).getByText(label).closest("a");
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
});

describe("the administration dashboard", () => {
  it("is a dashboard rather than a hub", async () => {
    renderAdminDashboard();

    await waitFor(() => expect(within(figures()).getByText("Нийт хүүхэд")).toBeInTheDocument());

    // The name the screen took when it stopped being a list of links. It was
    // "Удирдлага", which was also the sidebar section it sat in.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Удирдлагын самбар");

    // ★ The tiles are gone, and their headings with them. "Удирдлагын хэсгүүд"
    // was the grid's own section header; if it comes back, so has the
    // duplicate navigation this page was reduced for.
    expect(screen.queryByText("Удирдлагын хэсгүүд")).toBeNull();
  });

  it("sends each figure to the screen that explains it", async () => {
    renderAdminDashboard();

    await waitFor(() => expect(within(figures()).getByText("Нийт хүүхэд")).toBeInTheDocument());

    for (const [label, href] of [
      ["Нийт хүүхэд", "/children"],
      ["Өнөөдрийн ирц", "/attendance/journal"],
      ["Бүлэг", "/admin/groups"],
      ["Багш, ажилтан", "/admin/users"],
      ["Баримт бичгийн сан", "/documents"],
    ] as const) {
      expect(cardLink(label), `${label} does not link anywhere`).toHaveAttribute("href", href);
    }
  });

  it("leaves a figure unlinked when no screen explains it", async () => {
    renderAdminDashboard();

    await waitFor(() =>
      expect(within(figures()).getByText("Баримт бичгийн сан")).toBeInTheDocument(),
    );

    /*
     * ★ Not an oversight, and the reason belongs next to the assertion.
     *
     * A `ReportJob` is only ever seen in the dialog that started it
     * (`components/reports/report-dialog.tsx`), so this card has nowhere
     * honest to go. Give it a destination and this test should be updated — it
     * fails here to make that a decision rather than a side effect.
     *
     * ★★ It was two cards until 2026-09-09. The other counted every stored
     * file, had no screen either, and became the document library — which does
     * have one, and is asserted with the rest above.
     */
    expect(cardLink("Тайлан")).toBeNull();
  });

  it("keeps the figures the storage cards carry", async () => {
    renderAdminDashboard();

    await waitFor(() =>
      expect(within(figures()).getByText("Баримт бичгийн сан")).toBeInTheDocument(),
    );

    /*
     * These two came from the deleted `/admin` and are RFP §12.2's
     * "Хадгалалтын хэмжээ" and "Тайлангийн статистик" — the one part of that
     * page `AdminOverview` had no version of, so a merge that dropped them
     * would have lost a requirement rather than a duplicate.
     *
     * ★ The document count is `documents.count`, not `fileCount` — 9, not 5.
     * The fixture keeps them different on purpose: the card carried the media
     * total under a label that read like the document library's name until
     * 2026-09-09, and a fixture where the two agreed would let it drift back.
     */
    expect(within(figures()).getByText("9")).toBeInTheDocument();
    expect(within(figures()).queryByText("5")).toBeNull();
    expect(within(figures()).getByText("2 нийт")).toBeInTheDocument();
    expect(within(figures()).getByText("Тайлан")).toBeInTheDocument();
  });
});
