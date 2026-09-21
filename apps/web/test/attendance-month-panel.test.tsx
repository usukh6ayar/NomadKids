import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { AttendanceMonthPanel } from "@/components/attendance/month-panel";

/**
 * Ирцийн тайлан — the report at the foot of the teacher's register.
 *
 * ★ REDESIGN 2026-09-12, to the client's own two screens. What this file pins
 * is the arithmetic behind them, which is the half a drawing cannot show:
 *
 *  - every share on the day card is **of the roster**, so the child nobody
 *    marked is a real slice ("Бүртгээгүй 1 (4%)") rather than a rounding error;
 *  - the month's average is attendance per *recorded* day over the roster — a
 *    day nobody registered is not a day the whole group missed;
 *  - "Ирсэн" is `PRESENT + HALF_DAY` on both, so the two tabs are one question
 *    asked over different spans rather than two definitions.
 */

const GROUP = "44444444-4444-4444-8444-444444444444";

/** February 2026. */
const MONTH = "2026-02";

/** `attendanceCountsSchema` is six explicit integers, not a partial record. */
const ZERO = { PRESENT: 0, HALF_DAY: 0, EXCUSED: 0, SICK: 0, ABSENT: 0, OTHER: 0 };

function summaryBody(
  month: string,
  roster: number,
  days: { date: string; counts: Partial<typeof ZERO> }[],
) {
  const totals = { ...ZERO };
  const filled = days.map((day) => {
    const counts = { ...ZERO, ...day.counts };
    for (const status of Object.keys(ZERO) as (keyof typeof ZERO)[]) {
      totals[status] += counts[status];
    }
    return { date: day.date, counts };
  });

  return { month, totals, days: filled, children: [], roster };
}

function stubSummary(
  days: { date: string; counts: Partial<typeof ZERO> }[],
  roster = 25,
  extra: { path: string; body: unknown }[] = [],
) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    // Longer paths first: `stubApi` matches on a prefix and returns the first
    // hit, so a route carrying `?month=` has to precede the bare one.
    ...extra,
    {
      path: `/groups/${GROUP}/attendance/summary`,
      body: summaryBody(MONTH, roster, days),
    },
  ]);
}

/** One legend row, by the status named in it. */
function legendRow(label: string): HTMLElement {
  return screen.getByText(label).parentElement!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the day tab", () => {
  /*
   * The client's own card: 25 on the roster, 20 present, and every share taken
   * against those 25 — including the one child nobody has marked at all.
   */
  it("★ rings the whole roster and names every status beside it", async () => {
    stubSummary(
      [{ date: "2026-02-11", counts: { PRESENT: 20, SICK: 2, EXCUSED: 1, ABSENT: 1 } }],
      25,
    );
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} date="2026-02-11" />);

    expect(await screen.findByText("2026 оны 2-р сарын 11")).toBeInTheDocument();
    expect(screen.getByText("Лхагва гараг")).toBeInTheDocument();

    // The hole carries the roster, not the attendance.
    expect(screen.getByText("нийт хүүхэд")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();

    expect(legendRow("Ирсэн")).toHaveTextContent("20");
    expect(legendRow("Ирсэн")).toHaveTextContent("(80%)");
    expect(legendRow("Өвчтэй")).toHaveTextContent("(8%)");
    expect(legendRow("Тасалсан")).toHaveTextContent("(4%)");

    // 24 of 25 marked — the last one is a slice of its own, not a silence.
    expect(legendRow("Бүртгээгүй")).toHaveTextContent("1");
    expect(legendRow("Бүртгээгүй")).toHaveTextContent("(4%)");
  });

  it("half a day is a day the child was here", async () => {
    stubSummary([{ date: "2026-02-11", counts: { PRESENT: 8, HALF_DAY: 2 } }], 10);
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} date="2026-02-11" />);

    expect(await screen.findByText("Ирсэн")).toBeInTheDocument();
    expect(legendRow("Ирсэн")).toHaveTextContent("10");
    expect(legendRow("Ирсэн")).toHaveTextContent("(100%)");
  });

  /*
   * ★ The register above wins while it is open — it holds the row the teacher
   * has just changed and not yet saved.
   */
  it("reads the open register rather than the saved summary", async () => {
    stubSummary([{ date: "2026-02-11", counts: { PRESENT: 20 } }], 25);
    renderWithProviders(
      <AttendanceMonthPanel
        groupId={GROUP}
        month={MONTH}
        date="2026-02-11"
        progress={{
          recorded: 3,
          total: 4,
          breakdown: [
            { key: "PRESENT", label: "Ирсэн", count: 2, tone: "mint" },
            { key: "SICK", label: "Өвчтэй", count: 1, tone: "sun" },
          ],
        }}
      />,
    );

    await screen.findByText("2026 оны 2-р сарын 11");

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Ирсэн").parentElement).toHaveTextContent("2");
    expect(within(panel).getByText("Бүртгээгүй").parentElement).toHaveTextContent("1");
  });

  /*
   * ★ Against the previous day that carries a register, not `date - 1`: on a
   * Monday that is a Sunday nobody registered, and it would read as a collapse.
   */
  it("compares the day with the last one that was registered", async () => {
    stubSummary(
      [
        { date: "2026-02-06", counts: { PRESENT: 15, ABSENT: 5 } },
        { date: "2026-02-09", counts: { PRESENT: 18, ABSENT: 2 } },
      ],
      20,
    );
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} date="2026-02-09" />);

    // 90% against 75% — fifteen points up on the Friday before.
    expect(await screen.findByText("Өнөөдрийн ирц сайн байна!")).toBeInTheDocument();
    expect(screen.getByText(/Өмнөх бүртгэсэн өдрөөс \+15%-иар өссөн байна\./)).toBeInTheDocument();
  });

  it("says so plainly when the day went badly", async () => {
    stubSummary([{ date: "2026-02-11", counts: { PRESENT: 10, SICK: 10 } }], 20);
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} date="2026-02-11" />);

    expect(await screen.findByText("Өнөөдөр ирц бага байна.")).toBeInTheDocument();
  });
});

