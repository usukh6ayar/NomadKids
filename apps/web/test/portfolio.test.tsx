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
import GrowthPage from "@/app/(app)/children/[childId]/portfolio/growth/page";
import PortfolioPage from "@/app/(app)/children/[childId]/portfolio/page";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";

/**
 * The portfolio's age sections — now "Насны онцлог", the "Хөгжил" page's
 * default tab (`portfolio/growth/page.tsx`).
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

function stubGrowth(
  dateOfBirth: string,
  ageProfiles: unknown[] = [],
  sex: "MALE" | "FEMALE" | null = "MALE",
  roles: Parameters<typeof sessionFor>[0] = ["TEACHER"],
) {
  stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    { path: `/children/${CHILD_ID}/age-profiles`, body: ageProfiles },
    { path: `/children/${CHILD_ID}/milestones`, body: [] },
    {
      path: `/children/${CHILD_ID}`,
      body: {
        id: CHILD_ID,
        lastName: "Ганболд",
        firstName: "Батбаяр",
        sex,
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

describe("portfolio launcher", () => {
  it("uses the four supplied transparent drawings in the requested order", async () => {
    stubGrowth(bornYearsAgo(3));

    renderWithProviders(<PortfolioPage />);

    const nav = await screen.findByRole("navigation", { name: "Цахим хавтасны хэсгүүд" });
    const expected = [
      ["Миний тухай", "icon-portfolio-about-me-3d"],
      ["Хөгжил", "icon-portfolio-development-3d"],
      ["Зургийн цомог", "icon-portfolio-gallery-3d"],
      ["Насны харьцуулалт", "icon-portfolio-age-comparison-3d"],
    ] as const;
    const links = within(nav).getAllByRole("link");

    expect(links).toHaveLength(expected.length);
    expected.forEach(([label, asset], index) => {
      expect(links[index]).toHaveAccessibleName(label);
      const icon = links[index]!.querySelector("img");
      expect(icon).not.toBeNull();
      expect(icon!.getAttribute("src")).toContain(asset);
      expect(icon!.parentElement!.className).not.toMatch(/\bbg-/);
    });

    const profile = screen.getByTestId("portfolio-profile-art");
    expect(profile.querySelector("img")!.getAttribute("src")).toContain("icon-portfolio-boy-3d");
    expect(profile).toHaveClass("h-full", "w-32", "items-end", "overflow-hidden", "bg-transparent");
    expect(profile.querySelector("img")).toHaveClass("h-40", "object-bottom");
    expect(screen.getByRole("heading", { name: "Цахим хувийн хавтас" }).parentElement).toHaveClass(
      "h-28",
      "bg-gradient-to-r",
    );
  });

  it("selects the girl artwork from the child's stored sex", async () => {
    stubGrowth(bornYearsAgo(3), [], "FEMALE");

    renderWithProviders(<PortfolioPage />);

    const profile = await screen.findByTestId("portfolio-profile-art");
    expect(profile.querySelector("img")!.getAttribute("src")).toContain("icon-portfolio-girl-3d");
    expect(profile.className).toContain("bg-transparent");
  });
});

describe("portfolio age sections", () => {
  it("shows the parent's three share actions as illustrated cards, one active in blue", async () => {
    stubGrowth(bornYearsAgo(3), [], "MALE", ["PARENT"]);

    renderWithProviders(<GrowthPage />);

    // ★ One shared colour, not one per category.
    //
    // A green/blue/orange accent line was how the three used to tell
    // themselves apart; now the active one is filled `bg-primary` like every
    // other primary action in the product, and the other two stay plain
    // `secondary` — the same pattern the teacher's own source-filter buttons
    // already use.
    const expected = [
      ["Ажиглалт", "icon-observation-3d", true],
      ["Ярилцлага", "icon-conversation-3d", false],
      ["Бүтээл", "icon-artwork-3d", false],
    ] as const;

    for (const [label, asset, active] of expected) {
      const button = await screen.findByRole("button", { name: label });
      expect(button).toHaveClass("h-[48px]", "rounded-button", "w-full");
      expect(button).toHaveClass(active ? "bg-primary" : "bg-surface");
      expect(button.className).not.toMatch(/before:bg-\[#/);
      expect(button.querySelector("img")?.getAttribute("src")).toContain(asset);
    }
  });

  it("renders a section for every age 2–5 whatever the child's age (RFP §4.3)", async () => {
    stubGrowth(bornYearsAgo(2));

    renderWithProviders(<GrowthPage />);

    await waitFor(() => expect(ageDisclosure(2)).toBeInTheDocument());
    for (const age of [2, 3, 4, 5]) {
      expect(ageDisclosure(age), `age ${age} must still have a section`).toBeInTheDocument();
      // The anchor the age row links to has to resolve for every year.
      expect(document.getElementById(`age-${age}`)).not.toBeNull();
    }
  });

  it("opens the years the child has lived and closes the rest", async () => {
    stubGrowth(bornYearsAgo(3));

    renderWithProviders(<GrowthPage />);

    await waitFor(() => expect(ageDisclosure(2)).toBeInTheDocument());

    expect(ageDisclosure(2).open, "2 нас is behind them").toBe(true);
    expect(ageDisclosure(3).open, "3 нас is the year they are in").toBe(true);
    expect(ageDisclosure(4).open, "4 нас has not happened").toBe(false);
    expect(ageDisclosure(5).open, "5 нас has not happened").toBe(false);
  });

  it("opens a future year that somebody has already written into", async () => {
    // Content outranks the date: a family filling "5 нас" in early meant it,
    // and collapsing writing that exists would hide real content.
    stubGrowth(bornYearsAgo(2), [{ age: 5, favoriteColour: null, favoriteFood: "Бууз" }]);

    renderWithProviders(<GrowthPage />);

    await waitFor(() => expect(ageDisclosure(5)).toBeInTheDocument());
    // The age-profiles fetch that decides "filled" settles after the section
    // itself first appears — `AgeSectionShell`'s own doc comment covers why
    // ("`filled` is false on the first render, always") — so this waits for
    // the effect it drives rather than assuming it has already landed.
    await waitFor(() => expect(ageDisclosure(5).open).toBe(true));
    expect(ageDisclosure(4).open).toBe(false);
  });

  it("does not offer an edit control for a year that is still closed", async () => {
    stubGrowth(bornYearsAgo(2));

    renderWithProviders(<GrowthPage />);
    await waitFor(() => expect(ageDisclosure(2)).toBeInTheDocument());

    // The nine "Засах" buttons were the substance of the finding. The control
    // still exists in the markup — `<details>` hides rather than unmounts — so
    // this asserts the thing that actually changed: it is not reachable
    // without opening the year first.
    const closed = ageDisclosure(5);
    expect(closed.open).toBe(false);
    expect(closed.querySelector("summary")).toHaveTextContent("Ирээдүйд");
  });

  /**
   * ★ The row's colour is free to encode age again (2026-08-28) — a per-age
   * tint is back, matching a reference build's own `growing_up_index.html` —
   * because the thing that actually failed before was never "colour", it was
   * "the only visible fill signal was a 6px dot at 25% opacity", about 1.5:1
   * against its own background. That signal is a full-size `Check` icon now,
   * the same one this replaced it with the first time, so colour is free to
   * carry a different, honest variable: which age this is.
   *
   * So this asserts what the *fill* state is actually carried by — the
   * accessible name and the icon — not by CSS class equality, which is what
   * would break the moment a per-age tint came back for a legitimate reason.
   */
  it("marks the filled year with an icon the accessible name also states", async () => {
    stubGrowth(bornYearsAgo(3), [{ age: 2, favoriteFood: "Бууз" }]);

    renderWithProviders(<GrowthPage />);

    const row = await screen.findByRole("navigation", { name: /Насны хэсгүүд/ });
    const link = (age: number) =>
      within(row).getByRole("link", { name: new RegExp(`^${age} нас`) });

    // The accessible name states it outright — colour is never the only
    // carrier. It also depends on the age-profiles fetch, which settles
    // after the nav itself first renders (see the previous test's own note).
    await waitFor(() => expect(link(2)).toHaveAccessibleName("2 нас — мэдээлэлтэй"));
    expect(link(3)).toHaveAccessibleName("3 нас — хоосон");

    // …and the filled year's `Check` icon is the visible signal a sighted user
    // actually sees, not a hue only the aria-label distinguishes.
    expect(link(2).querySelector("svg")).toBeInTheDocument();
    expect(link(3).querySelector("svg")).not.toBeInTheDocument();
  });

  it("opening a closed year reveals its edit control", async () => {
    const user = userEvent.setup();
    stubGrowth(bornYearsAgo(2));

    renderWithProviders(<GrowthPage />);
    await waitFor(() => expect(ageDisclosure(2)).toBeInTheDocument());

    const summary = ageDisclosure(4).querySelector("summary")!;
    await user.click(summary);

    await waitFor(() => expect(ageDisclosure(4).open).toBe(true));
  });
});

