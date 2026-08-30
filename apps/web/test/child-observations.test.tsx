import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { ChildObservations } from "@/components/child/child-observations";

/**
 * Grouping a child's notes by quarter — the client's 2026-08-31 accordion.
 *
 * ★ Tested through the component, not by exporting the grouping function.
 *
 * The behaviour that can break is what a reader sees: which sections exist,
 * what each counts, and which one is already open. A unit test over
 * `groupByQuarter` would pass while the summary rendered the wrong number, and
 * exporting a helper only so a test can reach it makes the test the reason the
 * seam exists.
 */

const KINDERGARTEN = "33333333-3333-4333-8333-333333333333";
const CHILD = "66666666-6666-4666-8666-666666666666";

/** Two quarters with a gap between them, so "outside every term" is reachable. */
const TERMS = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    number: 1,
    name: "I улирал",
    startsOn: "2026-09-01",
    endsOn: "2026-12-31",
    schoolYear: null,
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    number: 2,
    name: "II улирал",
    startsOn: "2027-01-10",
    endsOn: "2027-05-31",
    schoolYear: null,
  },
];

/** Ids must be real UUIDs — `observationSchema` parses them, and a "1" fails. */
function observation(seq: number, observedOn: string) {
  return {
    id: `dddddddd-dddd-4ddd-8ddd-00000000000${seq}`,
    childId: CHILD,
    observedOn,
    source: "TEACHER",
    reviewStatus: "APPROVED",
    visibleToParents: true,
    activityName: "Тоглоом",
    situation: null,
    childDid: "Блокоор цамхаг барив.",
    childSaid: null,
    teacherComment: null,
    nextSteps: null,
    reviewNote: null,
    type: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Өдөр тутмын ажиглалт", code: null },
    author: null,
    media: [],
  };
}

function render(items: ReturnType<typeof observation>[], terms: unknown[] = TERMS) {
  stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: `/children/${CHILD}/observations`,
      // The full envelope: `paginated()` requires every field, and a partial
      // stub fails the schema and renders the error state instead of the list.
      body: { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 },
    },
    { path: `/kindergartens/${KINDERGARTEN}/terms`, body: terms },
  ]);

  return renderWithProviders(<ChildObservations childId={CHILD} isStaff />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Inside the first term, so "the current quarter opens" has a fixed answer.
  vi.setSystemTime(new Date("2026-10-15T09:00:00Z"));
});

describe("grouping by quarter", () => {
  it("files each note under the term whose dates contain it", async () => {
    render([
      observation(1, "2026-09-15"),
      observation(2, "2026-11-02"),
      observation(3, "2027-02-20"),
    ]);

    const first = await screen.findByText("I улирал");
    const second = await screen.findByText("II улирал");

    expect(within(first.closest("summary")!).getByText("2 тэмдэглэл")).toBeInTheDocument();
    expect(within(second.closest("summary")!).getByText("1 тэмдэглэл")).toBeInTheDocument();
  });

  /*
   * The counts have to sum to the list. A note in the holiday between two terms
   * belongs to no quarter, and dropping it would make the breakdown disagree
   * with the total it is a breakdown of.
   */
  it("keeps a note that falls outside every term", async () => {
    render([observation(1, "2026-09-15"), observation(2, "2027-01-05")]);

    const other = await screen.findByText("Бусад хугацаа");
    expect(within(other.closest("summary")!).getByText("1 тэмдэглэл")).toBeInTheDocument();
  });

  it("omits a quarter with no notes in it", async () => {
    render([observation(1, "2026-09-15")]);

    await screen.findByText("I улирал");
    expect(screen.queryByText("II улирал")).not.toBeInTheDocument();
  });

  it("opens the quarter containing today and leaves the others shut", async () => {
    render([observation(1, "2026-09-15"), observation(2, "2027-02-20")]);

    const current = (await screen.findByText("I улирал")).closest("details")!;
    const later = (await screen.findByText("II улирал")).closest("details")!;

    expect(current.open).toBe(true);
    expect(later.open).toBe(false);
  });

  /*
   * Out of term time nothing contains today. Every section shut is a screen
   * that looks empty, so the most recent quarter with notes stands in.
   */
  it("opens the most recent quarter when today is outside every term", async () => {
    vi.setSystemTime(new Date("2027-07-20T09:00:00Z"));
    render([observation(1, "2026-09-15"), observation(2, "2027-02-20")]);

    const later = (await screen.findByText("II улирал")).closest("details")!;
    expect(later.open).toBe(true);
  });

  /*
   * A kindergarten whose administrator has not created terms yet has no
   * quarters to group by, and one accordion holding everything is a control
   * that only ever does one thing.
   */
  it("falls back to a flat list when no terms are configured", async () => {
    render([observation(1, "2026-09-15")], []);

    expect(await screen.findByText(/Блокоор цамхаг барив/)).toBeInTheDocument();
    expect(screen.queryByText("I улирал")).not.toBeInTheDocument();
  });
});