describe("the month tab", () => {
  async function openMonth() {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Сар" }));
    return user;
  }

  /*
   * ★ The client's second card: 21 recorded days, an average of 23 children of
   * 25 on the roster — 92% — with the sickness and leave rates that explain it.
   */
  it("★ averages the recorded days against the roster", async () => {
    stubSummary(
      Array.from({ length: 21 }, (_, index) => ({
        date: `2026-02-${String(index + 1).padStart(2, "0")}`,
        counts: { PRESENT: 23, SICK: 1, EXCUSED: 1 },
      })),
      25,
    );
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} />);
    await openMonth();

    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByText("92%")).toBeInTheDocument();

    expect(within(panel).getByText("Ажлын хоног").parentElement).toHaveTextContent("21");
    expect(within(panel).getByText("Өдрийн дундаж ирц").parentElement).toHaveTextContent("23");

    // Both captions were struck out on 2026-09-12; the ring's own line carries
    // the headcount they used to explain.
    expect(within(panel).queryByText("Нийт хичээллэсэн өдөр")).not.toBeInTheDocument();
    expect(within(panel).queryByText(/хүүхдээс/)).not.toBeInTheDocument();

    // 21 cases each, out of 21 × 25 day-slots — 4%.
    expect(within(panel).getByText("Өвчтэй").parentElement).toHaveTextContent("21(4%)");
    expect(within(panel).getByText("Чөлөөтэй").parentElement).toHaveTextContent("21(4%)");
  });

  /*
   * ★ Every word on the card, pinned — 2026-09-12: "сарын график яг энэ зураг
   * шиг үг үсэгтэй болго."
   *
   * The client's drawing is a mock-up with invented numbers ("тооцоолол буруу,
   * жишээ болгосон"), so what it settles is the *wording*, not the arithmetic.
   * This is the one assertion that would catch a label drifting back to
   * something a screen invented for itself.
   */
  it("★ uses the drawing's own labels, word for word", async () => {
    stubSummary([{ date: "2026-02-02", counts: { PRESENT: 9, SICK: 1 } }], 10);
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} />);
    await openMonth();

    const panel = await screen.findByRole("tabpanel");
    // The ring's own caption wraps across a `<br>`, so it is matched loosely.
    expect(within(panel).getByText(/Сарын дундаж/)).toBeInTheDocument();

    for (const text of [
      "Ажлын хоног",
      "Өдрийн дундаж ирц",
      "Өвчтэй",
      "Чөлөөтэй",
      "Энэ сард ирц тогтвортой, сайн байна.",
    ]) {
      expect(within(panel).getAllByText(text).length).toBeGreaterThan(0);
    }

    /*
      ★ The words the client struck out on 2026-09-12 — a rate in prose, where
      a count and a percentage say it without a caption.
    */
    expect(within(panel).queryByText(/Дундаж \/ өдөр/)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/тохиолдол/)).not.toBeInTheDocument();
    expect(within(panel).queryByText("Өвчтэй байсан")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Чөлөөтэй байсан")).not.toBeInTheDocument();
  });

  /*
   * ★ "Диаграммын дээр нийт хэдэн хүүхэд байсныг биччихсэн байсан" — the
   * headcount every percentage on this tab is taken against.
   */
  it("writes the roster over the ring, and each status as a count and a share", async () => {
    stubSummary(
      [
        { date: "2026-02-02", counts: { PRESENT: 9, SICK: 1 } },
        { date: "2026-02-03", counts: { PRESENT: 8, SICK: 1, EXCUSED: 1 } },
      ],
      10,
    );
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} />);
    await openMonth();

    const panel = await screen.findByRole("tabpanel");
    // By test id: the count is a `<span>` inside the line, so a text matcher
    // would only ever see "Нийт  хүүхэд".
    expect(within(panel).getByTestId("month-roster")).toHaveTextContent("Нийт 10 хүүхэд");

    // 20 day-slots across the two days: 2 sick is 10%, 1 excused is 5%.
    expect(within(panel).getByText("Өвчтэй").parentElement).toHaveTextContent("2(10%)");
    expect(within(panel).getByText("Чөлөөтэй").parentElement).toHaveTextContent("1(5%)");

    // And the average carries its own percentage — 8.5 of 10, so 9 and 85%.
    expect(within(panel).getByText("Өдрийн дундаж ирц").parentElement).toHaveTextContent("9(85%)");
  });

  /*
   * ★ An unregistered day is not a day the whole group missed. Two days
   * recorded out of a month of twenty-eight still averages what those two say.
   */
  it("divides by the days that carry a register, not by the calendar", async () => {
    stubSummary(
      [
        { date: "2026-02-02", counts: { PRESENT: 10 } },
        { date: "2026-02-03", counts: { PRESENT: 8, SICK: 2 } },
      ],
      10,
    );
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} />);
    await openMonth();

    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByText("90%")).toBeInTheDocument();
  });

  /*
   * ★ The arrows read a different month without moving the register above — a
   * comparison is a read, and the sheet a teacher is filling in must not move
   * under them.
   */
  it("steps back a month and reports that one instead", async () => {
    const api = stubSummary([{ date: "2026-02-02", counts: { PRESENT: 10 } }], 10, [
      {
        path: `/groups/${GROUP}/attendance/summary?month=2026-01`,
        body: summaryBody("2026-01", 10, [
          { date: "2026-01-05", counts: { PRESENT: 5, ABSENT: 5 } },
        ]),
      },
    ]);
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} />);
    const user = await openMonth();

    await user.click(screen.getByRole("button", { name: "Өмнөх сар" }));

    expect(await screen.findByText("2026 оны 1-р сар")).toBeInTheDocument();
    const panel = screen.getByRole("tabpanel");
    await waitFor(() => expect(within(panel).getByText("50%")).toBeInTheDocument());
    expect(api.calls.some((call) => call.url.includes("month=2026-01"))).toBe(true);
  });

  it("sets the month against the one before it", async () => {
    stubSummary([{ date: "2026-02-02", counts: { PRESENT: 9, ABSENT: 1 } }], 10, [
      {
        path: `/groups/${GROUP}/attendance/summary?month=2026-01`,
        body: summaryBody("2026-01", 10, [
          { date: "2026-01-05", counts: { PRESENT: 8, ABSENT: 2 } },
        ]),
      },
    ]);
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} />);
    await openMonth();

    expect(await screen.findByText(/Өмнөх сараас \+10%-иар өссөн байна\./)).toBeInTheDocument();
  });
});

