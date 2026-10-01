import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import DailyAttendancePage from "@/app/(app)/attendance/daily/page";

/**
 * Өдөр тутмын ирц — the client's 2026-09-25 drawing.
 *
 * ★ Pinned beyond the layout: the approval columns and ESIS's accepted/refused
 * counts have no data yet and read "—"; ESIS shows only whether the day went.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "55555555-5555-4555-8555-555555555555";

function row(day: number, group = "Дэлбээ бүлэг", sent = false) {
  const date = `2026-09-${String(day).padStart(2, "0")}`;
  return {
    schoolYear: "2026-2027",
    groupId: GROUP,
    group,
    date,
    expected: 42,
    recorded: 42,
    unrecorded: 0,
    complete: true,
    present: 26,
    excused: 16,
    sick: 0,
    absent: 0,
    sentAt: sent ? `${date}T10:00:00.000Z` : null,
    sentBy: null,
    createdAt: null,
    createdBy: [],
    requests: { pending: 1, approved: 2, rejected: 0 },
    esis: {
      succeeded: sent ? 1 : 0,
      failed: sent ? 1 : 0,
      lastOutcome: sent ? ("SUCCEEDED" as const) : null,
      lastError: null,
      lastAttemptAt: null,
    },
  };
}

function stub(items: ReturnType<typeof row>[]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    {
      path: `/kindergartens/${KG}/attendance/daily`,
      body: {
        kindergartenName: "Цэцэрлэг",
        from: "2026-09-01",
        to: "2026-09-27",
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
          days: 0,
          requests: { pending: 0, approved: 0, rejected: 0 },
        },
      },
    },
    {
      path: "/groups",
      body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("the daily attendance register", () => {
  it("draws the day under grouped headings, inventing nothing", async () => {
    stub([row(25, "Дэлбээ бүлэг", true)]);
    renderWithProviders(<DailyAttendancePage />);

    await userEvent.click(await screen.findByRole("tab", { name: "Өдрөөр" }));
    const table = await screen.findByRole("table", { name: "Өдөр тутмын ирцийн бүртгэл" });
    const groups = [...table.querySelectorAll('th[scope="colgroup"]')].map((th) => th.textContent);
    expect(groups).toEqual(["Ирц", "Баталгаажуулалт", "ESIS"]);
    const cells = within(table).getAllByRole("row").at(-1)!.querySelectorAll("td");
    expect([...cells].map((cell) => cell.textContent?.trim())).toEqual([
      "2026.09.25",
      "Дэлбээ бүлэг",
      "42",
      "26",
      "0",
      "16",
      "0",
      // Баталгаажуулалт — approved, refused, pending (#135).
      "2",
      "0",
      "1",
      // ESIS — sent, then the attempts that succeeded and failed (#149).
      "✓",
      "1",
      "1",
      "Бүртгэх",
    ]);
    expect(within(table).getByRole("link", { name: /Бүртгэх/ })).toHaveAttribute(
      "href",
      `/groups/${GROUP}/attendance?date=2026-09-25`,
    );
  });

  it("sends a finished, unsent day to ESIS after a confirmation", async () => {
    const user = userEvent.setup();
    const api = stub([row(24)]);
    renderWithProviders(<DailyAttendancePage />);

    await userEvent.click(await screen.findByRole("tab", { name: "Өдрөөр" }));
    const table = await screen.findByRole("table", { name: "Өдөр тутмын ирцийн бүртгэл" });
    await user.click(within(table).getByRole("button", { name: "Илгээх" }));
    const dialog = await screen.findByRole("dialog", { name: "ESIS рүү илгээх үү?" });
    await user.click(within(dialog).getByRole("button", { name: "Илгээх" }));

    await waitFor(() => {
      const call = api.calls.find(
        (c) => c.method === "POST" && c.url === `/kindergartens/${KG}/attendance/daily/submit`,
      );
      expect(call?.body).toEqual({ entries: [{ groupId: GROUP, date: "2026-09-24" }] });
    });
  });

  it("pages ten days at a time", async () => {
    stub(Array.from({ length: 12 }, (_, i) => row(i + 1)));
    renderWithProviders(<DailyAttendancePage />);

    await userEvent.click(await screen.findByRole("tab", { name: "Өдрөөр" }));
    const table = await screen.findByRole("table", { name: "Өдөр тутмын ирцийн бүртгэл" });
    expect(within(table).getAllByRole("row")).toHaveLength(2 + 10);
    expect(screen.getByText(/бичлэг/).textContent).toMatch(/Нийт 12 бичлэг/);
  });

  it("narrows the table by group name", async () => {
    const user = userEvent.setup();
    stub([row(25, "Дэлбээ бүлэг"), row(24, "Наран бүлэг")]);
    renderWithProviders(<DailyAttendancePage />);

    await user.click(await screen.findByRole("tab", { name: "Өдрөөр" }));
    await screen.findByRole("table", { name: "Өдөр тутмын ирцийн бүртгэл" });
    await user.type(screen.getByRole("searchbox", { name: /Бүлгийн нэрээр хайх/ }), "Наран");
    expect(screen.queryByText("Дэлбээ бүлэг")).toBeNull();
    expect(screen.getByText("Наран бүлэг")).toBeInTheDocument();
  });
});

const CHILD = "66666666-6666-4666-8666-666666666666";

function stubRegister() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    {
      path: `/kindergartens/${KG}/attendance/register`,
      body: {
        items: [
          {
            childId: CHILD,
            child: { id: CHILD, lastName: "Аманбек", firstName: "Абдуллин", status: "ACTIVE" },
            group: {
              id: GROUP,
              name: "Дэлбээ",
              ageBand: null,
              programKind: "MAIN",
              attendanceForm: "STANDARD",
            },
            days: [
              { status: "PRESENT", note: null },
              { status: "PRESENT", note: null },
              { status: "ABSENT", note: "Эмчид үзүүлсэн" },
            ],
            counts: { PRESENT: 2, ABSENT: 1 },
            recorded: 3,
            expectedDays: 3,
            requests: { pending: 0, approved: 1, rejected: 0 },
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        from: "2026-09-01",
        to: "2026-09-30",
        days: ["2026-09-01", "2026-09-02", "2026-09-03"],
        totals: {},
        groups: [],
      },
    },
    {
      path: "/groups",
      body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
    },
  ]);
}

describe("Суралцагчаар", () => {
  beforeEach(() => setSearchParams("from=2026-09-01"));

  it("counts each child's month from the register, inventing nothing", async () => {
    const user = userEvent.setup();
    stubRegister();
    renderWithProviders(<DailyAttendancePage />);

    await user.click(await screen.findByRole("tab", { name: "Суралцагчаар" }));
    expect(screen.getByRole("heading", { level: 1, name: "Суралцагчаар" })).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Суралцагчийн ирцийн бүртгэл" });
    const cells = within(table).getAllByRole("row").at(-1)!.querySelectorAll("td");
    expect([...cells].map((cell) => cell.textContent?.trim())).toEqual([
      "1",
      "Дэлбээ",
      "Аманбек",
      "Абдуллин",
      "3",
      "2",
      "0",
      "0",
      "1",
      "1",
      "0",
      "66.7%",
      "Харах",
    ]);
    expect(screen.getByText(/суралцагч$/).textContent).toMatch(/Нийт 1 суралцагч/);
  });

  it("opens one child's month beside the table", async () => {
    const user = userEvent.setup();
    stubRegister();
    renderWithProviders(<DailyAttendancePage />);

    await user.click(await screen.findByRole("tab", { name: "Суралцагчаар" }));
    await user.click(await screen.findByRole("button", { name: /Аманбек Абдуллин — харах/ }));
    const panel = screen.getByRole("dialog", { name: "Суралцагчийн дэлгэрэнгүй" });
    expect(within(panel).getByText("2026 оны 9 сар")).toBeInTheDocument();
    expect(await within(panel).findByText("Нийт өдөр")).toBeInTheDocument();
    expect(within(panel).getByText("(66.7%)")).toBeInTheDocument();

    const recent = within(panel).getByRole("table", { name: "Сүүлийн бүртгэлүүд" });
    const first = within(recent).getAllByRole("row")[1]!.querySelectorAll("td");
    expect([...first].map((cell) => cell.textContent?.trim())).toEqual([
      "2026-09-03",
      "Т",
      "Эмчид үзүүлсэн",
      "—",
      "—",
    ]);
    expect(within(panel).getByRole("link", { name: /Ирц засах/ })).toHaveAttribute(
      "href",
      `/groups/${GROUP}/attendance?date=2026-09-03`,
    );
    expect(within(panel).getByRole("button", { name: /ESIS руу илгээх/ })).toBeDisabled();

    await user.click(within(panel).getByRole("button", { name: "Дараагийн сар" }));
    expect(within(panel).getByText("2026 оны 10 сар")).toBeInTheDocument();
  });

  it("sends the status and the name to the register", async () => {
    const user = userEvent.setup();
    const { calls } = stubRegister();
    renderWithProviders(<DailyAttendancePage />);

    await user.click(await screen.findByRole("tab", { name: "Суралцагчаар" }));
    await screen.findByRole("table", { name: "Суралцагчийн ирцийн бүртгэл" });
    await user.click(screen.getByRole("combobox", { name: "Төлөв" }));
    await user.click(await screen.findByRole("option", { name: "Тасалсан" }));
    await user.type(screen.getByRole("searchbox", { name: /Нэрээр хайх/ }), "Аман");

    await vi.waitFor(() =>
      expect(
        calls.some((call) => {
          const url = decodeURIComponent(call.url);
          return (
            url.includes("/attendance/register?") &&
            url.includes("status=ABSENT") &&
            url.includes("q=Аман")
          );
        }),
      ).toBe(true),
    );
  });
});

describe("Сараар", () => {
  it("asks for a group before it counts anything", async () => {
    const user = userEvent.setup();
    setSearchParams("from=2026-09-01");
    stubRegister();
    renderWithProviders(<DailyAttendancePage />);

    await user.click(await screen.findByRole("tab", { name: "Сараар" }));
    expect(screen.getByRole("heading", { level: 1, name: "Сараар" })).toBeInTheDocument();
    expect(screen.getByText("Бүлэг сонгоно уу")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Хэвлэх/ })).toBeInTheDocument();
  });

  it("draws a child per row, a working day per column, and the group's day totals", async () => {
    const user = userEvent.setup();
    setSearchParams(`from=2026-09-01&groupId=${GROUP}`);
    stubRegister();
    renderWithProviders(<DailyAttendancePage />);

    await user.click(await screen.findByRole("tab", { name: "Сараар" }));
    const table = await screen.findByRole("table", { name: "Ирцийн задаргаа" });
    const [weekdays] = within(table).getAllByRole("row");
    expect([...weekdays!.querySelectorAll("th")].slice(3, 6).map((th) => th.textContent)).toEqual([
      "Мя",
      "Лх",
      "Пү",
    ]);

    const body = table.querySelector("tbody tr")!.querySelectorAll("td");
    expect([...body].map((cell) => cell.textContent?.trim())).toEqual([
      "1",
      "Аманбек",
      "Абдуллин",
      "И",
      "И",
      "Т",
      "3",
      "—",
      "2",
      "0",
      "0",
      "1",
    ]);

    const present = table.querySelector("tfoot tr")!.querySelectorAll("td");
    expect([...present].map((cell) => cell.textContent)).toEqual(["1", "1", "0", "2"]);
  });
});

describe("Жилээр", () => {
  it("merges safe API windows into one September–June grid", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/kindergartens/${KG}/attendance/daily`,
        body: {
          kindergartenName: "Цэцэрлэг",
          from: "2026-09-01",
          to: "2026-09-30",
          items: [],
          totals: {
            expected: 0,
            unrecorded: 0,
            present: 0,
            excused: 0,
            sick: 0,
            absent: 0,
            complete: 0,
            sent: 0,
            days: 0,
          },
        },
      },
      {
        path: `/kindergartens/${KG}/school-years`,
        body: [
          {
            id: "77777777-7777-4777-8777-777777777777",
            name: "2026-2027",
            isCurrent: true,
            startsOn: "2026-09-01",
            endsOn: "2027-06-30",
          },
        ],
      },
      {
        path: "/groups",
        body: {
          items: [
            {
              id: GROUP,
              name: "Дэлбээ",
              ageBand: "MIDDLE",
              kindergartenId: KG,
              schoolYearId: "77777777-7777-4777-8777-777777777777",
              status: "ACTIVE",
              schoolYear: null,
              _count: { enrollments: 1 },
              photoMediaFileId: null,
            },
          ],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        },
      },
      {
        path: `/kindergartens/${KG}/attendance/register`,
        body: {
          items: [
            {
              childId: CHILD,
              child: { id: CHILD, lastName: "Аманбек", firstName: "Абдуллин", status: "ACTIVE" },
              group: {
                id: GROUP,
                name: "Дэлбээ",
                ageBand: "MIDDLE",
                programKind: "MAIN",
                attendanceForm: "STANDARD",
              },
              days: [{ status: "PRESENT", note: null }],
              counts: { PRESENT: 1 },
              recorded: 1,
              expectedDays: 1,
            },
          ],
          page: 1,
          pageSize: 200,
          total: 1,
          totalPages: 1,
          from: "2026-09-01",
          to: "2026-11-30",
          days: ["2026-09-01"],
          totals: { PRESENT: 1 },
          groups: [],
        },
      },
    ]);
    renderWithProviders(<DailyAttendancePage />);

    await user.click(await screen.findByRole("tab", { name: "Жилээр" }));
    expect(screen.getByRole("heading", { level: 1, name: "Жилээр" })).toBeInTheDocument();
    /*
     * The page opens on «Суралцагчаар», whose own register read is in `calls`
     * too — only the year grid's windows (pageSize 200) are counted.
     */
    const yearCalls = () =>
      calls.filter(
        (call) =>
          call.url.includes("/attendance/register?") &&
          new URLSearchParams(call.url.split("?")[1]).get("pageSize") === "200",
      );
    await waitFor(() => expect(yearCalls()).toHaveLength(4));
    const table = await screen.findByRole("table", { name: "Хичээлийн жилийн ирцийн тайлан" });
    expect(within(table).getByText("Аманбек Абдуллин")).toBeInTheDocument();
    expect(within(table).getByText("9-р сар")).toBeInTheDocument();
    expect(within(table).getByText("6-р сар")).toBeInTheDocument();
    expect(within(table).getAllByText("1").length).toBeGreaterThan(0);

    const registerCalls = yearCalls();
    expect(registerCalls).toHaveLength(4);
    for (const call of registerCalls) {
      const params = new URLSearchParams(call.url.split("?")[1]);
      const from = Date.parse(`${params.get("from")}T00:00:00Z`);
      const to = Date.parse(`${params.get("to")}T00:00:00Z`);
      expect(Math.floor((to - from) / 86_400_000) + 1).toBeLessThanOrEqual(92);
    }
  });
});
