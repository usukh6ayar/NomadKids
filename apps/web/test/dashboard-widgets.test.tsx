import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { ClassBoardNotice } from "@/components/dashboard/class-board-notice";
import { GenderRatio } from "@/components/dashboard/gender-ratio";
import { MonthBirthdays } from "@/components/dashboard/month-birthdays";
import { AttendanceToday } from "@/components/dashboard/attendance-today";
import { TodayMenu } from "@/components/dashboard/today-menu";
import { ObservationMix } from "@/components/dashboard/observation-mix";
import { TermProgress } from "@/components/dashboard/term-progress";

/**
 * The widgets from the client's sketch, against what the database actually
 * holds.
 *
 * ★ This file used to say four of the eight drawn tiles "have no model
 * anywhere in the schema" — attendance, the meal menu, the survey and chat.
 * That was true when it was written and stopped being true on 2026-08-25, when
 * CLAUDE.md §7 pulled RFP Module 2 into scope and `Attendance`, `MenuDay` and
 * `AllergyRecord` shipped. Attendance and the menu are covered below.
 *
 * **Chat remains the one that is genuinely absent** — Phase IV, no model, no
 * endpoint — and it is represented in the product by a nav entry with no href
 * rather than by anything on this screen.
 */

const TODAY = new Date().toISOString().slice(0, 10);
const GROUP = { id: "44444444-4444-4444-8444-444444444444", name: "Бага бүлэг", ageBand: "3-4" };

/**
 * A day sheet row. `record: null` is a child nobody has marked yet.
 *
 * The ids are real UUIDs because `groupAttendanceRowSchema` parses them — a
 * placeholder string would fail Zod, and the component would render its error
 * branch while the test claimed to be exercising the happy path.
 */
function row(n: number, status: string | null) {
  const id = `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`;
  return {
    child: { id, lastName: "Тест", firstName: `Хүүхэд ${n}` },
    enrollmentId: `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`,
    record: status
      ? { id: `77777777-7777-4777-8777-${String(n).padStart(12, "0")}`, status, note: null }
      : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("бүлгийн хүүхдүүд", () => {
  it("states both counts", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/children/summary", body: { total: 32, averageAgeMonths: 41, boys: 14, girls: 18 } },
    ]);

    renderWithProviders(<GenderRatio />);

    expect(await screen.findByText("14")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("Хөвгүүд")).toBeInTheDocument();
    expect(screen.getByText("Охид")).toBeInTheDocument();
    /*
      ★ The shares went with the donut on 2026-08-28, and their absence is the
      assertion now rather than an omission.

      The client's dashboard shows two counts and no percentages. A demo group
      is five children, and "44% / 56%" over two single-digit counts is
      precision the numbers cannot carry — see `gender-ratio.tsx`.
    */
    expect(screen.queryByText("44%")).toBeNull();
    expect(screen.queryByText("56%")).toBeNull();
  });

  /**
   * ★ The bar's proportions are the only thing its shape conveys, and a screen
   * reader cannot see proportions — so both counts are in its accessible name.
   */
  it("names the split for a screen reader", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/children/summary", body: { total: 32, averageAgeMonths: 41, boys: 14, girls: 18 } },
    ]);

    renderWithProviders(<GenderRatio />);

    expect(await screen.findByRole("img", { name: "14 хүү, 18 охин" })).toBeInTheDocument();
  });

  /**
   * ★★ The share is taken over the children who have a recorded sex, not over
   * the roster. A child with neither value belongs to no segment, and dividing
   * by the roster would draw a gap that stands for nothing a reader could name.
   *
   * ★★★ This asserted that the component rendered *nothing* until 2026-08-28.
   * The tile is now the second of the dashboard's three top cards, which the
   * client's brief requires to be present and level, so it states the case
   * instead of vanishing — the same reversal `MonthBirthdays` and
   * `ClassBoardNotice` each record. What has to stay true is the arithmetic:
   * no chart is drawn, and no percentage is invented from a zero denominator.
   */
  it("says nobody's sex is recorded instead of vanishing", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/children/summary", body: { total: 5, averageAgeMonths: 41, boys: 0, girls: 0 } },
    ]);

    renderWithProviders(<GenderRatio />);

    expect(await screen.findByText("Хүйс бүртгэгдээгүй")).toBeInTheDocument();
    // No donut, and no share computed against a denominator of zero.
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByText("NaN%")).toBeNull();
  });

  /**
   * ★ The loading state is a tile, not a hole.
   *
   * `!data` was true for the whole of the roster request, so the top row used
   * to render two cards and a gap and then reflow when the third arrived. The
   * skeleton holds the footprint instead.
   */
  it("holds its place while the roster is still loading", () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"]) }]);

    const { container } = renderWithProviders(<GenderRatio />);

    expect(container.firstElementChild).not.toBeNull();
    expect(container.textContent).not.toContain("Хөвгүүд");
  });
});

