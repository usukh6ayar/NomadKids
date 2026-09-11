import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import GroupAttendancePage from "@/app/(app)/groups/[groupId]/attendance/page";

/**
 * The teacher's register, redrawn as a week grid — the client's sheet,
 * 2026-09-10.
 *
 * ★ What separates this from the day sheet it replaced: the grid shows the
 * span behind today, and only today's column takes input. A register that
 * shows one day can tell a teacher today is complete while last Tuesday was
 * never filled in at all, which is the failure this shape exists to make
 * visible.
 *
 * ★★ On the stubs: `stubApi` matches by `startsWith`, so `/attendance/range`
 * has to be registered before the bare `/attendance` day sheet or the day
 * sheet would answer it and the grid would fail its parse.
 */

const GROUP = "44444444-4444-4444-8444-444444444444";
const CHILD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHILD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENROL_A = "11111111-1111-4111-8111-111111111111";
const ENROL_B = "22222222-2222-4222-8222-222222222222";
const RECORD_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const TODAY = new Date().toISOString().slice(0, 10);
const MONTH_START = `${TODAY.slice(0, 7)}-01`;
/** The Monday of the week today falls in — the register's own default span. */
const MONDAY = (() => {
  const date = new Date(`${TODAY}T00:00:00.000Z`);
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return date.toISOString().slice(0, 10);
})();
/** A day that is always in the span and never today — the read-only column. */
const EARLIER = `${TODAY.slice(0, 7)}-01`;

const CHILDREN = [
  { id: CHILD_A, lastName: "Батжаргал", firstName: "Ануужин" },
  { id: CHILD_B, lastName: "Ганболд", firstName: "Батбаяр" },
];

function stubRegister({
  recorded = false,
  pendingRequests = 0,
}: { recorded?: boolean; pendingRequests?: number } = {}) {
  const daySheet = CHILDREN.map((child, index) => ({
    child,
    enrollmentId: index === 0 ? ENROL_A : ENROL_B,
    record: recorded ? { id: RECORD_A, status: "PRESENT", note: null } : null,
  }));

  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: `/groups/${GROUP}/attendance/range`,
      method: "GET",
      body: {
        days: EARLIER === TODAY ? [TODAY] : [EARLIER, TODAY],
        rows: CHILDREN.map((child, index) => ({
          child,
          enrollmentId: index === 0 ? ENROL_A : ENROL_B,
          records: index === 0 ? { [EARLIER]: { id: RECORD_A, status: "SICK", note: null } } : {},
        })),
      },
    },
    {
      path: `/groups/${GROUP}/attendance/summary`,
      method: "GET",
      body: { month: TODAY.slice(0, 7), totals: {}, days: [], children: [], roster: 2 },
    },
    { path: `/groups/${GROUP}/attendance`, method: "PUT", body: [] },
    { path: `/groups/${GROUP}/attendance`, method: "GET", body: daySheet },
    {
      path: "/attendance-requests/review-queue",
      body: { items: [], page: 1, pageSize: 20, total: pendingRequests, totalPages: 0 },
    },
    { path: "/groups", body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 } },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ groupId: GROUP });
  setSearchParams("");
});

/** The register table, by its accessible caption. */
async function grid(): Promise<HTMLElement> {
  return screen.findByRole("table", { name: /Бүлгийн ирцийн бүртгэл/ });
}

