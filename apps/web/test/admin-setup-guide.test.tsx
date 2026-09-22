import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminDashboard } from "@kinder/contracts";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { AdminSetupGuide } from "@/components/admin/admin-setup-guide";

/**
 * The setup guide — the client, 2026-09-22: "Удирдлага хэсэг рүү нэвтрэхэд цонх
 * нээгдэж хэрхэн хичээлийн жил бүлэг багш нэмэх."
 *
 * ★ These cases are about the two things a guide can get wrong: telling a
 * director to do something they have already done, and opening itself at a
 * director who asked it not to.
 */

const KG = "33333333-3333-4333-8333-333333333333";

/*
 * ★ The whole payload, not the two counts the guide reads.
 *
 * `adminDashboardSchema` requires all of this, and the typed client parses
 * before handing anything over — so a short fixture leaves the query stuck in
 * `isPending` and every case below fails looking for a dialog, with nothing
 * saying why. Shaped after `admin-dashboard.test.tsx`'s own fixture.
 */
const overview = (groups: number, staff: number): AdminDashboard => ({
  currentTerm: null,
  counts: { children: 0, groups, staff, guardians: 0 },
  childrenAMonthAgo: 0,
  attendanceToday: { expected: 0, recorded: 0, present: 0 },
  attendanceByGroup: [],
  domainAveragesByGroup: [],
  assessmentCoverage: [],
  recentActivity: [],
  storage: {
    totalBytes: 0,
    fileCount: 0,
    documents: { count: 0, totalBytes: 0 },
    reports: { total: 0, done: 0, failed: 0 },
  },
});

const year = {
  id: "99999999-9999-4999-8999-999999999999",
  name: "2026-2027",
  startsOn: "2026-09-01",
  endsOn: "2027-06-01",
  isCurrent: true,
};

function stub({ years, groups, staff }: { years: unknown[]; groups: number; staff: number }) {
  stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: "/dashboard/admin", body: overview(groups, staff) },
    { path: `/kindergartens/${KG}/school-years`, body: years },
  ]);
}

describe("удирдлагын тохиргооны заавар", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("opens itself on a kindergarten that has nothing set up", async () => {
    stub({ years: [], groups: 0, staff: 0 });
    renderWithProviders(<AdminSetupGuide />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Хичээлийн жил үүсгэх")).toBeInTheDocument();
    expect(screen.getByText("Бүлэг нэмэх")).toBeInTheDocument();
    expect(screen.getByText("Багш, ажилтан бүртгэх")).toBeInTheDocument();
  });

  /*
   * ★ **The failure a slideshow would have.**
   *
   * A static walkthrough tells a director who created a school year in August to
   * create one, which is how people learn to close a dialog without reading it.
   * The steps are ticked from data, so this asserts the tick.
   */
  it("ticks the steps the kindergarten has already done", async () => {
    stub({ years: [year], groups: 2, staff: 0 });
    renderWithProviders(<AdminSetupGuide />);

    await screen.findByRole("dialog");
    expect(screen.getByText(/1 алхам үлдсэн/)).toBeInTheDocument();
    expect(screen.getAllByText("(хийгдсэн)")).toHaveLength(2);
  });

  /*
   * ★★ **`currentTerm` is not a school year, and this is the case that pins it.**
   *
   * The dashboard payload carries `currentTerm`, which is null both for "no year
   * at all" and for "a year with no term in it yet". Ticking the first step off
   * that field would tell a kindergarten mid-setup to create a year it has. So
   * the guide reads `/school-years`, and here `currentTerm` is null while a year
   * exists.
   */
  it("counts a school year that has no current term as done", async () => {
    stub({ years: [{ ...year, isCurrent: false }], groups: 0, staff: 0 });
    renderWithProviders(<AdminSetupGuide />);

    await screen.findByRole("dialog");
    const yearStep = screen.getByText("Хичээлийн жил үүсгэх").closest("li")!;
    expect(yearStep.textContent).toContain("(хийгдсэн)");
  });

  it("stays shut on a kindergarten that finished setting up", async () => {
    stub({ years: [year], groups: 3, staff: 4 });
    renderWithProviders(<AdminSetupGuide />);

    // The reopen button appears once the queries answer; the dialog does not.
    expect(await screen.findByRole("button", { name: /Тохиргооны заавар/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /*
   * ★ Dismissal survives the next visit. "цонх нээгдэж" asked for a window on
   * the way in, not for one on every way in — the client's other two notes today
   * are both about screens wasting the reader's space.
   */
  it("does not reopen after it has been closed", async () => {
    const user = userEvent.setup();
    stub({ years: [], groups: 0, staff: 0 });
    const first = renderWithProviders(<AdminSetupGuide />);

    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Дараа нь" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    first.unmount();
    stub({ years: [], groups: 0, staff: 0 });
    renderWithProviders(<AdminSetupGuide />);

    expect(await screen.findByRole("button", { name: /Тохиргооны заавар/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /*
   * ★★ Nothing before the answers arrive. Opening on an unanswered query would
   * show three unticked steps to a kindergarten that has all three — the same
   * loading-versus-empty confusion the staff table had.
   */
  it("draws nothing at all while its queries are in flight", () => {
    stub({ years: [year], groups: 1, staff: 1 });
    const { container } = renderWithProviders(<AdminSetupGuide />);

    expect(container.textContent).toBe("");
  });
});