describe("төрсөн өдөр", () => {
  const birthdays = [
    {
      id: "44444444-4444-4444-8444-444444444444",
      lastName: "Ганболд",
      firstName: "Мишээл",
      dateOfBirth: "2021-08-01",
      photoMediaFileId: null,
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      lastName: "Доржийн",
      firstName: "Хишиг",
      dateOfBirth: "2022-08-07",
      photoMediaFileId: null,
    },
  ];

  it("lists the month's children with the day, not a countdown", () => {
    render(<MonthBirthdays birthdays={birthdays} />);

    expect(screen.getByText("8/01")).toBeInTheDocument();
    expect(screen.getByText("8/07")).toBeInTheDocument();
    // A relative phrase is re-read every morning; this list is scanned once.
    expect(screen.queryByText(/хоногийн дараа/)).toBeNull();
  });

  /**
   * ★ This asserted `toBeEmptyDOMElement()` until 2026-08-28, and the change is
   * deliberate rather than a relaxation — it is the same reversal, for the same
   * reason, that `ClassBoardNotice` records two describes below.
   *
   * The old behaviour was right while this tile floated in a stacked column,
   * where vanishing only made the column shorter. It is now the third card of
   * the dashboard's top row, which the client's brief requires to be three
   * cards of equal height — so returning `null` leaves a third of the most
   * prominent band on the screen empty.
   *
   * What has to stay true is that the empty card is *compact*: a line of copy
   * on the tile's own footprint, not the product's centred 96px mascot, which
   * would make the card with nothing in it the tallest of the three.
   */
  it("says the month is empty instead of vanishing", () => {
    render(<MonthBirthdays birthdays={[]} />);

    expect(screen.getByText("Төрсөн өдөр")).toBeInTheDocument();
    expect(screen.getByText("Энэ сард төрсөн өдөр алга")).toBeInTheDocument();
    // Compact: no illustration, and no list where there are no children.
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

/**
 * ★ "Сүүлийн нийтлэл", renamed from "Ангийн самбар" on 2026-08-28.
 *
 * The dashboard's own `<h1>` became "Ангийн самбар" in the same pass, at the
 * client's request, and this card sits on that page — so the section and its
 * page were about to carry one name while the sidebar's "Ангийн самбар / Мэдээ"
 * pointed at a third thing. `lib/vocabulary.ts` exists because that exact
 * failure ("Хавтас meant five things at once") shipped once already.
 *
 * ★★ `renderWithProviders`, not `render`. The component fetches the notice's
 * photograph from `GET /notifications/:id` — `teacherDashboardSchema`'s
 * `boardNotice` projection carries no media — so it needs a QueryClient. The
 * request is deliberately left unstubbed in three of the four cases below: with
 * `retry: false` it fails, `photo` stays null, and the card falls back to the
 * feature's illustration. That fallback is the path most of these assertions
 * are about, and it is the one a kindergarten with text-only notices sees.
 */
describe("сүүлийн нийтлэл", () => {
  const notice = {
    id: "66666666-6666-4666-8666-666666666666",
    title: "Ангийн хурал",
    body: "2028.09.01-нд ангийн хурал болно.",
    publishedAt: "2026-08-20T00:00:00.000Z",
    isImportant: false,
    readCount: 23,
  };

  it("says how many people opened the notice", () => {
    renderWithProviders(<ClassBoardNotice notice={notice} />);

    // The phrase carries the meaning: a bare number beside an eye icon is a
    // puzzle to anyone who cannot see the eye.
    expect(screen.getByText("23 хүн үзсэн")).toBeInTheDocument();
    expect(screen.getByText("Ангийн хурал")).toBeInTheDocument();
  });

  /**
   * ★ A count, never the readers.
   *
   * `notifications.repository.ts` refuses to expose who reacted — "a parent
   * should not learn which other families are reading the board" — and reads
   * are the same fact about the same people. The contract carries no
   * identities, so there is nothing here for a component to leak; this asserts
   * the shape stays that way.
   */
  it("shows no reader identities", () => {
    const { container } = renderWithProviders(<ClassBoardNotice notice={notice} />);

    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(screen.queryByRole("list")).toBeNull();
  });

  /**
   * ★ This asserted `toBeEmptyDOMElement()` — the board used to vanish before
   * the first notice — and the assertion was **deliberately changed**, not
   * relaxed. It is stricter now: it names the copy and the destination.
   *
   * Two things overturned the old behaviour. The board is one half of the
   * communication band, so its absence left the survey and the birthdays in a
   * five-column strip beside 58% of nothing. And a teacher with an empty board
   * is exactly the teacher who should be handed the way to post the first
   * notice — a section that disappears offers nothing and teaches nobody that
   * the board exists.
   *
   * What has to stay true is that it is *compact*: two lines and a link on one
   * row, not the product's centred 96px mascot, which would make the emptiest
   * card on the screen the tallest.
   */
  it("offers the way to post the first notice instead of vanishing", () => {
    renderWithProviders(<ClassBoardNotice notice={null} />);

    expect(screen.getByText("Зарлал хараахан нийтлээгүй")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Зарлал нийтлэх/ })).toHaveAttribute(
      "href",
      "/notifications/new",
    );
    // Compact: no illustration, and none of the read-count chrome that only
    // makes sense once something has been published.
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/үзсэн/)).toBeNull();
  });

  it("marks an important notice with a label, not only a tint", () => {
    renderWithProviders(<ClassBoardNotice notice={{ ...notice, isImportant: true }} />);

    const badge = screen.getByText("Чухал");
    expect(badge).toBeInTheDocument();
    expect(within(badge).queryByRole("img")).toBeNull();
  });
});

