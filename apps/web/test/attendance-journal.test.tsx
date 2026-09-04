import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import AttendanceJournalPage from "@/app/(app)/attendance/journal/page";

/** The kindergarten `sessionFor` puts every membership in. */
const KG_ID = "33333333-3333-4333-8333-333333333333";
const CHILD_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Ирцийн дэлгэрэнгүй — the whole kindergarten, a child per row and a day per
 * column.
 *
 * ★ The case worth reading first is "a day nobody marked is not an absence".
 * The two look identical in a grid unless the screen is deliberate about it,
 * and confusing them puts absences the kindergarten never recorded into a
 * funding claim.
 */

const DAYS = ["2026-03-02", "2026-03-03", "2026-03-04"];

function journal(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        childId: CHILD_ID,
        child: { id: CHILD_ID, lastName: "Дорж", firstName: "Намуун", status: "ACTIVE" },
        group: {
          id: "g1",
          name: "Бэлтгэл",
          ageBand: "SENIOR",
          programKind: "MAIN",
          attendanceForm: "STANDARD",
        },
        days: [{ status: "PRESENT", note: null }, null, { status: "SICK", note: null }],
        counts: { PRESENT: 1, SICK: 1 },
        recorded: 2,
      },
    ],
    total: 1,
    totalPages: 1,
    page: 1,
    pageSize: 25,
    from: DAYS[0],
    to: DAYS[2],
    days: DAYS,
    totals: { PRESENT: 1, SICK: 1 },
    ...overrides,
  };
}

function stub(body: unknown = journal(), extra: Parameters<typeof stubApi>[0] = []) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    ...extra,
    { path: "/groups", method: "GET", body: { items: [], total: 0, page: 1, pageSize: 100 } },
    { path: `/kindergartens/${KG_ID}/attendance/register`, method: "GET", body },
  ]);
}

beforeEach(() => {
  setParams({});
});

describe("the grid", () => {
  it("shows a row per child with the day columns in order", async () => {
    stub();
    renderWithProviders(<AttendanceJournalPage />);

    expect(await screen.findByText(/Дорж/)).toBeInTheDocument();

    /*
      ★ The accessible name is the full date; the cell shows "Да 2".

      It was the day-of-month alone, in the header and in the accessible name
      both, and that was two mistakes at once. On screen a column of bare
      numbers said nothing about what it was a column of — the client's own
      complaint — so the weekday sits above the number now. And a screen reader
      announcing "2" is worse still: it has no filter row to glance back at.
      `aria-label` carries the date and the visible text carries what fits.
    */
    expect(screen.getByRole("columnheader", { name: "2026-03-02" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "2026-03-04" })).toBeInTheDocument();
    // Weekday and day-of-month are what a sighted reader actually sees.
    expect(screen.getByText("Да")).toBeInTheDocument();
  });

  it("distinguishes a day nobody marked from a recorded absence", async () => {
    // ★★ The discriminating case. `null` is "no record"; it must not read as
    // absent, because the second becomes a funding claim and the first is a
    // gap in the paperwork. The accessible name is what a screen reader gets,
    // so it is what is asserted.
    stub();
    renderWithProviders(<AttendanceJournalPage />);

    expect(await screen.findByLabelText("2026-03-03 — бүртгэлгүй")).toBeInTheDocument();
    expect(screen.getByLabelText("2026-03-02 — Ирсэн")).toBeInTheDocument();
    expect(screen.getByLabelText("2026-03-04 — Өвчтэй")).toBeInTheDocument();
  });

  it("shows the period's totals across every child, not just this page", async () => {
    stub();
    renderWithProviders(<AttendanceJournalPage />);

    expect(await screen.findByText("Ирсэн")).toBeInTheDocument();
    expect(screen.getByText("Өвчтэй")).toBeInTheDocument();
  });

  it("says what to do next when nothing matches rather than showing an empty grid", async () => {
    stub(journal({ items: [], total: 0, totalPages: 0, totals: {} }));
    renderWithProviders(<AttendanceJournalPage />);

    expect(await screen.findByText("Бүртгэл алга")).toBeInTheDocument();
  });
});

describe("the filters", () => {
  it("sends the status filter to the API when a chip is pressed", async () => {
    const user = userEvent.setup();
    const { calls } = stub();

    renderWithProviders(<AttendanceJournalPage />);
    await screen.findByText(/Дорж/);

    await user.click(screen.getByRole("button", { name: "Өвчтэй" }));

    expect(
      calls.some((c) => c.url.includes("attendance/register") && c.url.includes("status=SICK")),
    ).toBe(true);
  });

  it("offers the Excel download as a link carrying the current filters", async () => {
    // ★ A link, not a button that fetches: the browser downloads it with the
    // session cookie it already has. The filters have to be on the href, or
    // the file is not what was on screen.
    const user = userEvent.setup();
    stub();
    renderWithProviders(<AttendanceJournalPage />);
    await screen.findByText(/Дорж/);

    await user.click(screen.getByRole("button", { name: "Өвчтэй" }));

    const link = screen.getByRole("link", { name: /Excel татах/ });
    expect(link.getAttribute("href")).toContain("attendance/register/export");
    expect(link.getAttribute("href")).toContain("status=SICK");
  });

  it("offers all six statuses — OTHER included", async () => {
    // The column holds six and the recording path accepts six as of
    // 2026-09-02; a filter row short of one would hide rows without saying so.
    stub();
    renderWithProviders(<AttendanceJournalPage />);

    await screen.findByText(/Дорж/);
    for (const label of ["Ирсэн", "Хагас өдөр", "Чөлөөтэй", "Өвчтэй", "Тасалсан", "Бусад"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });
});