describe("the panel as a whole", () => {
  /*
    ★ 2026-09-12: the client removed the progress strip that used to open this
    panel ("20% · 1 хүүхэд бүртгэсэн · 5 хүүхдээс · 4 үлдсэн · Ирсэн 1"). The
    ring says it in one picture, and its "Бүртгээгүй" slice is the same
    children the strip called "үлдсэн".
  */
  it("opens with the ring, not with a progress strip", async () => {
    stubSummary([{ date: "2026-02-11", counts: { PRESENT: 1 } }], 5);
    renderWithProviders(
      <AttendanceMonthPanel
        groupId={GROUP}
        month={MONTH}
        date="2026-02-11"
        progress={{
          recorded: 1,
          total: 5,
          breakdown: [{ key: "PRESENT", label: "Ирсэн", count: 1, tone: "mint" }],
        }}
      />,
    );

    await screen.findByText("2026 оны 2-р сарын 11");
    expect(screen.queryByText(/хүүхэд бүртгэсэн/)).not.toBeInTheDocument();
    expect(screen.queryByText(/үлдсэн/)).not.toBeInTheDocument();
    expect(legendRow("Бүртгээгүй")).toHaveTextContent("4");
  });

  it("★ keeps the absentees at the very foot, on both tabs", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/groups/${GROUP}/attendance/summary`,
        body: {
          ...summaryBody(MONTH, 10, [{ date: "2026-02-02", counts: { PRESENT: 8, SICK: 2 } }]),
          children: [
            {
              child: {
                id: "11111111-1111-4111-8111-111111111111",
                firstName: "Ануужин",
                lastName: "Батжаргал",
              },
              counts: { ...ZERO, SICK: 4 },
            },
          ],
        },
      },
    ]);
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} />);

    expect(await screen.findByText("Хамгийн олон өдөр ирээгүй:")).toBeInTheDocument();
    expect(screen.getByText("Батжаргал Ануужин · 4")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Сар" }));
    expect(screen.getByText("Хамгийн олон өдөр ирээгүй:")).toBeInTheDocument();
  });

  it("says nothing was registered rather than reporting a month of zeroes", async () => {
    stubSummary([]);
    renderWithProviders(<AttendanceMonthPanel groupId={GROUP} month={MONTH} />);

    await waitFor(() => expect(screen.getByText("Энэ сард бүртгэл алга")).toBeInTheDocument());
  });
});