describe("RFP §4.3 completeness", () => {
  /**
   * ★ The gap this closes was real storage with no interface.
   *
   * `ChildAgeProfile` has carried `favoriteStory`, `emotionalTraits`,
   * `familyMembers` and `learningInterest` since the schema was written, the
   * API validates and persists all four, and the Zod contract declares them —
   * only the web's field list was short. So the fields were writable by any
   * other client and invisible here, and a teacher could not enter them at all.
   *
   * That is the mirror image of the mock-data problem this project keeps
   * refusing. Both leave the screen disagreeing with the database, and this one
   * is quieter: nothing fails, the data is simply never seen.
   */
  it("offers every stored age-profile field to a teacher", async () => {
    const user = userEvent.setup();
    stubGrowth(bornYearsAgo(3));

    renderWithProviders(<GrowthPage />);
    await waitFor(() => expect(ageDisclosure(3)).toBeInTheDocument());

    const panel = ageDisclosure(3);
    await user.click(within(panel).getByRole("button", { name: /Засах/ }));

    // The four that were missing, by their RFP wording.
    for (const label of [
      "Дуртай үлгэр",
      "Гэр бүлийн гишүүд",
      "Сэтгэл хөдлөлийн онцлог",
      "Суралцах сонирхол",
    ]) {
      expect(within(panel).getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("renders a stored value for a field the UI used to drop", async () => {
    stubGrowth(bornYearsAgo(3), [
      { age: 3, favoriteStory: "Алтан загасны үлгэр", learningInterest: "Тоо тоолох" },
    ]);

    renderWithProviders(<GrowthPage />);

    await waitFor(() => expect(ageDisclosure(3)).toBeInTheDocument());
    // Same reason as the two tests above: the stored value only appears once
    // the age-profiles fetch settles, which is not guaranteed by the time the
    // section itself first renders.
    await waitFor(() => expect(screen.getByText("Алтан загасны үлгэр")).toBeInTheDocument());
    expect(screen.getByText("Тоо тоолох")).toBeInTheDocument();
  });
});
