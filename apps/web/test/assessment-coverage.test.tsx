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
import { CoverageOverview } from "@/components/assessment/coverage-overview";

/**
 * Явцын үнэлгээ — the 2026-09-10 overview.
 *
 * ★ The question is "what is left", and every assertion is about that.
 *
 * Until this screen the only way to answer it was to pick a domain and count
 * the blanks down a column, once per domain. What makes the answer trustworthy
 * is that the four breakdowns and the headline count the same thing the same
 * way — children, against the same roster — so a reader can check one against
 * another.
 *
 * ★★ Nothing here reports a level for a child, and that is deliberate rather
 * than incidental: the assessment scope excludes a children × domains matrix,
 * which is why the column editor requires a `domainId` at all.
 */

const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const TERM_ID = "55555555-5555-4555-8555-555555555555";

const COVERAGE = {
  group: { id: GROUP_ID, name: "Дэлбээ бүлэг" },
  term: { id: TERM_ID, number: 1, name: "I улирал" },
  roster: 9,
  assessedChildren: 5,
  totalEntries: 12,
  totalNotes: 20,
  domains: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Нийгэмшихүй, сэтгэл хөдлөл",
      color: "#ec4899",
      assessed: 9,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Хэл яриа, харилцаа",
      color: "#3b82f6",
      assessed: 5,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Танин мэдэхүй",
      color: "#8b5cf6",
      assessed: 0,
    },
  ],
  types: [
    { id: "66666666-6666-4666-8666-666666666666", name: "Ажиглалт", code: "daily", assessed: 7 },
    {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Ярилцлага",
      code: "conversation",
      assessed: 0,
    },
  ],
  activities: [
    { name: "Өглөөний дасгал", assessed: 5 },
    { name: "Тоглоомын цаг", assessed: 2 },
  ],
  months: [
    { month: "2026-09", assessed: 6 },
    { month: "2026-10", assessed: 1 },
  ],
};

