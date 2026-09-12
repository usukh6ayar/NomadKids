import { screen, within } from "@testing-library/react";
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
    groups: [
      {
        groupId: "g1",
        group: "Бэлтгэл",
        children: 1,
        counts: { PRESENT: 1, SICK: 1 },
        recorded: 2,
      },
    ],
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

  /*
   * ★ 2026-09-12: "доор ангийн нийт ирсэн, нийт гэсэн тоон үзүүлэлтүүдийг хойно
   * нь бодож гарга."
   *
   * The figures come down from the API, counted over every child the filter
   * matched — this screen pages over children, and a class total assembled
   * from the rows on screen would change when somebody turned to page two.
   */
  it("★ totals each class under the register, across every matching child", async () => {
    stub();
    renderWithProviders(<AttendanceJournalPage />);

    const table = await screen.findByRole("table", { name: /Ангийн дүн/ });
    const row = within(table).getByRole("rowheader", { name: "Бэлтгэл" }).closest("tr")!;
    // One child, one present day, one sick day — two recorded in all.
    expect(
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["1", "1", "0", "1", "0", "2"]);
  });

  it("shows the period's totals across every child, not just this page", async () => {
    stub();
    renderWithProviders(<AttendanceJournalPage />);

    expect(await screen.findByText("Ирсэн")).toBeInTheDocument();
    expect(screen.getByText("Өвчтэй")).toBeInTheDocument();
  });

  /*
    ★ One card per figure — 2026-09-12, at the client's request: "энийг тусдаа
    жижиг хайрцгуудад хий."

    Four columns wrapping inside one card put "Өвчтэй" under "37" on a phone and
    left the reader pairing labels with figures by eye. Asserted as the pairing
    rather than as a class name: what the client asked for is that a label and
    its number share a box, and that is what a restyle must not break.
  */
  it("★ gives each total its own box, paired with its label", async () => {
    stub(
      journal({ totals: { PRESENT: 37, HALF_DAY: 3, EXCUSED: 2, SICK: 5, ABSENT: 4, OTHER: 2 } }),
    );
    renderWithProviders(<AttendanceJournalPage />);

    // Scoped to the totals region: "Ирсэн" also labels a filter chip above.
    const totals = within(await screen.findByRole("group", { name: "Хугацааны дүн" }));

    for (const [label, count] of [
      ["Ирсэн", "40"],
      ["Чөлөөтэй", "2"],
      ["Өвчтэй", "5"],
      ["Тасалсан", "4"],
    ] as const) {
      const box = totals.getByText(label).closest('[data-ui="card"]');
      expect(box).not.toBeNull();
      expect(box).toHaveTextContent(count);
    }
    expect(totals.queryByText("Хагас өдөр")).not.toBeInTheDocument();
    expect(totals.queryByText("Бусад")).not.toBeInTheDocument();
  });

  /*
    A status with nothing in it draws no box. Six empty cards on a March filter
    would be five statements that nothing happened.
  */
  it("draws no box for a status the period has none of", async () => {
    stub(journal({ totals: { PRESENT: 4 } }));
    renderWithProviders(<AttendanceJournalPage />);

    const totals = within(await screen.findByRole("group", { name: "Хугацааны дүн" }));
    expect(totals.getByText("Ирсэн")).toBeInTheDocument();
    expect(totals.queryByText("Хагас өдөр")).not.toBeInTheDocument();
  });

  it("folds historical half-days into present and hides other in the day grid", async () => {
    stub(
      journal({
        items: [
          {
            ...journal().items[0],
            days: [{ status: "HALF_DAY", note: null }, { status: "OTHER", note: null }, null],
            counts: { HALF_DAY: 1, OTHER: 1 },
          },
        ],
        totals: { HALF_DAY: 1, OTHER: 1 },
      }),
    );
    renderWithProviders(<AttendanceJournalPage />);

    expect(await screen.findByLabelText("2026-03-02 — Ирсэн")).toBeInTheDocument();
    expect(screen.getByLabelText("2026-03-03 — бүртгэлтэй")).toBeInTheDocument();
    expect(screen.queryByText("Хагас өдөр")).not.toBeInTheDocument();
    expect(screen.queryByText("Бусад")).not.toBeInTheDocument();
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

  /*
    ★ Four chips, not six — 2026-09-12, at the client's request: "Ирсэн · Хагас
    өдөр — хас · Чөлөөтэй · Өвчтэй · Тасалсан · Бусад — хас."

    This replaces "offers all six statuses — OTHER included", whose argument was
    that "a filter row short of one would hide rows without saying so". That is
    not what removing a chip does, which is why the request is safe to take
    literally: the chips only ever *narrow*, and none are pressed on arrival —
    so with two gone the grid still lists every recorded day, `Totals` still
    counts a legacy Хагас өдөр, and the legend still explains the Х and Б the
    grid draws. What is lost is the ability to isolate two statuses no new day
    can be recorded as (`TEACHER_ATTENDANCE_STATUSES`, 2026-09-10).
  */
  it("★ offers the four statuses a day can still be recorded as", async () => {
    stub();
    renderWithProviders(<AttendanceJournalPage />);

    await screen.findByText(/Дорж/);

    const chips = within(screen.getByRole("group", { name: "Ирцийн төлөв" }));
    for (const label of ["Ирсэн", "Чөлөөтэй", "Өвчтэй", "Тасалсан"]) {
      expect(chips.getByRole("button", { name: label })).toBeInTheDocument();
    }
    for (const gone of ["Хагас өдөр", "Бусад"]) {
      expect(chips.queryByRole("button", { name: gone })).not.toBeInTheDocument();
    }
  });
});
