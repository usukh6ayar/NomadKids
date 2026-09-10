import { screen, within } from "@testing-library/react";
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

function stubStats(monthlyNoteGoal: number | null = 2) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/groups/${GROUP_ID}/observation-stats`, body: STATS },
    {
      path: `/kindergartens/${KINDERGARTEN_ID}/assessment-config`,
      body: { domains: [], levels: [], monthlyNoteGoal },
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
    <GroupCoverage
      groupId={GROUP_ID}
      kindergartenId={KINDERGARTEN_ID}
      termId={termId}
      startsOn="2025-09-01"
      endsOn="2026-05-31"
    />,
  );

describe("the assessment summary", () => {
  it("leads with the four figures the design asks for", async () => {
    stubStats();
    summary();

    expect(await screen.findByText("Нийт хүүхэд")).toBeInTheDocument();
    expect(screen.getByText("Үнэлгээтэй")).toBeInTheDocument();
    expect(screen.getByText("Үлдсэн")).toBeInTheDocument();
    expect(screen.getByText("Нийт үзүүлэлт")).toBeInTheDocument();
    // 9 enrolled, 5 with notes, 4 left, 12 notes.
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  /**
   * ★ Four rows that navigate, not three panels side by side.
   *
   * On a phone the panels were most of a scroll before the register itself,
   * with the two a teacher was not reading costing as much height as the one
   * they were.
   */
  it("offers each breakdown as a screen of its own", async () => {
    stubStats();
    summary();

    const nav = await screen.findByRole("navigation", { name: "Дэлгэрэнгүй" });
    const links = within(nav).getAllByRole("link");

    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `/groups/${GROUP_ID}/assessment/types`,
      `/groups/${GROUP_ID}/assessment/domains`,
      `/groups/${GROUP_ID}/assessment/activities`,
      `/groups/${GROUP_ID}/assessment/months`,
    ]);
  });

  /**
   * ★ The term rides along, so Буцах returns to the one that was open.
   *
   * The breakdowns are taken over the school year, so `termId` changes nothing
   * about what they show — but it is what the register behind them is keyed
   * on, and dropping it would land a returning teacher on the default term
   * with their selection lost.
   */
  it("carries the open term into each breakdown", async () => {
    stubStats();
    summary(TERM_ID);

    const nav = await screen.findByRole("navigation", { name: "Дэлгэрэнгүй" });
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.getAttribute("href")).toContain(`?termId=${TERM_ID}`);
    }
  });

  /**
   * ★ The goal comes from the kindergarten, and this is the defect that
   * mattered.
   *
   * It was `localStorage`: the two teachers of one group could hold different
   * targets, a director saw neither, and clearing site data lost it. A shared
   * commitment stored per browser is not a shared commitment.
   */
  it("reads the goal from the kindergarten", async () => {
    stubStats(2);
    summary();

    expect(await screen.findByText("Зорилт")).toBeInTheDocument();
    // September has six children with notes against a target of two.
    expect(screen.getByText("6 / 2")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  /** A target nobody agreed to would be a bar failing against an invented number. */
  it("draws no goal card when the kindergarten has set none", async () => {
    stubStats(null);
    summary();

    await screen.findByText("Нийт хүүхэд");
    expect(screen.queryByText("Зорилт")).not.toBeInTheDocument();
  });

  /**
   * ★ The target is no longer typed on this screen.
   *
   * Deciding it is the director's; every member of staff reads it. It was
   * previously whatever each teacher had entered into their own browser.
   */
  it("does not let a teacher type a target here", async () => {
    stubStats();
    summary();

    await screen.findByText("Зорилт");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
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