describe("өнөөдрийн ирц", () => {
  /**
   * ★ The numerator is the decision this whole tile rests on, so it is pinned.
   *
   * `PRESENT + HALF_DAY` attend; `EXCUSED`, `SICK` and `ABSENT` do not. A child
   * who came for the morning was at the kindergarten, and filing them with the
   * absent children would send a teacher looking for someone asleep next door.
   * Change that rule and this test is what says so out loud.
   */
  it("counts a half day as present and reports the share", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups?",
        body: { items: [GROUP], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
      {
        path: `/groups/${GROUP.id}/attendance`,
        body: [
          row(1, "PRESENT"),
          row(2, "PRESENT"),
          row(3, "HALF_DAY"),
          row(4, "SICK"),
          row(5, "ABSENT"),
        ],
      },
    ]);

    renderWithProviders(<AttendanceToday />);

    // 3 of 5 attending — two present plus the half day. The separator is
    // spaced now ("30 / 35", as the client's sketch writes it), so the
    // denominator is matched on its own rather than as "/5".
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText(/\/\s*5/)).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  /** The breakdown keeps the statuses the headline figure collapses. */
  it("breaks out sick and absent rather than folding them into one number", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups?",
        body: { items: [GROUP], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
      {
        path: `/groups/${GROUP.id}/attendance`,
        body: [row(1, "PRESENT"), row(2, "SICK"), row(3, "ABSENT"), row(4, "EXCUSED")],
      },
    ]);

    renderWithProviders(<AttendanceToday />);

    expect(await screen.findByText("Өвчтэй")).toBeInTheDocument();
    expect(screen.getByText("Тасалсан")).toBeInTheDocument();
    expect(screen.getByText("Чөлөөтэй")).toBeInTheDocument();
  });

  /**
   * ★★ An unmarked register is not 0% attendance.
   *
   * Every row comes back with `record: null` until somebody marks it, so at 8am
   * a naive present/total renders "0/35" — a figure whose real meaning is "the
   * register is not filled in yet". It gets its own words and its own call to
   * action instead.
   */
  it("says the register is unmarked rather than reporting zero", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups?",
        body: { items: [GROUP], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
      {
        path: `/groups/${GROUP.id}/attendance`,
        body: [row(1, null), row(2, null), row(3, null)],
      },
    ]);

    renderWithProviders(<AttendanceToday />);

    expect(await screen.findByText("Бүртгээгүй байна")).toBeInTheDocument();
    expect(screen.getByText("3 хүүхэд бүртгэхийг хүлээж байна")).toBeInTheDocument();
    /*
      The point of the case, and the part that has not moved: an unmarked
      register reports its own state and never "0%", which would be a claim
      that nobody came.
    */
    expect(screen.queryByText("0%")).toBeNull();
  });

  /** An empty roster has nobody to be absent, so it is not 0% either. */
  it("distinguishes an empty group from a fully absent one", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups?",
        body: { items: [GROUP], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
      { path: `/groups/${GROUP.id}/attendance`, body: [] },
    ]);

    renderWithProviders(<AttendanceToday />);

    expect(await screen.findByText("Бүлэгт хүүхэд бүртгэлгүй")).toBeInTheDocument();
  });

  /**
   * ★★★ One teacher, one group — so the tile resolves the group itself and
   * never asks. This pins the absence of a switcher: exactly one attendance
   * request goes out, for the teacher's own group.
   */
  it("reads its own group without offering a choice", async () => {
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups?",
        body: { items: [GROUP], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
      { path: `/groups/${GROUP.id}/attendance`, body: [row(1, "PRESENT")] },
    ]);

    renderWithProviders(<AttendanceToday />);
    await screen.findByText("1");

    const sheets = calls.filter((c) => c.url.includes("/attendance"));
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.url).toContain(`date=${TODAY}`);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("хоолны цэс", () => {
  /**
   * ★ RFP Module 2's cross-check, finally on a screen.
   *
   * `GET /kindergartens/:id/menu/with-warnings` has computed this since
   * 2026-08-25 and nothing in the product called it — the menu was reachable
   * only from inside a child's page, without warnings.
   */
  it("names the child, the dish and the severity", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/menu/with-warnings",
        body: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            date: TODAY,
            dishes: [
              { name: "Сүүтэй будаа", allergenTags: ["сүү"] },
              { name: "Талх", allergenTags: [] },
            ],
            warnings: [
              {
                childId: "55555555-5555-4555-8555-000000000001",
                childName: "Тест Болд",
                dishName: "Сүүтэй будаа",
                allergenTag: "сүү",
                allergen: "сүү",
                severity: "SEVERE",
              },
            ],
          },
        ],
      },
    ]);

    renderWithProviders(<TodayMenu />);

    expect(await screen.findByText("Сүүтэй будаа")).toBeInTheDocument();
    expect(screen.getByText("Талх")).toBeInTheDocument();
    expect(screen.getByText(/Харшлын анхааруулга/)).toBeInTheDocument();
    expect(screen.getByText("Тест Болд")).toBeInTheDocument();
    expect(screen.getByText(/Ноцтой/)).toBeInTheDocument();
  });

  /**
   * ★★ Not `role="alert"`.
   *
   * The list is present on every load for as long as the menu holds a trigger,
   * so announcing it as an alert would interrupt a screen-reader user on every
   * visit to the dashboard. Findable, not shouted.
   */
  it("does not announce the warnings as an alert", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/menu/with-warnings",
        body: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            date: TODAY,
            dishes: [{ name: "Сүүтэй будаа", allergenTags: ["сүү"] }],
            warnings: [
              {
                childId: "55555555-5555-4555-8555-000000000001",
                childName: "Тест Болд",
                dishName: "Сүүтэй будаа",
                allergenTag: "сүү",
                allergen: "сүү",
                severity: "MILD",
              },
            ],
          },
        ],
      },
    ]);

    renderWithProviders(<TodayMenu />);
    await screen.findByText(/Харшлын анхааруулга/);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  /** Empty says who fills it in, not just that it is empty. */
  it("says what to do when no menu has been filed", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/menu/with-warnings",
        body: [],
      },
    ]);

    renderWithProviders(<TodayMenu />);

    expect(await screen.findByText("Өнөөдрийн цэс оруулаагүй")).toBeInTheDocument();
    expect(screen.getByText(/долоо хоногийн цэсийг бөглөнө/)).toBeInTheDocument();
  });

  /** A menu with no matching allergy shows the food and no alarm. */
  it("shows no warning block when nothing on the menu is a trigger", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/menu/with-warnings",
        body: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            date: TODAY,
            dishes: [{ name: "Ногооны шөл", allergenTags: [] }],
            warnings: [],
          },
        ],
      },
    ]);

    renderWithProviders(<TodayMenu />);

    expect(await screen.findByText("Ногооны шөл")).toBeInTheDocument();
    expect(screen.queryByText(/Харшлын анхааруулга/)).toBeNull();
  });
});