function stubCoverage(body: unknown = COVERAGE) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/groups/${GROUP_ID}/assessments/coverage`, body },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ groupId: GROUP_ID });
  setSearchParams("");
});

const render = () => renderWithProviders(<CoverageOverview groupId={GROUP_ID} termId={TERM_ID} />);

describe("the assessment coverage headline", () => {
  /**
   * ★ A count, with the share beside it — not "бүрэн хийгдсэн".
   *
   * `register-progress.tsx` records the reason: a state cannot be compared
   * with the children in front of you, and a number can.
   */
  it("leads with how many children are assessed, out of how many", async () => {
    stubCoverage();
    render();

    // Scoped to the headline card: "5" also appears in the breakdown's bars
    // and on the Үнэлгээтэй tile, which is the point — they agree.
    const headline = (await screen.findByText("Хүүхэд бүрийн үнэлгээний хамралт")).closest(
      '[data-ui="card"]',
    ) as HTMLElement;
    expect(within(headline).getByText("5")).toBeInTheDocument();
    expect(within(headline).getByText("/ 9")).toBeInTheDocument();
    expect(screen.getByText("4 хүүхдийн үнэлгээ үлдсэн байна.")).toBeInTheDocument();
  });

  it("names the ring, which is the only thing carrying the percentage", async () => {
    stubCoverage();
    render();

    expect(
      await screen.findByRole("img", { name: "9 хүүхдээс 5 нь үнэлгээтэй" }),
    ).toBeInTheDocument();
  });

  /**
   * ★ "Нийт үзүүлэлт" is rows, "Үнэлгээтэй" is children, and they differ.
   *
   * A child assessed in four domains is four entries and one child. Both are
   * on the strip, labelled, so neither can be read as the other disagreeing
   * with itself.
   */
  it("reports entries and children as two different figures", async () => {
    stubCoverage();
    render();

    const summary = (await screen.findByText("Үндсэн тойм")).closest("section")!;
    expect(within(summary).getByText("Нийт үзүүлэлт")).toBeInTheDocument();
    expect(within(summary).getByText("12")).toBeInTheDocument();
    expect(within(summary).getByText("Үлдсэн")).toBeInTheDocument();
    expect(within(summary).getByText("4")).toBeInTheDocument();
  });

  /** The hint is about this group's actual state, so a finished one gets none. */
  it("drops the reminder once nothing is left", async () => {
    stubCoverage({ ...COVERAGE, assessedChildren: 9 });
    render();

    expect(
      await screen.findByText("I улирал-ын үнэлгээ бүрэн хийгдсэн байна."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/багтаан хийж дуусгаарай/)).not.toBeInTheDocument();
  });

  it("does not divide by zero for a group with no children", async () => {
    stubCoverage({ ...COVERAGE, roster: 0, assessedChildren: 0, totalEntries: 0 });
    render();

    expect(await screen.findByText("Бүлэгт идэвхтэй хүүхэд алга.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Хамралт тодорхойгүй" })).toBeInTheDocument();
  });
});

describe("the four breakdowns", () => {
  it("opens on the development domains", async () => {
    stubCoverage();
    render();

    expect(await screen.findByText("Нийгэмшихүй, сэтгэл хөдлөл")).toBeInTheDocument();
    expect(screen.getByText("Танин мэдэхүй")).toBeInTheDocument();
  });

  /**
   * ★ Every domain, including the ones with nothing.
   *
   * A zero row is the most useful line on this screen — it is the work that
   * has not been started — and it also says so in words rather than leaving a
   * teacher to count blank bars by eye.
   */
  it("keeps the untouched rows and counts them", async () => {
    stubCoverage();
    render();

    await screen.findByText("Танин мэдэхүй");
    expect(screen.getByText("0 / 9", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Хараахан эхлээгүй 1 мөр байна.")).toBeInTheDocument();
  });

  it("switches to the other three without leaving the headline", async () => {
    const user = userEvent.setup();
    stubCoverage();
    render();

    await user.click(await screen.findByRole("button", { name: "Үйл ажиллагаа" }));
    expect(screen.getByText("Өглөөний дасгал")).toBeInTheDocument();
    // The headline is still on screen — that is the point of chips over routes.
    expect(screen.getByText("Хүүхэд бүрийн үнэлгээний хамралт")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Сар" }));
    expect(screen.getByText("2026 оны 9-р сар")).toBeInTheDocument();
  });

  /**
   * ★ Every bar's denominator is the roster, months included.
   *
   * Counting rows instead would let one child with six notes read as coverage
   * of six, which is the reading that makes a thin month look finished.
   */
  it("measures every breakdown against the same roster", async () => {
    const user = userEvent.setup();
    stubCoverage();
    render();

    await user.click(await screen.findByRole("button", { name: "Сар" }));
    expect(screen.getByText("6 / 9", { exact: false })).toBeInTheDocument();
  });

  it("says so when no activity has been named", async () => {
    const user = userEvent.setup();
    stubCoverage({ ...COVERAGE, activities: [] });
    render();

    await user.click(await screen.findByRole("button", { name: "Үйл ажиллагаа" }));
    expect(
      screen.getByText("Үйл ажиллагааны нэр бүхий тэмдэглэл хараахан алга."),
    ).toBeInTheDocument();
  });
});

/**
 * ★ The client asked for the three blue "Үнэлгээ нэмэх" buttons to be left off
 * ("зурагны доор байгаа үнэлгээ нэмэх гэсэн 3 цэнхэр товч тэд оррохгүй").
 *
 * Asserted as an absence because adding one back would look like an
 * improvement in review and would be the one thing they said not to do.
 */
describe("what the client asked to leave off", () => {
  it("has no add-assessment button", async () => {
    stubCoverage();
    render();

    await screen.findByText("Үндсэн тойм");
    expect(screen.queryByRole("button", { name: /Үнэлгээ нэмэх/ })).not.toBeInTheDocument();
  });
});
