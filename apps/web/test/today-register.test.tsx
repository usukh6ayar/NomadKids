import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DailyAttendance, DailyAttendanceRow } from "@kinder/contracts";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { TodayRegister } from "@/components/admin/today-register";

/**
 * «Өнөөдрийн бүлгийн ирц» — the director's board, 2026-09-26.
 *
 * ★ After the ministry SIS dashboard, which opens on one row per group for
 * today: filled in or not, sent or not. What this pins is that the row says
 * which groups still owe today's register, and that it reads the daily
 * register's own endpoint rather than a second definition of "recorded".
 */

const KINDERGARTEN = "33333333-3333-4333-8333-333333333333";
const today = new Date().toISOString().slice(0, 10);

function row(overrides: Partial<DailyAttendanceRow>): DailyAttendanceRow {
  return {
    schoolYear: "2026-2027",
    groupId: "44444444-4444-4444-8444-444444444441",
    group: "Нарны",
    date: today,
    expected: 20,
    recorded: 20,
    unrecorded: 0,
    complete: true,
    present: 18,
    excused: 1,
    sick: 1,
    absent: 0,
    sentAt: null,
    sentBy: null,
    createdAt: null,
    createdBy: [],
    requests: { pending: 0, approved: 0, rejected: 0 },
    ...overrides,
  };
}

function daily(items: DailyAttendanceRow[]): DailyAttendance {
  return {
    kindergartenName: "Цэцэрлэг",
    from: today,
    to: today,
    items,
    totals: {
      expected: 0,
      unrecorded: 0,
      present: 0,
      excused: 0,
      sick: 0,
      absent: 0,
      complete: 0,
      sent: 0,
      days: items.length,
      requests: { pending: 0, approved: 0, rejected: 0 },
    },
  };
}

function render(items: DailyAttendanceRow[]) {
  const api = stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: `/kindergartens/${KINDERGARTEN}/attendance/daily`, body: daily(items) },
  ]);
  renderWithProviders(<TodayRegister />);
  return api;
}

describe("TodayRegister", () => {
  it("names the group that has not filled in today, and the one already sent", async () => {
    render([
      row({}),
      row({
        groupId: "44444444-4444-4444-8444-444444444442",
        group: "Сарны",
        recorded: 5,
        unrecorded: 15,
        complete: false,
        present: 5,
        excused: 0,
        sick: 0,
      }),
      row({
        groupId: "44444444-4444-4444-8444-444444444443",
        group: "Одны",
        sentAt: `${today}T03:00:00.000Z`,
      }),
    ]);

    const table = await screen.findByRole("table", { name: /Өнөөдрийн бүлгийн ирц/ });
    const behind = within(table).getByRole("link", { name: "Сарны" }).closest("tr")!;
    expect(behind).toHaveTextContent("15 дутуу");
    expect(within(table).getByRole("link", { name: "Нарны" }).closest("tr")!).toHaveTextContent(
      "Бүрэн",
    );
    expect(within(table).getByRole("link", { name: "Одны" }).closest("tr")!).toHaveTextContent(
      "Илгээсэн",
    );
    // The group opens its own day sheet on today's date.
    expect(within(table).getByRole("link", { name: "Сарны" })).toHaveAttribute(
      "href",
      `/groups/44444444-4444-4444-8444-444444444442/attendance?date=${today}`,
    );
  });

  it("asks the daily register for today alone", async () => {
    const api = render([row({})]);
    await screen.findByRole("table", { name: /Өнөөдрийн бүлгийн ирц/ });
    expect(
      api.calls.some((call) => call.url.includes(`attendance/daily?from=${today}&to=${today}`)),
    ).toBe(true);
  });

  it("says today is not a working day rather than drawing an empty table", async () => {
    render([]);
    expect(await screen.findByText(/Өнөөдөр ирц бүртгэх өдөр биш/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
