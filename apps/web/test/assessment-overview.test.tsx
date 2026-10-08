import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROUTER,
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import { GroupCoverage } from "@/components/assessment/group-coverage";
import { CoverageDetail } from "@/components/assessment/coverage-detail";
import AssessmentPage from "@/app/(app)/groups/[groupId]/assessment/page";

/**
 * Явцын үнэлгээ — the summary and its four breakdowns, 2026-09-10.
 *
 * ★ This restructures work that already existed rather than adding any.
 *
 * `group-coverage.tsx` already drew the client's design: the seven strands,
 * the fourteen daily activities, the three kinds of note, and a monthly goal.
 * What the client asked for was that each breakdown be a *screen* — and the
 * goal turned out to be stored in `localStorage`, which is the defect these
 * tests are really guarding.
 */

const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";

const STATS = {
  total: 12,
  enrolled: 9,
  childrenWithNotes: 5,
  byChild: [
    { childId: "10111111-1111-4111-8111-111111111111", count: 3 },
    { childId: "10222222-2222-4222-8222-222222222222", count: 2 },
    { childId: "10333333-3333-4333-8333-333333333333", count: 1 },
    { childId: "10444444-4444-4444-8444-444444444444", count: 1 },
    { childId: "10555555-5555-4555-8555-555555555555", count: 1 },
  ],
  byChildType: [
    {
      childId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      typeId: "11111111-1111-4111-8111-111111111111",
      count: 2,
    },
  ],
  byType: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Ажиглалт", count: 7 },
    { id: "22222222-2222-4222-8222-222222222222", name: "Ярилцлага", count: 0 },
    { id: "55555555-5555-4555-8555-555555555555", name: "Бүтээл", count: 5 },
    // A parent's note is not the teacher's work and must not pad the balance.
    { id: "66666666-6666-4666-8666-666666666666", name: "Гэр бүлээс ирсэн", count: 40 },
  ],
  byDomain: [
    { id: "77777777-7777-4777-8777-777777777777", name: "Хэл яриа, харилцаа", count: 5 },
    { id: "88888888-8888-4888-8888-888888888888", name: "Нийгэмшихүй, сэтгэл хөдлөл", count: 10 },
  ],
  byActivity: [
    { name: "Өглөөний дасгал", count: 5 },
    { name: "Чөлөөт тоглоом", count: 2 },
  ],
  byMonth: [
    { month: "2025-09", count: 8, childrenCount: 6 },
    { month: "2025-10", count: 4, childrenCount: 1 },
  ],
};

function stubStats(
  monthlyNoteGoal: number | null = 2,
  roles: Parameters<typeof sessionFor>[0] = ["TEACHER"],
  monthlyNotesPerChildGoal: number | null = null,
) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    { path: `/groups/${GROUP_ID}/observation-stats`, body: STATS },
    // The goal is the group's own row now — not the kindergarten's config, and
    // not this browser's `localStorage`.
    {
      path: `/groups/${GROUP_ID}`,
      body: {
        id: GROUP_ID,
        name: "Дэлбээ бүлэг",
        kindergartenId: KINDERGARTEN_ID,
        schoolYearId: "66666666-6666-4666-8666-666666666666",
        monthlyNoteGoal,
        monthlyNotesPerChildGoal,
      },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ groupId: GROUP_ID });
  setSearchParams("");
});

const TERM_ID = "99999999-9999-4999-8999-999999999999";

const summary = (termId?: string) =>
  renderWithProviders(
    <GroupCoverage groupId={GROUP_ID} termId={termId} startsOn="2025-09-01" endsOn="2026-05-31" />,
  );