/**
 * The tiles in the dashboard's top row share one shell and therefore one
 * height. These pin the two caps that keep it that way — both were added in the
 * visual pass, and both are the kind of thing a later "just show them all"
 * change would undo without any test noticing.
 */
describe("хураангуй хайрцгууд", () => {
  const manyBirthdays = Array.from({ length: 7 }, (_, i) => ({
    id: `99999999-9999-4999-8999-${String(i).padStart(12, "0")}`,
    lastName: "Тест",
    firstName: `Хүүхэд ${i}`,
    dateOfBirth: `2021-08-0${(i % 9) + 1}`,
    photoMediaFileId: null,
  }));

  it("shows three birthdays and counts the rest rather than growing", () => {
    render(<MonthBirthdays birthdays={manyBirthdays} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    // The full count is still reported, so nothing is hidden — only folded.
    expect(screen.getByText(/7/)).toBeInTheDocument();
    expect(screen.getByText(/\+4 нэр/)).toBeInTheDocument();
  });

  it("caps the observation types at four and says how many were folded", () => {
    const types = Array.from({ length: 6 }, (_, i) => ({
      type: { id: `t${i}`, name: `Төрөл ${i}` },
      count: i + 1,
    }));

    render(<ObservationMix observationsByType={types} term="I улирал" />);

    // `img`, not `progressbar` — see the note in radar.test.tsx: a share of a
    // total is not progress toward a target, and this component's own text is
    // careful to say so.
    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.getByText(/\+2 төрөл/)).toBeInTheDocument();
    // 1+2+3+4+5+6 — the total counts every type, not just the shown ones.
    expect(screen.getByText(/нийт 21 ажиглалт/i)).toBeInTheDocument();
  });

  /**
   * ★ An unmarked register offers a button; a marked one offers a link.
   *
   * Marking the register is the task this tile exists to prompt, and before
   * 9am it is the most useful control on the screen. Afterwards the same
   * destination is reference, not a task.
   */
  /**
   * ★ Reversed twice in two days, and the second reversal is the client's.
   *
   * The card carried a filled "Ирц бүртгэх" button. The 2026-08-28 redesign
   * took it off — six white cards with no actions on them — and this test was
   * rewritten to assert the absence, with the route kept reachable from the
   * sidebar's "Бүлгийн бүртгэл".
   *
   * On 2026-08-29 the client asked for it back, and the state that makes the
   * case is the one asserted here: the card reads "Бүртгээгүй байна · N хүүхэд
   * бүртгэхийг хүлээж байна", which names a task and then offered no way to do
   * it. The sidebar entry stays; a menu three sections down is not the same as
   * a button on the sentence that asks for the work.
   */
  it("offers the register while nothing has been marked", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups?",
        body: { items: [GROUP], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
      { path: `/groups/${GROUP.id}/attendance`, body: [row(1, null), row(2, null)] },
    ]);

    renderWithProviders(<AttendanceToday />);

    await screen.findByText("Бүртгээгүй байна");
    expect(screen.getByRole("link", { name: /Ирц бүртгэх/ })).toHaveAttribute(
      "href",
      `/groups/${GROUP.id}/attendance`,
    );
  });
});