describe("the teacher's week register", () => {
  it("names children as Б.Ануужин, not in full", async () => {
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    const table = await grid();

    // The client's convention: a register is a name against twenty date
    // columns, and the surname spends width a teacher does not read.
    expect(within(table).getByText("Б.Ануужин")).toBeInTheDocument();
    expect(within(table).getByText("Г.Батбаяр")).toBeInTheDocument();
    expect(within(table).queryByText("Батжаргал Ануужин")).not.toBeInTheDocument();
  });

  it("draws a saved day from an earlier column and leaves it read-only", async () => {
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    const table = await grid();

    // Ануужин was marked sick on the first of the month.
    expect(within(table).getByText("Ө")).toBeInTheDocument();
    // Nothing is editable until Засах, so the grid offers no controls at all.
    expect(within(table).queryByRole("combobox")).not.toBeInTheDocument();
  });

  /*
   * ★ The point of the whole shape: a teacher who has filled in today can
   * still see, in the same table, that an earlier day carries nothing.
   */
  it("shows an unmarked day as empty rather than as absent", async () => {
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    const table = await grid();

    // Батбаяр has no record on any day in the span; his cells say so by
    // carrying the "тэмдэглээгүй" name and no status letter.
    expect(within(table).getAllByText("тэмдэглээгүй").length).toBeGreaterThan(0);
  });

  it("opens the edit column with everybody already marked Ирсэн", async () => {
    const user = userEvent.setup();
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    await user.click(await screen.findByRole("button", { name: /Засах/ }));

    // A kindergarten morning is "everybody came except two". Both children
    // start present, so the exception is the only thing left to press.
    const table = await grid();
    const cells = within(table).getAllByRole("combobox");
    expect(cells).toHaveLength(CHILDREN.length);
    for (const cell of cells) expect(cell).toHaveValue("PRESENT");
  });

  it("offers a teacher four statuses, not the six the data holds", async () => {
    const user = userEvent.setup();
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    await grid();
    await user.click(await screen.findByRole("button", { name: /Засах/ }));

    const table = await grid();
    const cell = within(table).getAllByRole("combobox")[0]!;
    const offered = within(cell)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean);

    // Хагас өдөр and Бусад stay valid in the data — funding and invoices both
    // count HALF_DAY — but a teacher may no longer assign them.
    expect(offered).toEqual(["PRESENT", "SICK", "EXCUSED", "ABSENT"]);
  });

  it("moves the day's tally as the teacher marks, before anything is saved", async () => {
    const user = userEvent.setup();
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    await grid();
    await user.click(await screen.findByRole("button", { name: /Засах/ }));

    const table = await grid();
    /*
     * By the tfoot's own row header, not by row name: a child's row carries
     * the sr-only status of every cell in it, so a name match on "Өвчтэй"
     * finds the sick child as well as the tally line.
     */
    const tallyFor = (label: string) =>
      within(table).getByRole("rowheader", { name: label }).closest("tr")!;

    expect(within(tallyFor("Өвчтэй")).getAllByRole("cell").at(-1)).toHaveTextContent("0");

    await user.selectOptions(within(table).getAllByRole("combobox")[0]!, "SICK");

    // The count moves on the draft, before any save — a teacher who marks a
    // child and watches the total sit still learns to distrust both numbers.
    await waitFor(() =>
      expect(within(tallyFor("Өвчтэй")).getAllByRole("cell").at(-1)).toHaveTextContent("1"),
    );
    expect(within(tallyFor("Ирсэн")).getAllByRole("cell").at(-1)).toHaveTextContent("1");
    expect(within(tallyFor("нийт")).getAllByRole("cell").at(-1)).toHaveTextContent("2");
  });

  it("sends only the children whose status changed", async () => {
    const user = userEvent.setup();
    const api = stubRegister({ recorded: true });
    renderWithProviders(<GroupAttendancePage />);
    await grid();
    await user.click(await screen.findByRole("button", { name: /Засах/ }));

    const table = await grid();
    await user.selectOptions(within(table).getAllByRole("combobox")[1]!, "ABSENT");
    await user.click(screen.getByRole("button", { name: /Ирц бүртгэх/ }));

    await waitFor(() => {
      const put = api.calls.find((call) => call.method === "PUT");
      expect(put?.body).toMatchObject({
        date: TODAY,
        entries: [{ childId: CHILD_B, status: "ABSENT" }],
      });
    });
  });

  it("names the teacher who took the register once the day is complete", async () => {
    stubRegister({ recorded: true });
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    // The funding claim is built on these rows, so "who said this child was
    // here" belongs on the sheet, not only in the audit log.
    expect(await screen.findByText(/Ирц авсан бүлгийн багш/)).toBeInTheDocument();
  });

  /*
   * ★ The week, not the month so far — the client's own reading: "тухайн 7
   * хоног харагдахад л болох юм байна".
   *
   * It opened on the first of the month, so by the end of September the sheet
   * was twenty-two columns wide and a teacher scrolled sideways past three
   * weeks they had already filed to reach today.
   */
  it("opens on the week the chosen day sits in", async () => {
    const api = stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    const call = api.calls.find((item) => item.url.includes("/attendance/range"));
    expect(call?.url).toContain(`from=${MONDAY}`);
    expect(call?.url).toContain(`to=${TODAY}`);

    // Monday, whatever day the test runs on — and never after today.
    expect(new Date(`${MONDAY}T00:00:00.000Z`).getUTCDay()).toBe(1);
    expect(MONDAY <= TODAY).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The three doors under the register
// ═══════════════════════════════════════════════════════════════════════════

describe("the register's three panels", () => {
  const door = (name: string) => screen.getByRole("button", { name: new RegExp(name) });

  /*
   * ★ The default is the reason the buttons exist. All three panels used to be
   * open at once — an empty queue and two ESIS tables of sixty rows between
   * them — so a teacher scrolled past all of it every morning to reach nothing.
   */
  it("opens none of them until one is pressed", async () => {
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);

    await grid();
    expect(door("Ирцийн дэлгэрэнгүй")).toHaveAttribute("aria-expanded", "false");
    expect(door("Чөлөөний хүсэлт")).toHaveAttribute("aria-expanded", "false");
    expect(door("Esis ирц")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Сар")).not.toBeInTheDocument();
  });

  it("opens the journal as the same grid, read-only, over a whole month", async () => {
    const user = userEvent.setup();
    const api = stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    await user.click(door("Ирцийн дэлгэрэнгүй"));

    expect(await screen.findByLabelText("Сар")).toBeInTheDocument();
    // A journal is the record read back; writing it is the register above.
    const tables = await screen.findAllByRole("table", { name: /Бүлгийн ирцийн бүртгэл/ });
    expect(tables.length).toBeGreaterThan(1);

    // The month, end to end — not the register's own span.
    await waitFor(() =>
      expect(
        api.calls.some(
          (call) => call.url.includes(`from=${MONTH_START}`) && call.url.includes("/range"),
        ),
      ).toBe(true),
    );
  });

  /*
   * ★ The question the journal exists to answer — "how often was this child
   * ill" — which the register above cannot, because it is one morning.
   */
  it("counts each child's own month in trailing columns", async () => {
    const user = userEvent.setup();
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    await user.click(door("Ирцийн дэлгэрэнгүй"));
    await screen.findByLabelText("Сар");

    const journal = (await screen.findAllByRole("table", { name: /Бүлгийн ирцийн бүртгэл/ })).at(
      -1,
    )!;
    // Ануужин carries one SICK day in the stubbed span and nothing else.
    const row = within(journal).getByRole("row", { name: /Б\.Ануужин/ });
    const cells = within(row).getAllByRole("cell");
    // …Ирсэн, Өвчтэй, Чөлөөтэй, Тасалсан, Нийт — the last five of the row.
    expect(cells.slice(-5).map((cell) => cell.textContent)).toEqual(["0", "1", "0", "0", "1"]);
  });

  it("offers the month as a spreadsheet", async () => {
    const user = userEvent.setup();
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    await user.click(door("Ирцийн дэлгэрэнгүй"));

    const link = await screen.findByRole("link", { name: /Сарын дэлгэрэнгүй татах/ });
    // A plain link, so the browser saves the attachment and keeps the cookie
    // the API authorises on.
    expect(link.getAttribute("href")).toContain(
      `/groups/${GROUP}/attendance/range/export?from=${MONTH_START}`,
    );
  });

  it("counts the waiting notices on the Чөлөөний хүсэлт button", async () => {
    stubRegister({ pendingRequests: 3 });
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    const button = door("Чөлөөний хүсэлт");
    await waitFor(() => expect(within(button).getByText("3")).toBeInTheDocument());
  });

  it("carries no badge when nothing is waiting", async () => {
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    // A zero badge is a decoration that teaches a teacher to ignore the badge.
    expect(within(door("Чөлөөний хүсэлт")).queryByText("0")).not.toBeInTheDocument();
  });

  it("shows only one panel at a time", async () => {
    const user = userEvent.setup();
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    await user.click(door("Ирцийн дэлгэрэнгүй"));
    expect(await screen.findByLabelText("Сар")).toBeInTheDocument();

    await user.click(door("Чөлөөний хүсэлт"));

    await waitFor(() => expect(screen.queryByLabelText("Сар")).not.toBeInTheDocument());
    expect(door("Ирцийн дэлгэрэнгүй")).toHaveAttribute("aria-expanded", "false");
    expect(door("Чөлөөний хүсэлт")).toHaveAttribute("aria-expanded", "true");
  });

  it("closes a panel when its own button is pressed again", async () => {
    const user = userEvent.setup();
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    await user.click(door("Ирцийн дэлгэрэнгүй"));
    await screen.findByLabelText("Сар");
    await user.click(door("Ирцийн дэлгэрэнгүй"));

    await waitFor(() => expect(screen.queryByLabelText("Сар")).not.toBeInTheDocument());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The controls, and where they sit
// ═══════════════════════════════════════════════════════════════════════════

describe("the register's controls", () => {
  /*
   * ★ Засах and ESIS рүү илгээх lived in the page header, a scroll above the
   * sheet they act on: a teacher finished the last row and had to go back to
   * the top to save it.
   */
  it("puts all three acts under the grid, not in the page header", async () => {
    stubRegister({ recorded: true });
    renderWithProviders(<GroupAttendancePage />);
    const table = await grid();

    const after = (name: RegExp) => {
      const button = screen.getByRole("button", { name });
      // DOCUMENT_POSITION_FOLLOWING: the button comes after the table.
      return Boolean(table.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
    };

    expect(after(/Засах/), "Засах is above the register").toBe(true);
    expect(after(/илгээх/), "ESIS илгээх is above the register").toBe(true);
  });

  /*
   * ★ All three are present at once, and disabled rather than absent when
   * their turn has not come — a control that appears only once some other
   * condition is met is a control a teacher never learns they have.
   */
  it("keeps all three controls on screen, enabling them in turn", async () => {
    const user = userEvent.setup();
    stubRegister({ recorded: true });
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    // Read mode: nothing to save, so бүртгэх waits.
    expect(screen.getByRole("button", { name: /Засах/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Ирц бүртгэх/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Засах/ }));

    // Editing: Засах becomes Болих, and filing a day still being changed waits.
    expect(screen.getByRole("button", { name: /Болих/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /илгээх/ })).toBeDisabled();

    const table = await grid();
    await user.selectOptions(within(table).getAllByRole("combobox")[0]!, "SICK");
    expect(screen.getByRole("button", { name: /Ирц бүртгэх/ })).toBeEnabled();
  });

  /*
   * The banner said "N хүүхдийн ирц хадгалагдаагүй байна" above a grid that
   * already shows exactly which children and which days. The client asked for
   * it to go.
   */
  it("no longer warns in words about what the grid already draws", async () => {
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    expect(screen.queryByText(/хадгалагдаагүй байна/)).not.toBeInTheDocument();
  });

  /*
   * ★ The heading went, and the fields' labels folded into `aria-label` —
   * both at the client's request that the top of the screen stop competing
   * with the register. What must not go with them is the naming: a date field
   * a screen reader calls "blank" is not quieter, it is broken.
   */
  it("keeps the register's controls named after their labels were folded away", async () => {
    stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    expect(screen.getByLabelText("Эхлэх огноо")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Дуусах огноо")).toHaveAttribute("type", "date");
    expect(screen.getByRole("button", { name: "Хайх" })).toBeInTheDocument();

    // The grid below is unmistakably the register; the heading restated it and
    // its headcount is the tally's own last row.
    expect(screen.queryByRole("heading", { name: "Бүлгийн ирц" })).not.toBeInTheDocument();
  });

  it("applies a new span only when Хайх is pressed", async () => {
    const user = userEvent.setup();
    const api = stubRegister();
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    const before = api.calls.filter((call) => call.url.includes("/range")).length;
    const start = screen.getByLabelText("Эхлэх огноо");

    // A date input fires onChange per keystroke; a live range would ask the
    // API about every half-typed date on the way.
    await user.clear(start);
    await user.type(start, "2026-01-05");
    expect(api.calls.filter((call) => call.url.includes("/range")).length).toBe(before);

    await user.click(screen.getByRole("button", { name: /Хайх/ }));

    await waitFor(() =>
      expect(
        api.calls.some(
          (call) => call.url.includes("/range") && call.url.includes("from=2026-01-05"),
        ),
      ).toBe(true),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Days the kindergarten is shut
// ═══════════════════════════════════════════════════════════════════════════

/** A Saturday and the Friday before it, both in the past. */
const FRIDAY = "2026-02-06";
const SATURDAY = "2026-02-07";

function stubWeekend() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: `/groups/${GROUP}/attendance/range`,
      method: "GET",
      body: {
        days: [FRIDAY, SATURDAY],
        rows: [
          {
            child: CHILDREN[0]!,
            enrollmentId: ENROL_A,
            records: { [SATURDAY]: { id: RECORD_A, status: "PRESENT", note: null } },
          },
        ],
      },
    },
    {
      path: `/groups/${GROUP}/attendance/summary`,
      method: "GET",
      body: {
        month: "2026-02",
        totals: { PRESENT: 0, HALF_DAY: 0, EXCUSED: 0, SICK: 0, ABSENT: 0, OTHER: 0 },
        days: [],
        children: [],
        roster: 1,
      },
    },
    { path: `/groups/${GROUP}/attendance`, method: "PUT", body: [] },
    {
      path: `/groups/${GROUP}/attendance`,
      method: "GET",
      body: [{ child: CHILDREN[0]!, enrollmentId: ENROL_A, record: null }],
    },
    {
      path: "/attendance-requests/review-queue",
      body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 },
    },
    { path: "/groups", body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 } },
  ]);
}

describe("weekends", () => {
  it("names a Saturday column as a closed day", async () => {
    setSearchParams(`date=${SATURDAY}`);
    stubWeekend();
    renderWithProviders(<GroupAttendancePage />);
    const table = await grid();

    // "Бя" is Saturday's own abbreviation, so the column is still drawn — the
    // dates around it have to line up.
    expect(within(table).getByText("Бя")).toBeInTheDocument();
  });

  /*
   * ★ A record that already exists on a weekend is still drawn.
   *
   * Refusing to *create* one is the rule; hiding one that is in the database
   * would make this grid disagree with the totals beside it and with the
   * funding claim built on the same rows.
   */
  it("still draws a mark somebody already made on a closed day", async () => {
    setSearchParams(`date=${SATURDAY}`);
    stubWeekend();
    renderWithProviders(<GroupAttendancePage />);
    const table = await grid();

    expect(within(table).getByText("И")).toBeInTheDocument();
  });

  it("refuses to open the editor on a closed day", async () => {
    setSearchParams(`date=${SATURDAY}`);
    stubWeekend();
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    // `beginEdit` fills the draft for every child on the editable day, so a
    // Saturday editor would queue a register nobody could see.
    expect(screen.getByRole("button", { name: /Засах/ })).toBeDisabled();
  });

  it("offers no control on a Saturday even while another day is being edited", async () => {
    const user = userEvent.setup();
    setSearchParams(`date=${FRIDAY}`);
    stubWeekend();
    renderWithProviders(<GroupAttendancePage />);
    await grid();

    await user.click(screen.getByRole("button", { name: /Засах/ }));

    const table = await grid();
    // One child, two columns, and only the Friday one takes input.
    expect(within(table).getAllByRole("combobox")).toHaveLength(1);
  });
});