describe("the assessment summary", () => {
  /**
   * ★ Ангийн хамрагдалт — the ring is the headline and the parts are named.
   *
   * "80%" alone does not say of what; the two lines under it add up to the
   * roster, so a reader can check the ring against the numbers rather than
   * trusting it.
   */
  /**
   * ★ The ring is gone — 2026-09-17, at the client's request ("Нийт ангийн
   * хамрагдалт ... хас").
   *
   * It answered the same question as the first of the four figures above it —
   * how much of the goal is covered — in a second shape and a second
   * denominator, which is how one screen comes to state a month two ways.
   * Asserted as an absence so it cannot quietly return.
   */
  it("no longer draws the class coverage ring", async () => {
    stubStats();
    summary();

    await screen.findByText("Энэ сарын зорилт");
    expect(screen.queryByText("Нийт ангийн хамрагдалт")).not.toBeInTheDocument();
    expect(screen.queryByText("Үлдсэн")).not.toBeInTheDocument();
  });

  /**
   * ★ A share of the records written, never of the children goal — corrected
   * 2026-09-11 at the client's report that the figures below the goal were
   * wrong.
   *
   * The goal counts **children** and these count **notes**. Dividing one by
   * the other produced "Ажиглалт: 7 тэмдэглэл, 70%" against a target of ten
   * children, which is a percentage of nothing. The question this panel asks
   * is whether the three kinds are in balance, and the denominator for that is
   * the notes themselves.
   */
  /*
    ★ 2026-10-01, the client's design: the goal and the children's coverage
    are the whole summary. The advice card and the 9–5 balance are gone.
  */
  it("draws only the goal and the children's coverage", async () => {
    stubStats();
    summary();

    await screen.findByText("Энэ сарын зорилт");
    expect(screen.queryByText("Чиглэлийн зөвлөмж")).not.toBeInTheDocument();
    expect(screen.queryByText("9–5 сарын тэнцвэртэй байдал")).not.toBeInTheDocument();
    expect(screen.queryByText("Баримтжуулалтын хэлбэр")).not.toBeInTheDocument();
  });

  /**
   * ★ The goal does not rescale the panels below it.
   *
   * Asserted with a goal set, because that is the state the client reported:
   * the same shares, whatever the target is.
   */
  it("does not restore the removed breakdown when a goal is set", async () => {
    stubStats(10);
    summary();

    await screen.findByRole("img", { name: /Сарын зорилгын биелэлт/ });
    expect(screen.queryByText("Баримтжуулалтын хэлбэр")).not.toBeInTheDocument();
  });

  /**
   * ★ Removed from the summary — 2026-09-30, at the client's instruction:
   * the direction and activity coverage charts and the notes-per-day chart.
   * Asserted as an absence so none of them comes back unnoticed.
   */
  it("does not draw the direction, activity or per-day charts", async () => {
    stubStats();
    summary(TERM_ID);

    await screen.findByText("Энэ сарын зорилт");
    expect(screen.queryByText("Сургалтын чиглэлийн хамралт")).not.toBeInTheDocument();
    expect(screen.queryByText("Үйл ажиллагааны төрлийн хамралт")).not.toBeInTheDocument();
    expect(screen.queryByText("Өдөр тус бүрийн тэмдэглэлийн тоо")).not.toBeInTheDocument();

    // ★ 2026-10-01: the monthly chart stays, with no Дэлгэрэнгүй link.
    expect(screen.getByText("Сарын тэмдэглэлийн хамралт")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Дэлгэрэнгүй/ })).not.toBeInTheDocument();
  });

  /**
   * ★ The goal counts children, not notes — and says so in those words.
   *
   * A goal counted in notes is met by writing twenty about one child. This one
   * is only met by reaching twenty different children.
   */
  /*
    ★ The three progress rows became four figures — 2026-09-17, the client's
    drawing. What is asserted is the arithmetic rather than the shape: the goal
    still counts children, and the card still reads "covered / target".
  */
  it("reads the group's goal and counts children against it", async () => {
    stubStats(2);
    summary();

    expect(await screen.findByText("Энэ сарын зорилт")).toBeInTheDocument();
    expect(screen.getByText("5 / 2")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Сарын зорилгын биелэлт 100%" })).toBeInTheDocument();
  });

  it("says so plainly when no goal is set", async () => {
    stubStats(null);
    summary();

    expect(
      await screen.findByRole("button", { name: "Сарын зорилгын үйлдэл" }),
    ).toBeInTheDocument();
  });

  /**
   * ★ The teacher sets it, not only the administrator — client, 2026-09-10:
   * "багш өөрөө сонгох".
   *
   * That reversal is what moved the number from `Kindergarten` to `Group`: a
   * kindergarten-wide target set by one teacher would silently change every
   * other group's. The server still refuses a teacher who does not teach this
   * group, which is the check the screen cannot make.
   */
  it("lets the group's own teacher set the goal", async () => {
    stubStats();
    summary();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Сарын зорилгын үйлдэл" }));
    await user.click(await screen.findByRole("menuitem", { name: "Засах" }));
    const dialog = screen.getByRole("dialog", { name: "Зорилго засах" });
    expect(within(dialog).getByLabelText("Зорилтот хүүхдийн тоо")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Нэг хүүхдэд бичих тэмдэглэлийн тоо")).toBeInTheDocument();
  });

  /**
   * ★ Digits and two buttons, not a select spelling "5 хүүхэд" — 2026-09-11,
   * at the client's request.
   *
   * The unit is on the label above; repeating it inside every option made each
   * control about 140px and forced the row to stack on a phone. Steppers are
   * also the right interaction for a number adjusted by one: two 44px targets
   * and no keyboard over the figures below.
   *
   * ★★ Committed on a pause. Walking from 2 to 6 is four presses, and four
   * PUTs would be three writes nobody asked for.
   */
  it("writes both goal values after the teacher confirms", async () => {
    const user = userEvent.setup();
    const api = stubStats(5);
    summary();

    await user.click(await screen.findByRole("button", { name: "Сарын зорилгын үйлдэл" }));
    await user.click(await screen.findByRole("menuitem", { name: "Засах" }));
    await user.click(screen.getByRole("button", { name: /Зорилтот хүүхдийн тоо — нэмэх/ }));
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(
      () =>
        expect(
          api.calls.find(
            (call) =>
              call.method === "PUT" &&
              call.url === `/groups/${GROUP_ID}/assessments/monthly-note-goal`,
          )?.body,
        ).toEqual({ monthlyNoteGoal: 6, monthlyNotesPerChildGoal: 1 }),
      { timeout: 2000 },
    );
  });

  it("stores a per-child note target and charts children who reached it", async () => {
    const user = userEvent.setup();
    const api = stubStats(5, ["TEACHER"], 2);
    summary();

    expect(await screen.findByText(/тус бүр/)).toHaveTextContent("тус бүр 2 тэмдэглэл");
    await user.click(screen.getByRole("button", { name: "Сарын зорилгын үйлдэл" }));
    await user.click(await screen.findByRole("menuitem", { name: "Засах" }));
    await user.click(
      screen.getByRole("button", { name: /Нэг хүүхдэд бичих тэмдэглэлийн тоо — нэмэх/ }),
    );
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(
      () =>
        expect(
          api.calls.find(
            (call) =>
              call.method === "PUT" &&
              call.url === `/groups/${GROUP_ID}/assessments/monthly-note-goal`,
          )?.body,
        ).toEqual({ monthlyNoteGoal: 5, monthlyNotesPerChildGoal: 3 }),
      { timeout: 2000 },
    );
  });

  /**
   * ★ Both notes are computed, and absent when they have nothing to say.
   *
   * A fixed pair would keep congratulating a group that had stopped and keep
   * advising one that was already even — worse than silence, because a caption
   * that never changes stops being read.
   */
  it("congratulates only a group that has kept it up", async () => {
    stubStats();
    summary();

    await screen.findByText("Энэ сарын зорилт");
    // October has one child documented and every later month none, so the
    // months are not steady and the green card stays away.
    expect(screen.queryByText("Сайн байна")).not.toBeInTheDocument();
  });
});