/**
 * The visual pass — what the drawings and the charts have to keep saying.
 *
 * ★ These assert on **rendered consequences**, never on a class string, with
 * one narrow exception noted at the point it is used. jsdom has no layout
 * engine, so a test of pixel geometry here would pass while asserting nothing
 * (`responsive.test.tsx` opens with the same warning). What is checkable is
 * that a chart exists, that it is named, that an illustration is hidden from
 * the accessibility tree rather than announced, and that a redraw did not
 * quietly turn a share into a completion score.
 *
 * The pass that *can* see geometry ran in a real browser, separately, at
 * 1440 / 1280 / 1024 / 820 / 390.
 */
describe("дүрслэл", () => {
  const ROSTER = { total: 32, averageAgeMonths: 41, boys: 14, girls: 18 };

  /**
   * ★ The sex split is a `Donut` now and was a split bar. The one thing that
   * must not have changed is what a screen reader is told — the drawing moved,
   * the meaning did not — so this pins the sentence *and* the fact that the
   * chart is a single named image rather than two silent arcs.
   */
  /**
   * ★ The donut went on 2026-08-28 and the accessible name stayed.
   *
   * The chart was replaced by two plain counts at the client's request — the
   * question their dashboard asks is "how many girls, how many boys", which is
   * two numbers rather than a ratio. What must not change is how the pair is
   * announced: "14 хүү, 18 охин", one name for the whole fact, not four
   * disconnected strings. `gender-ratio.tsx` has argued that through three
   * different drawings now.
   */
  it("announces the split as one named fact, whatever it is drawn as", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/children/summary", body: ROSTER },
    ]);

    renderWithProviders(<GenderRatio />);

    const pair = await screen.findByRole("img", { name: "14 хүү, 18 охин" });
    // Both counts are inside the named element, so the name and the visible
    // figures cannot drift apart.
    expect(pair.textContent).toContain("14");
    expect(pair.textContent).toContain("18");
    // One name for the whole fact, not one per side.
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  /**
   * ★★ The register's identity is an illustration, and it is silent.
   *
   * `icon-attendance.webp` is the same drawing the parent's home page uses for
   * this feature. It repeats the label beside it, so announcing it would make
   * a screen reader say "attendance" twice — `IconChip` hides it, and this is
   * what catches a future `alt="Ирц"` that looks helpful and is not.
   */
  /**
   * ★ Rewritten 2026-08-28. This asserted `icon-attendance.png` in the card,
   * and the client's redesign removed every illustration from this screen —
   * six plain white cards, with the only colour in the data.
   *
   * The half of it that still matters is the half about the ring: it restates
   * a figure already on the card as text, so it must stay decoration. A
   * `role="img"` here would make a screen reader read the percentage twice.
   */
  it("keeps the ring decorative, since the figure is already on the card", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups?",
        body: { items: [GROUP], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
      { path: `/groups/${GROUP.id}/attendance`, body: [row(1, "PRESENT"), row(2, "ABSENT")] },
    ]);

    const { container } = renderWithProviders(<AttendanceToday />);
    await screen.findByText("50%");

    // No illustration on this card any more — see the note above.
    expect(container.querySelector('img[src*="icon-attendance"]')).toBeNull();
    // Nothing on this card may be exposed as an image.
    expect(screen.queryByRole("img")).toBeNull();
  });

  /**
   * ★★★ Exactly one `progressbar` on the assessment card, and it reports the
   * ratio in words.
   *
   * The ring replaced a horizontal rule, and `Ring` is `aria-hidden` unless it
   * is given a name — so a careless redraw would have dropped the only
   * machine-readable statement of "4 of 10" on the screen. The role moved onto
   * the group that holds the ring and the counts instead.
   */
  it("keeps the assessment ratio machine-readable after the redraw", () => {
    render(<TermProgress term="I улирал" progress={{ assessed: 4, total: 10 }} />);

    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveAttribute("aria-valuenow", "40");
    expect(bars[0]).toHaveAttribute("aria-valuetext", "10 хүүхдээс 4 үнэлэгдсэн");
  });

  /**
   * ★★★★ Completed and pending, and no third state.
   *
   * "Partial" would need a per-domain count of a half-filled assessment, and
   * neither the endpoint nor `Assessment` carries one. The pending figure is
   * `total - assessed` — arithmetic on what the server sent, not a target.
   */
  it("splits the assessment into done and waiting, and invents no target", () => {
    render(<TermProgress term="I улирал" progress={{ assessed: 4, total: 10 }} />);

    expect(screen.getByText("Дууссан").parentElement!.textContent).toContain("4");
    expect(screen.getByText("Хүлээгдэж буй").parentElement!.textContent).toContain("6");
    expect(screen.queryByText(/зорилт|биелэлт/i)).toBeNull();
  });

  /** A term with nobody on the roster is 0%, not a division by zero. */
  it("does not print NaN for an empty roster", () => {
    render(<TermProgress term="I улирал" progress={{ assessed: 0, total: 0 }} />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  /**
   * ★ Three dishes stay on one row at desktop widths — the one thing the
   * client's sketch is explicit about.
   *
   * This is the exception to "no class assertions": the layout *is* the
   * requirement here, jsdom cannot measure it, and the grid template is what
   * decides it. A three-column track at `lg` with a two-column step below is
   * the whole statement. The browser pass confirmed it renders that way at
   * 1440, 1280 and 1024.
   */
  it("keeps the dishes three across at desktop widths", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/menu/with-warnings",
        body: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            date: TODAY,
            dishes: [
              { name: "Ногооны шөл", allergenTags: [] },
              { name: "Сүүтэй будаа", allergenTags: ["сүү"] },
              { name: "Талх", allergenTags: [] },
            ],
            warnings: [],
          },
        ],
      },
    ]);

    renderWithProviders(<TodayMenu />);
    await screen.findByText("Ногооны шөл");

    const dishes = screen.getAllByRole("listitem");
    expect(dishes).toHaveLength(3);

    const grid = dishes[0]!.parentElement!;
    expect(grid.className).toContain("lg:grid-cols-3");
    expect(grid.className).toContain("sm:grid-cols-2");
  });

  /**
   * ★★ A dish somebody reacts to says so on the card, in a word.
   *
   * The allergen tag alone put the only signal at the bottom of the card,
   * where a teacher scanning three dishes reads it after deciding the card is
   * fine. Colour is never the carrier — "Харшил" is, and the warning list
   * below still names who.
   */
  it("labels a risky dish rather than only tinting it", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/menu/with-warnings",
        body: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            date: TODAY,
            dishes: [
              { name: "Сүүтэй будаа", allergenTags: ["сүү"] },
              { name: "Талх", allergenTags: [] },
            ],
            warnings: [
              {
                childId: "55555555-5555-4555-8555-000000000001",
                childName: "Тест Болд",
                dishName: "Сүүтэй будаа",
                allergenTag: "сүү",
                allergen: "сүү",
                severity: "SEVERE",
              },
            ],
          },
        ],
      },
    ]);

    renderWithProviders(<TodayMenu />);

    // One badge, on the one dish that has a warning against it.
    expect(await screen.findByText("Харшил")).toBeInTheDocument();
    expect(screen.getAllByText("Харшил")).toHaveLength(1);
  });

  /**
   * ★★★ The menu's empty state stays horizontal and stays illustrated.
   *
   * This section is full width, and a centred 96px mascot over two centred
   * lines turned the most prominent card on the dashboard into a 280px void.
   * The drawing survives; what it must not do is become the tallest thing on
   * the screen for saying that nothing was filed.
   */
  it("keeps the empty menu compact and illustrated", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/menu/with-warnings",
        body: [],
      },
    ]);

    const { container } = renderWithProviders(<TodayMenu />);
    await screen.findByText("Өнөөдрийн цэс оруулаагүй");

    const mascot = container.querySelector('img[src*="mascot"]');
    expect(mascot).not.toBeNull();
    // 72px, not the product's 96px page-level mascot.
    expect(mascot!.getAttribute("width")).toBe("72");
    expect(mascot!.getAttribute("alt")).toBe("");
  });

  /**
   * ★ The birthday tile is one of exactly two tinted cards on the screen, and
   * each child keeps their own surface on that tint.
   *
   * A row that only changed colour on hover had no shape at rest — three names
   * floating on amber. This checks the consequence a reader would notice: each
   * birthday is a link carrying its own date.
   */
  it("gives each birthday its own row with a date", () => {
    render(
      <MonthBirthdays
        birthdays={[
          {
            id: "44444444-4444-4444-8444-444444444444",
            lastName: "Ганболд",
            firstName: "Мишээл",
            dateOfBirth: "2021-08-01",
            photoMediaFileId: null,
          },
        ]}
      />,
    );

    const link = screen.getByRole("link", { name: /Мишээл/ });
    // `/general`, not the bare id. The child hub page was deleted when it
    // was split into general/observations/attendance, so `/children/:id` is
    // no longer a route and 404s — `month-birthdays.tsx` carries the same
    // note against the link this asserts on. The expectation was stale, not
    // the component.
    expect(link).toHaveAttribute("href", "/children/44444444-4444-4444-8444-444444444444/general");
    expect(link.textContent).toContain("8/01");
  });
});

/**
 * The launcher grid — the parent home's tiles, on the teacher's screen.
 *
 * ★ What is worth testing here is not that six links render. It is that the
 * two group-scoped ones never render a link to a group that was not resolved:
 * `/groups/undefined/attendance` is a 404 the reader would read as the product
 * being broken, and it is exactly what a static href would have produced.
 */
/*
 * ★ The "түргэн холбоос" suite was deleted on 2026-08-29 with the component.
 *
 * `QuickLinks` was the teacher dashboard's launcher grid. The client's redesign
 * removed it from that screen and nothing else rendered it, so the component
 * went too — its four cases here tested that its Ирц and Хоол tiles pointed at
 * the signed-in teacher's own group, and that a teacher with no group got
 * neither.
 *
 * **That guarantee did not go with them.** The same two destinations are now in
 * the sidebar's "Бүлгийн бүртгэл" section, scoped from the same `useMyGroup()`
 * and omitted the same way when there is no single group to name — see
 * `app/(app)/layout.tsx`. `sidebar.test.tsx` is where it belongs now.
 */
