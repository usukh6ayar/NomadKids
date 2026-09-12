import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, selectOption, sessionFor, stubApi } from "./support/render";
import { AttendanceCalendar } from "@/components/child/attendance-calendar";

/*
  ★ The clock is frozen, because the month dropdown is built from it.

  "The twelve months up to this one" is a different list every month, and the
  case below names one of them. `attendance-week-grid.test.tsx` freezes for the
  same class of reason — see its note.
*/
vi.useFakeTimers({ shouldAdvanceTime: true });
vi.setSystemTime(new Date("2026-09-09T09:00:00Z"));
afterAll(() => vi.useRealTimers());

const CHILD = "11111111-1111-4111-8111-111111111111";

/** Every status, which is what the contract's record demands. */
const SUMMARY = {
  PRESENT: 18,
  HALF_DAY: 1,
  EXCUSED: 1,
  SICK: 2,
  ABSENT: 0,
  OTHER: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

function stub(summary: Record<string, number> = SUMMARY) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["PARENT"]) },
    { path: `/children/${CHILD}/attendance/summary`, body: summary },
    { path: `/children/${CHILD}/attendance`, body: [] },
  ]);
}

/**
 * "Ирцийн нэгтгэл" — the family's month.
 *
 * ★ The screen answered "Алдаа гарлаа" until 2026-09-12: the API returned five
 * of the six statuses, and `attendanceSummarySchema` is an enum-keyed record,
 * which Zod treats as exhaustive — one absent key rejects the whole object. The
 * fixture here carries all six for that reason.
 */
describe("the family's attendance summary", () => {
  it("renders the month rather than an error", async () => {
    stub();
    renderWithProviders(<AttendanceCalendar childId={CHILD} />);

    expect(await screen.findByText("Ирцийн нэгтгэл")).toBeInTheDocument();
    expect(screen.queryByText("Алдаа гарлаа")).not.toBeInTheDocument();
  });

  /*
    ★ The month's own working days — the client's definition, 2026-09-12: "9
    сард бямба ням гарагт ажиллахгүй, бас нийтээр амрах баяр тохиолдоогүй учир
    ажлын 22 хоногтой."

    ★★ Not the sum of the statuses, which is what this was for an hour: that
    counts the days the register *holds*, so a month a teacher had not finished
    marking would report itself as a shorter month.
  */
  it("says how many days the month is worked", async () => {
    stub();
    renderWithProviders(<AttendanceCalendar childId={CHILD} />);

    expect(await screen.findByText("Ажилласан 22 хоног")).toBeInTheDocument();
  });

  it("does not shrink when the register is only half filled in", async () => {
    stub({ PRESENT: 3, HALF_DAY: 0, EXCUSED: 0, SICK: 0, ABSENT: 0, OTHER: 0 });
    renderWithProviders(<AttendanceCalendar childId={CHILD} />);

    // Three marked days out of a twenty-two day month — the month is unchanged.
    expect(await screen.findByText("Ажилласан 22 хоног")).toBeInTheDocument();
  });

  /*
    ★ A dropdown, not two arrows.

    The pager reached last March in six presses and gave no sign of how far back
    the record went.
  */
  it("chooses the month from a list of the last twelve", async () => {
    const user = userEvent.setup();
    const { calls } = stub();
    renderWithProviders(<AttendanceCalendar childId={CHILD} />);

    const picker = await screen.findByLabelText("Сар сонгох");
    expect(picker).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Өмнөх сар" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Дараах сар" })).not.toBeInTheDocument();

    await selectOption(user, "Сар сонгох", "2026 оны 7-р сар");

    await vi.waitFor(() =>
      expect(calls.some((call) => call.url.includes("month=2026-07"))).toBe(true),
    );
  });

  /*
    ★ The picker at one end of its row, the count at the other — 2026-09-12,
    after two client notes: the count "баруун тийш шах" and the picker "зүүн
    тийш шах".

    They were both in `SectionHeader`'s action slot, which is a `shrink-0` box:
    glued together at one end, neither movable without the other.
  */
  it("gives the picker and the count opposite ends of one row", async () => {
    stub();
    renderWithProviders(<AttendanceCalendar childId={CHILD} />);

    const picker = await screen.findByLabelText("Сар сонгох");
    const count = screen.getByText("Ажилласан 22 хоног");

    // The count is a direct child of the row; the Select is a Radix trigger
    // wrapped in its own box, so it is the count that names the row.
    const row = count.parentElement!;
    expect(row).toContainElement(picker);
    expect(row.className).toContain("justify-between");
  });

  it("offers twelve months and never a future one", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<AttendanceCalendar childId={CHILD} />);

    await user.click(await screen.findByLabelText("Сар сонгох"));
    const options = await screen.findAllByRole("option");

    expect(options).toHaveLength(12);
    // Today is September 2026; the newest entry is this month, not October.
    expect(within(options[0]!).getByText("2026 оны 9-р сар")).toBeInTheDocument();
  });

  /*
    ★ The calendar folds — 2026-09-12, at the client's request: "календарь
    dropdown болго."

    Thirty-five cells is the tallest thing on this screen and the part a parent
    reads least: the month's figures answer "how has it gone", and the grid
    answers "which day was which", which is a question you go looking for.

    ★★ The class, not the `hidden` attribute. CLAUDE.md records the trap: the
    attribute is `display: none` at the lowest specificity and `grid` from the
    class list beats it, so the grid would have stayed on screen with the
    chevron claiming it was folded. This asserts the state a reader can see.
  */
  it("keeps the day grid folded until it is asked for", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<AttendanceCalendar childId={CHILD} />);

    const toggle = await screen.findByRole("button", { name: /Календарь/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    const grid = document.getElementById("attendance-calendar-grid")!;
    expect(grid.className).toContain("hidden");
    expect(grid.className).not.toMatch(/(^|\s)grid(\s|$)/);

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(grid.className).toMatch(/(^|\s)grid(\s|$)/);
    expect(grid.className).not.toContain("hidden");
  });

  /** "2026 оны 9-р сар" has to fit — it is the one word that says which month. */
  it("gives the month label room on a phone", async () => {
    stub();
    renderWithProviders(<AttendanceCalendar childId={CHILD} />);

    const picker = await screen.findByLabelText("Сар сонгох");
    expect(picker.className).toContain("w-full");
    expect(picker).toHaveTextContent("2026 оны 9-р сар");
  });
});