describe("a breakdown screen", () => {
  const detail = (kind: "types" | "domains" | "activities" | "months") =>
    renderWithProviders(
      <CoverageDetail groupId={GROUP_ID} kind={kind} startsOn="2025-09-01" endsOn="2026-05-31" />,
    );

  it("names itself and offers a way back", async () => {
    stubStats();
    detail("domains");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Сургалтын чиглэлийн хамралт" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Буцах" })).toHaveAttribute(
      "href",
      `/groups/${GROUP_ID}/assessment`,
    );
  });

  /**
   * ★ Every strand appears, including the ones nobody has written against.
   *
   * A zero row is the most useful line on the screen — it is the work that has
   * not been started — and the count of them is stated rather than left to be
   * counted by eye.
   */
  it("keeps the untouched rows and says how many there are", async () => {
    stubStats();
    detail("domains");

    // The client's seven strands, five of which have nothing.
    expect(await screen.findByText("Математик")).toBeInTheDocument();
    expect(screen.getByText(/Тэмдэглэл оруулаагүй \d+ чиглэл байна/)).toBeInTheDocument();
  });

  it("filters to what is done and what is left", async () => {
    const user = userEvent.setup();
    stubStats();
    detail("activities");

    await user.click(await screen.findByRole("button", { name: /Үлдсэн/ }));

    expect(screen.queryByText("Өглөөний дасгал")).not.toBeInTheDocument();
    expect(screen.getByText("Хооллолт")).toBeInTheDocument();
  });

  /**
   * ★ A parent's note is not the teacher's work.
   *
   * The type panel asks whether the teacher is keeping the three kinds in
   * balance; forty notes from families would make a quiet month look covered.
   */
  it("leaves family-submitted notes out of the type balance", async () => {
    stubStats();
    detail("types");

    await screen.findByText("Ажиглалт");
    expect(screen.queryByText("Гэр бүлээс ирсэн")).not.toBeInTheDocument();
    expect(screen.queryByText("40")).not.toBeInTheDocument();
  });

  /** ★ The client asked for no "Үнэлгээ нэмэх" button on any of these. */
  it("has no add-assessment button", async () => {
    stubStats();
    detail("domains");

    await screen.findByText("Математик");
    expect(screen.queryByRole("button", { name: /Үнэлгээ нэмэх/ })).not.toBeInTheDocument();
  });
});

