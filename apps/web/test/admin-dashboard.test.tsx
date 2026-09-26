import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminDashboard } from "@kinder/contracts";
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

const ADMIN_DASHBOARD: AdminDashboard = {
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
  /*
   * ЭСИС-тэй тулгалт. The ministry lists nine staff, seven can sign in, and
   * five of those seven are tied to their ESIS person — so two accounts are
   * the to-do this card exists to surface.
   */
  esis: {
    staffInRoster: 9,
    staffRegistered: 7,
    staffLinked: 5,
    childrenLinked: 20,
    childrenTotal: 24,
    groupsLinked: 3,
    rosterSyncedAt: "2026-09-24T02:00:00.000Z",
  },
};

/**
 * Only the session and the dashboard are stubbed. `SurveySummary` and
 * `DomainAverages` fetch on their own and get the helper's 404, which is what
 * they render an error state for — enough for the figures above them, and
 * fewer stubs standing between the assertion and what it is about.
 */
function renderAdminDashboard(dashboard = ADMIN_DASHBOARD) {
  stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: "/dashboard/admin", body: dashboard },
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

describe("ЭСИС-тэй тулгалт", () => {
  /*
   * ★ The client's ask, 2026-09-24: "esis ees irsen niit heden bagsh ajilchid
   * suraltsagch baigaa tood haruulna … systemd burtgegdsen ni hed baigaag bas
   * harj boldog baih." Both numbers, side by side.
   */
  it("shows the ministry's staff count beside the registered one", async () => {
    renderAdminDashboard();

    const card = (await screen.findByText("ЭСИС-тэй тулгалт")).closest("[data-ui='card']")!;
    expect(within(card as HTMLElement).getByText("9")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("7")).toBeInTheDocument();
  });

  /*
   * ★★ Accounts with no ESIS person are the reason a human appears twice on
   * the staff screen, so the card names the number and links to the fix rather
   * than leaving a director to notice the duplicates themselves.
   */
  it("names how many accounts are not linked yet", async () => {
    renderAdminDashboard();

    const card = (await screen.findByText("ЭСИС-тэй тулгалт")).closest("[data-ui='card']")!;
    expect(within(card as HTMLElement).getByText(/2 бүртгэл/)).toBeInTheDocument();
  });

  it("says so when every account is linked", async () => {
    renderAdminDashboard({
      ...ADMIN_DASHBOARD,
      esis: { ...ADMIN_DASHBOARD.esis!, staffRegistered: 5, staffLinked: 5 },
    });

    expect(await screen.findByText(/Бүх бүртгэл ЭСИС-ийн хүнтэй холбогдсон/)).toBeInTheDocument();
  });

  /*
   * ★ Nothing synced is not "the ministry has no staff". A table of zeroes
   * would claim the first; the sentence says which it is and where to press.
   */
  it("tells an unconnected kindergarten what to do instead of showing zeroes", async () => {
    renderAdminDashboard({
      ...ADMIN_DASHBOARD,
      esis: {
        staffInRoster: 0,
        staffRegistered: 3,
        staffLinked: 0,
        childrenLinked: 0,
        childrenTotal: 24,
        groupsLinked: 0,
        rosterSyncedAt: null,
      },
    });

    expect(await screen.findByText(/ЭСИС-ээс мэдээлэл татаагүй байна/)).toBeInTheDocument();
  });

  /*
   * ★★ An older API that does not send the block must not crash the screen —
   * `esis` is `.nullish()` in the contract for exactly that.
   */
  it("draws nothing when the API sends no ESIS block", async () => {
    renderAdminDashboard({ ...ADMIN_DASHBOARD, esis: null });

    // Wait for the dashboard proper before asserting on what is absent.
    await screen.findByText("Нийт суралцагч");
    expect(screen.queryByText("ЭСИС-тэй тулгалт")).toBeNull();
  });
});

describe("the administration dashboard", () => {
  it("is a dashboard rather than a hub", async () => {
    renderAdminDashboard();

    await waitFor(() => expect(within(figures()).getByText("Нийт суралцагч")).toBeInTheDocument());

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

    await waitFor(() => expect(within(figures()).getByText("Нийт суралцагч")).toBeInTheDocument());

    for (const [label, href] of [
      ["Нийт суралцагч", "/children"],
      ["Өнөөдрийн ирц", "/attendance/journal"],
      ["Бүлэг", "/admin/groups"],
      ["Багш, ажилтан", "/admin/users"],
      ["Баримт бичгийн сан", "/documents"],
      ["Тайлан", "/reports"],
    ] as const) {
      expect(cardLink(label), `${label} does not link anywhere`).toHaveAttribute("href", href);
    }
  });

  /*
   * ★ Every figure goes somewhere, as of 2026-09-09.
   *
   * This used to assert the opposite for two cards, with the reason beside it:
   * neither stored files nor a `ReportJob` had a screen, and pointing them at
   * the nearest plausible route is the dead navigation the hub page was deleted
   * for. Both have destinations now — the document library, and `/reports` once
   * it stopped dead-ending an administrator — so the rule the old test carried
   * is asserted the other way round: no card is left unlinked, and adding one
   * that is should be a decision rather than a side effect.
   */
  it("leaves no figure without a screen to explain it", async () => {
    renderAdminDashboard();

    await waitFor(() =>
      expect(within(figures()).getByText("Баримт бичгийн сан")).toBeInTheDocument(),
    );

    for (const label of [
      "Нийт суралцагч",
      "Өнөөдрийн ирц",
      "Бүлэг",
      "Багш, ажилтан",
      "Баримт бичгийн сан",
      "Тайлан",
    ]) {
      expect(cardLink(label), `${label} goes nowhere`).not.toBeNull();
    }
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

  it("uses the supplied drawings on the document and report cards", async () => {
    renderAdminDashboard();

    await waitFor(() =>
      expect(within(figures()).getByText("Баримт бичгийн сан")).toBeInTheDocument(),
    );

    expect(cardLink("Баримт бичгийн сан")?.querySelector("img")?.getAttribute("src")).toContain(
      "icon-admin-documents-3d.png",
    );
    expect(cardLink("Тайлан")?.querySelector("img")?.getAttribute("src")).toContain(
      "icon-admin-report-3d.png",
    );
  });

  it("omits half-day and other from the attendance summary", async () => {
    renderAdminDashboard({
      ...ADMIN_DASHBOARD,
      attendanceByGroup: [
        {
          groupId: "11111111-1111-4111-8111-111111111111",
          name: "Бага бүлэг",
          counts: { PRESENT: 12, HALF_DAY: 2, EXCUSED: 1, SICK: 1, ABSENT: 1, OTHER: 2 },
        },
      ],
    });

    const summary = await screen.findByRole("region", { name: "Ирцийн бүтэц" });

    expect(within(summary).queryByText("Хагас өдөр")).toBeNull();
    expect(within(summary).queryByText("Бусад")).toBeNull();
    for (const visible of ["Ирсэн", "Чөлөөтэй", "Өвчтэй", "Тасалсан"]) {
      expect(within(summary).getByText(visible)).toBeInTheDocument();
    }
  });
});
