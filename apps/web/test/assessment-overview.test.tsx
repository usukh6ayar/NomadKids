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
import { GroupCoverage } from "@/components/assessment/group-coverage";
import { CoverageDetail } from "@/components/assessment/coverage-detail";
import AssessmentPage from "@/app/(app)/groups/[groupId]/assessment/page";

/**
 * Явцын үнэлгээ — the summary and its four breakdowns, 2026-09-10.
 *
 * ★ This restructures work that already existed rather than adding any.
 *
 * `group-coverage.tsx` already drew the client's design: the seven strands,
 * the thirteen daily activities, the three kinds of note, and a monthly goal.
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
    { name: "Тоглоомын цаг", count: 2 },
  ],
  byMonth: [
    { month: "2025-09", count: 8, childrenCount: 6 },
    { month: "2025-10", count: 4, childrenCount: 1 },
  ],
};

function stubStats(
  monthlyNoteGoal: number | null = 2,
  roles: Parameters<typeof sessionFor>[0] = ["TEACHER"],
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
  it("reports the class's coverage as a ring and its parts", async () => {
    stubStats();
    summary();

    expect(await screen.findByText("Ангийн хамрагдалт")).toBeInTheDocument();
    // 5 of 9 children have a note.
    expect(screen.getByRole("img", { name: "9 хүүхдээс 5 нь баримттай" })).toBeInTheDocument();
    expect(screen.getByText("Хамрагдсан")).toBeInTheDocument();
    expect(screen.getByText("Хараахан баримтгүй")).toBeInTheDocument();
  });

  /**
   * ★ The client's design has a third slice, "Шинэ хүүхэд".
   *
   * Nothing in the product distinguishes a newly enrolled child from any other
   * child with no note yet, and inventing the distinction would put a number
   * on screen that no query stands behind. Asserted as an absence so it cannot
   * arrive later as a plausible-looking guess.
   */
  it("does not invent a slice the data cannot support", async () => {
    stubStats();
    summary();

    await screen.findByText("Ангийн хамрагдалт");
    expect(screen.queryByText("Шинэ хүүхэд")).not.toBeInTheDocument();
  });

  /**
   * ★ Баримтжуулалтын хэлбэр as three figures, not three bars.
   *
   * Bars compare against a denominator; these are compared against each other,
   * and the question is whether one kind has been neglected.
   */
  it("counts the three kinds of record and their total", async () => {
    stubStats();
    summary();

    expect(await screen.findByText("Баримтжуулалтын хэлбэр")).toBeInTheDocument();
    // 7 + 0 + 5, with the family-submitted 40 excluded.
    expect(screen.getByText("Нийт 12 баримт")).toBeInTheDocument();
  });

  /**
   * ★ The bars *and* a way into their own screen.
   *
   * Rows that only navigated made a teacher press to find out whether it was
   * worth pressing. The shape is read here; the screen behind it is where they
   * filter and act.
   */
  it("shows each breakdown inline with a link into its screen", async () => {
    stubStats();
    summary(TERM_ID);

    expect(await screen.findByText("Сургалтын чиглэлийн хамралт")).toBeInTheDocument();
    expect(screen.getByText("Үйл ажиллагааны үеийн хамралт")).toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: "Дэлгэрэнгүй" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `/groups/${GROUP_ID}/assessment/types?termId=${TERM_ID}`,
      `/groups/${GROUP_ID}/assessment/domains?termId=${TERM_ID}`,
      `/groups/${GROUP_ID}/assessment/activities?termId=${TERM_ID}`,
      `/groups/${GROUP_ID}/assessment/months?termId=${TERM_ID}`,
    ]);
  });

  /**
   * ★ The goal counts children, not notes — and says so in those words.
   *
   * A goal counted in notes is met by writing twenty about one child. This one
   * is only met by reaching twenty different children.
   */
  it("reads the group's goal and counts children against it", async () => {
    stubStats(2);
    summary();

    expect(await screen.findByText("Энэ сарын зорилт")).toBeInTheDocument();
    expect(screen.getByText("хүүхдийн хөгжлийн явцыг баримтжуулах")).toBeInTheDocument();
    // Six children documented in September against a target of two.
    expect(screen.getByText("6 / 2")).toBeInTheDocument();
  });

  it("says so plainly when no goal is set", async () => {
    stubStats(null);
    summary();

    expect(await screen.findByText(/Сарын зорилт тохируулаагүй байна/)).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: "Зорилт тохируулах" })).toBeInTheDocument();
  });

  it("writes the goal to the group, not to the kindergarten", async () => {
    const user = userEvent.setup();
    const api = stubStats();
    summary();

    await user.click(await screen.findByRole("button", { name: "Зорилт тохируулах" }));
    const field = await screen.findByLabelText(/Сард хэдэн хүүхдийн/);
    await user.clear(field);
    await user.type(field, "12");
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(
        api.calls.find(
          (call) =>
            call.method === "PUT" &&
            call.url === `/groups/${GROUP_ID}/assessments/monthly-note-goal`,
        )?.body,
      ).toEqual({ monthlyNoteGoal: 12 }),
    );
  });

  /**
   * ★ The bars show whether each row reaches the month's figure — 2026-09-10,
   * at the client's request.
   *
   * Scaled to the target rather than to the busiest row: a full bar means the
   * target is met and a short one says how far off it is. The caption counts
   * how many reached it, so a teacher does not have to.
   */
  it("marks which rows have reached the month's figure", async () => {
    stubStats(10);
    summary();

    // Ten of fifteen domain notes are on one strand, so one row clears 10.
    expect(await screen.findByText("Зорилт 10 — 1 / 7 хүрсэн.")).toBeInTheDocument();
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

    await screen.findByText("Ангийн хамрагдалт");
    // October has one child documented and every later month none, so the
    // months are not steady and the green card stays away.
    expect(screen.queryByText("Сайн байна")).not.toBeInTheDocument();
  });

  it("names the strands that are running ahead", async () => {
    stubStats();
    summary();

    // Scoped to the advice card: the strand also names a bar above it, which
    // is the point — the sentence points at a row the reader can go and see.
    const advice = (await screen.findByText("Санал")).closest("p") as HTMLElement;
    // Ten of fifteen domain notes are on one strand.
    expect(within(advice).getByText(/Нийгэм-сэтгэл хөдлөл/)).toBeInTheDocument();
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
    expect(screen.getByText("Өдрийн хоол")).toBeInTheDocument();
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
      { path: `/groups/${GROUP_ID}/observation-stats`, body: STATS },
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

    expect(await screen.findByLabelText("Хүүхэд сонгох")).toBeInTheDocument();
    expect(screen.getByText("Шинэ тэмдэглэл")).toBeInTheDocument();
  });

  it("names the child and offers the three doors", async () => {
    stubPage();
    renderWithProviders(<AssessmentPage />);

    // The doors need a second request — the child's own note types — so the
    // first is awaited rather than read in the same tick as the picker.
    expect(await screen.findByRole("link", { name: /Ажиглалт/ })).toBeInTheDocument();
    for (const door of ["Ярилцлага", "Бүтээл"]) {
      expect(screen.getByRole("link", { name: new RegExp(door) })).toBeInTheDocument();
    }
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

    expect(await screen.findByLabelText("Хүүхэд сонгох")).toBeInTheDocument();
  });
});
