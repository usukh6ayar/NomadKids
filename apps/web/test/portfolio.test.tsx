import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import PortfolioPage from "@/app/(app)/children/[childId]/portfolio/page";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";

/**
 * The portfolio's age sections.
 *
 * ★ Two requirements pulling against each other, which is why both are pinned.
 *
 * RFP §4.3: "2, 3, 4, 5 нас тус бүрд тусдаа мэдээллийн хуудастай байна." All
 * four exist, always, for every child — a two-year-old's record still has a
 * "5 нас" page and a link to it still has to resolve.
 *
 * The audit finding: rendering all four *expanded* opened a newly registered
 * two-year-old's portfolio as nine empty boxes and nine "Засах" buttons.
 *
 * A test for either one alone permits the fix that breaks the other — dropping
 * the sections satisfies the declutter and violates the RFP; leaving them open
 * satisfies the RFP and changes nothing. So: the sections are present, and the
 * unreached ones are closed.
 */

/** Two years old today, whatever "today" is when the suite runs. */
function bornYearsAgo(years: number): string {
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - years);
  // A day back, so the birthday itself is never the boundary under test.
  dob.setDate(dob.getDate() - 1);
  return dob.toISOString().slice(0, 10);
}

function stubPortfolio(dateOfBirth: string, ageProfiles: unknown[] = []) {
  stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: `/children/${CHILD_ID}/about-me`,
      body: { exists: false },
    },
    { path: `/children/${CHILD_ID}/age-profiles`, body: ageProfiles },
    { path: `/children/${CHILD_ID}/birthday-notes`, body: [] },
    {
      path: `/children/${CHILD_ID}/media`,
      body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 },
    },
    {
      path: `/children/${CHILD_ID}`,
      body: {
        id: CHILD_ID,
        lastName: "Ганболд",
        firstName: "Батбаяр",
        sex: "MALE",
        dateOfBirth,
        status: "ACTIVE",
        photoMediaFileId: null,
        enrollments: [],
        guardianships: [],
        kindergarten: { id: "33333333-3333-4333-8333-333333333333", name: "Цэцэрлэг" },
        healthNotes: null,
      },
    },
  ]);
}

/** The `<details>` wrapping a given year, found through its heading. */
function ageDisclosure(age: number): HTMLDetailsElement {
  const heading = screen.getByRole("heading", { name: `${age} нас`, level: 2 });
  return heading.closest("details")!;
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ childId: CHILD_ID });
  setSearchParams("");
  window.location.hash = "";
});

describe("portfolio age sections", () => {
  it("renders a section for every age 2–5 whatever the child's age (RFP §4.3)", async () => {
    stubPortfolio(bornYearsAgo(2));

    renderWithProviders(<PortfolioPage />);

    await waitFor(() => expect(ageDisclosure(2)).toBeInTheDocument());
    for (const age of [2, 3, 4, 5]) {
      expect(ageDisclosure(age), `age ${age} must still have a section`).toBeInTheDocument();
      // The anchor the age row links to has to resolve for every year.
      expect(document.getElementById(`age-${age}`)).not.toBeNull();
    }
  });

  it("opens the years the child has lived and closes the rest", async () => {
    stubPortfolio(bornYearsAgo(3));

    renderWithProviders(<PortfolioPage />);

    await waitFor(() => expect(ageDisclosure(2)).toBeInTheDocument());

    expect(ageDisclosure(2).open, "2 нас is behind them").toBe(true);
    expect(ageDisclosure(3).open, "3 нас is the year they are in").toBe(true);
    expect(ageDisclosure(4).open, "4 нас has not happened").toBe(false);
    expect(ageDisclosure(5).open, "5 нас has not happened").toBe(false);
  });

  it("opens a future year that somebody has already written into", async () => {
    // Content outranks the date: a family filling "5 нас" in early meant it,
    // and collapsing writing that exists would hide real content.
    stubPortfolio(bornYearsAgo(2), [{ age: 5, favoriteColour: null, favoriteFood: "Бууз" }]);

    renderWithProviders(<PortfolioPage />);

    await waitFor(() => expect(ageDisclosure(5)).toBeInTheDocument());
    expect(ageDisclosure(5).open).toBe(true);
    expect(ageDisclosure(4).open).toBe(false);
  });

  it("does not offer an edit control for a year that is still closed", async () => {
    stubPortfolio(bornYearsAgo(2));

    renderWithProviders(<PortfolioPage />);
    await waitFor(() => expect(ageDisclosure(2)).toBeInTheDocument());

    // The nine "Засах" buttons were the substance of the finding. The control
    // still exists in the markup — `<details>` hides rather than unmounts — so
    // this asserts the thing that actually changed: it is not reachable
    // without opening the year first.
    const closed = ageDisclosure(5);
    expect(closed.open).toBe(false);
    expect(closed.querySelector("summary")).toHaveTextContent("Ирээдүйд");
  });

  it("opening a closed year reveals its edit control", async () => {
    const user = userEvent.setup();
    stubPortfolio(bornYearsAgo(2));

    renderWithProviders(<PortfolioPage />);
    await waitFor(() => expect(ageDisclosure(2)).toBeInTheDocument());

    const summary = ageDisclosure(4).querySelector("summary")!;
    await user.click(summary);

    await waitFor(() => expect(ageDisclosure(4).open).toBe(true));
  });
});