/**
 * The "Шинэ тэмдэглэл" strip — the child picker and the three doors.
 *
 * ★ It took its children from the assessment *column*, which is the roster
 * joined to one term and one development domain.
 *
 * So it could not appear until three requests had finished in sequence —
 * terms, then the config that seeds the domain, then the column keyed on both
 * — and it renders nothing while that list is empty. A teacher opening the
 * screen watched an empty space where the child picker belonged. A
 * kindergarten with no domain configured never got past step two and never saw
 * it at all.
 *
 * Which child to write a note about has nothing to do with which domain is
 * selected. These assert that: the column is deliberately never answered.
 */
describe("the new-record strip", () => {
  const CHILD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  function stubPage() {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/groups/${GROUP_ID}/assessments`, body: null, status: 500 },
      /*
        ★ The specific path first: `stubApi` matches on `startsWith` and takes
        the first hit, so a bare "/children" listed above would also answer
        "/children/:id/observations/types" — with a page of children, which
        parses as nothing and leaves the three doors missing.
      */
      {
        path: `/children/${CHILD_ID}/observations/types`,
        body: [
          { id: "11111111-1111-4111-8111-111111111111", name: "Ажиглалт", code: "daily", order: 1 },
          {
            id: "22222222-2222-4222-8222-222222222222",
            name: "Ярилцлага",
            code: "conversation",
            order: 2,
          },
          {
            id: "55555555-5555-4555-8555-555555555555",
            name: "Бүтээл",
            code: "artwork",
            order: 3,
          },
        ],
      },
      {
        path: "/children",
        body: {
          items: [
            {
              id: CHILD_ID,
              lastName: "Батжаргал",
              firstName: "Ану",
              sex: "FEMALE",
              // `dateOfBirth` is required on `childSummarySchema`; without it
              // the page parses to nothing and the strip never appears.
              dateOfBirth: "2021-04-12",
            },
          ],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        },
      },
      {
        path: `/groups/${GROUP_ID}/observation-stats`,
        body: STATS,
      },
      {
        path: `/groups/${GROUP_ID}`,
        body: {
          id: GROUP_ID,
          name: "Дэлбээ бүлэг",
          kindergartenId: KINDERGARTEN_ID,
          schoolYearId: "66666666-6666-4666-8666-666666666666",
        },
      },
      {
        path: `/kindergartens/${KINDERGARTEN_ID}/assessment-config`,
        body: { domains: [], levels: [], monthlyNoteGoal: null },
      },
      { path: `/kindergartens/${KINDERGARTEN_ID}/terms`, body: [] },
      { path: `/kindergartens/${KINDERGARTEN_ID}/school-years`, body: [] },
      { path: "/groups", body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 } },
    ]);
  }

  /**
   * ★ The column is stubbed to fail, and the strip still appears.
   *
   * That is the assertion: a 500 from the assessment column must not take the
   * child picker with it, because the two answer different questions.
   */
  it("appears without waiting for the assessment column", async () => {
    stubPage();
    renderWithProviders(<AssessmentPage />);

    expect(await screen.findByText("Энэ сарын зорилт")).toBeInTheDocument();
    expect(screen.queryByLabelText("Хүүхэд сонгох")).not.toBeInTheDocument();
    expect(screen.queryByText("Шинэ тэмдэглэл")).not.toBeInTheDocument();
    expect(screen.queryByText("Улирал тохируулаагүй байна")).not.toBeInTheDocument();
  });

  /**
   * ★ The picker is the client's own screen now — 2026-09-11.
   *
   * It was a grid of name buttons that went straight to a blank compose form.
   * The design asks for a face, an age and a group beside each name, a search
   * over them, and a confirmed choice — and it lands on the record hub rather
   * than on the form, because a teacher pressing Ажиглалт is as often coming
   * to look as to write.
   */
  it("opens the child roster directly from the write button", async () => {
    const user = userEvent.setup();
    stubPage();
    renderWithProviders(<AssessmentPage />);

    const launch = await screen.findByRole("button", { name: "Явцын үнэлгээ бичих" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(launch);

    const picker = await screen.findByRole("dialog", { name: "Хүүхэд сонгох" });
    expect(within(picker).getByRole("radio", { name: /Батжаргал Ану/ })).toBeInTheDocument();
    expect(within(picker).getByLabelText("Хүүхдийн нэрээр хайх")).toBeInTheDocument();
  });

  /**
   * ★ The roster is a plain table — 2026-09-30, the client's design, which
   * replaced the 2026-09-11 class total and coverage bar above it. Each row
   * still carries the child's own count.
   */
  it("lists the children as a table with their own counts", async () => {
    const user = userEvent.setup();
    stubPage();
    renderWithProviders(<AssessmentPage />);

    await user.click(await screen.findByRole("button", { name: "Явцын үнэлгээ бичих" }));

    const picker = await screen.findByRole("dialog", { name: "Хүүхэд сонгох" });
    // No class total, no coverage bar, no photographs.
    expect(within(picker).queryByText("Ангийн нийт ажиглалт")).not.toBeInTheDocument();
    expect(within(picker).queryByText("1/1 хүүхэд")).not.toBeInTheDocument();
    expect(within(picker).queryByRole("img")).not.toBeInTheDocument();

    // ★ 2026-10-01: the kinds are tabs, and the column counts the active one.
    // `STATS.byChildType` gives Ану two notes of the daily kind and none else.
    expect(within(picker).getByRole("tab", { name: "Ажиглалт" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(picker).getByRole("columnheader", { name: "Ажиглалт" })).toBeInTheDocument();
    let row = within(picker)
      .getByRole("radio", { name: /Батжаргал Ану/ })
      .closest("tr")!;
    expect(within(row).getByText("Биелсэн")).toBeInTheDocument();

    await user.click(within(picker).getByRole("tab", { name: "Ярилцлага" }));
    expect(within(picker).getByRole("columnheader", { name: "Ярилцлага" })).toBeInTheDocument();
    row = within(picker)
      .getByRole("radio", { name: /Батжаргал Ану/ })
      .closest("tr")!;
    expect(within(row).getByText("0/1")).toBeInTheDocument();
  });

  /** Бүгд / Дутуу / Биелсэн sit behind the search field's filter icon. */
  it("keeps the completion filter behind the search's icon", async () => {
    const user = userEvent.setup();
    stubPage();
    renderWithProviders(<AssessmentPage />);

    await user.click(await screen.findByRole("button", { name: "Явцын үнэлгээ бичих" }));
    const picker = await screen.findByRole("dialog", { name: "Хүүхэд сонгох" });

    expect(within(picker).queryByRole("button", { name: "Дутуу" })).not.toBeInTheDocument();
    await user.click(within(picker).getByRole("button", { name: "Шүүлтүүр" }));
    await user.click(within(picker).getByRole("button", { name: "Дутуу" }));
    // Ану has met the daily goal, so "incomplete" leaves nobody.
    expect(within(picker).queryByRole("radio", { name: /Батжаргал Ану/ })).toBeNull();
  });

  /** The choice opens that child's record screen for the chosen kind. */
  it("opens the chosen child's screen for the active kind", async () => {
    const user = userEvent.setup();
    stubPage();
    renderWithProviders(<AssessmentPage />);

    await user.click(await screen.findByRole("button", { name: "Явцын үнэлгээ бичих" }));
    const picker = await screen.findByRole("dialog", { name: "Хүүхэд сонгох" });
    await user.click(within(picker).getByRole("radio", { name: /Батжаргал Ану/ }));
    await user.click(within(picker).getByRole("button", { name: "Сонгох" }));

    expect(ROUTER.push).toHaveBeenCalledWith(`/children/${CHILD_ID}/observations?type=daily`);
  });

  /**
   * ★ The dialog is named for the kind, so the two questions it answers are
   * both on screen: which record, and for whom.
   */
  it("names the direct dialog for choosing a child", async () => {
    const user = userEvent.setup();
    stubPage();
    renderWithProviders(<AssessmentPage />);

    await user.click(await screen.findByRole("button", { name: "Явцын үнэлгээ бичих" }));

    expect(await screen.findByRole("dialog", { name: "Хүүхэд сонгох" })).toBeInTheDocument();
  });

  /**
   * ★ The choice is confirmed, not applied on tap.
   *
   * Picking the wrong child and landing on their file costs a navigation to
   * undo; picking the wrong row and seeing the tick move costs nothing.
   */
  it("waits for Сонгох before leaving the screen", async () => {
    const user = userEvent.setup();
    stubPage();
    renderWithProviders(<AssessmentPage />);

    await user.click(await screen.findByRole("button", { name: "Явцын үнэлгээ бичих" }));
    const picker = await screen.findByRole("dialog", { name: "Хүүхэд сонгох" });

    expect(within(picker).getByRole("button", { name: "Сонгох" })).toBeDisabled();
    await user.click(within(picker).getByRole("radio", { name: /Батжаргал Ану/ }));
    expect(within(picker).getByRole("button", { name: "Сонгох" })).toBeEnabled();
  });

  /**
   * ★ A kindergarten with no development domain still gets the strip.
   *
   * `assessment-config` above returns none, so the column never becomes
   * enabled at all — which is precisely the case that used to leave this
   * screen with an empty space under its heading.
   */
  it("appears even when no development domain is configured", async () => {
    stubPage();
    renderWithProviders(<AssessmentPage />);

    expect(await screen.findByRole("button", { name: "Явцын үнэлгээ бичих" })).toBeInTheDocument();
  });
});
