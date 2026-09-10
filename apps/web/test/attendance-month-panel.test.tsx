import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { AttendanceMonthPanel } from "@/components/attendance/month-panel";

/**
 * Сарын дүр зураг — the report at the foot of the teacher's register.
 *
 * ★ What this file is really pinning is the pair of denominators, which are
 * deliberately different and easy to conflate.
 *
 * The chart's columns are the days somebody *recorded* — padding a weekend in
 * as a zero would read as a day the whole group missed, which the component's
 * own docblock explains. But "how much of the month is filled in" cannot be
 * answered from the recorded rows, because the days nobody recorded are
 * exactly the ones it is asking about. That one counts weekdays off the
 * calendar. Getting the two the same way round is the bug worth a test.
 */

const GROUP = "44444444-4444-4444-8444-444444444444";

/** February 2026: 28 days, and 20 of them are weekdays. */
const MONTH = "2026-02";

/** `attendanceCountsSchema` is six explicit integers, not a partial record. */
const ZERO = { PRESENT: 0, HALF_DAY: 0, EXCUSED: 0, SICK: 0, ABSENT: 0, OTHER: 0 };

function stubSummary(days: { date: string; counts: Partial<typeof ZERO> }[]) {
  const totals = { ...ZERO };
  const filled = days.map((day) => {
    const counts = { ...ZERO, ...day.counts };
    for (const status of Object.keys(ZERO) as (keyof typeof ZERO)[]) {
      totals[status] += counts[status];
    }
    return { date: day.date, counts };
  });

  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: `/groups/${GROUP}/attendance/summary`,
      body: { month: MONTH, totals, days: filled, children: [], roster: 2 },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the month report", () => {
  it("names the month and how many working days it holds", async () => {
    stubSummary([{ date: "2026-02-02", counts: { PRESENT: 2 } }]);
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} />);

    // Weekdays off the calendar, not days that carry rows — February 2026 has
    // 28 days and 20 weekdays.
    expect(await screen.findByText(/2026 оны 2-р сар · ажлын 20 хоног/)).toBeInTheDocument();
  });

  /*
   * ★ The line a teacher reads to know whether they are behind.
   *
   * "1 өдөр бүртгэсэн" on its own cannot say whether that is up to date or
   * nineteen days short, which is the whole question.
   */
  it("says how many of the elapsed working days carry a register", async () => {
    stubSummary([
      { date: "2026-02-02", counts: { PRESENT: 2 } },
      { date: "2026-02-03", counts: { PRESENT: 1, SICK: 1 } },
    ]);
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} />);

    // The month is in the past, so every one of its 20 weekdays has elapsed
    // and none remain.
    expect(await screen.findByText(/2\/20 бүртгэсэн · 0 үлдсэн/)).toBeInTheDocument();
  });

  it("breaks the month down by status, each in its own colour", async () => {
    stubSummary([{ date: "2026-02-02", counts: { PRESENT: 4, SICK: 2, EXCUSED: 1, ABSENT: 1 } }]);
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} />);

    for (const label of ["Ирсэн", "Өвчтэй", "Чөлөөтэй", "Тасалсан"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });

  it("says nothing was registered rather than reporting a month of zeroes", async () => {
    stubSummary([]);
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} />);

    await waitFor(() => expect(screen.getByText("Энэ сард бүртгэл алга")).toBeInTheDocument());
  });
});
