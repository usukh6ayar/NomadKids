import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import AboutMePage from "@/app/(app)/children/[childId]/portfolio/about-me/page";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";

/** Two years old today, whatever "today" is when the suite runs. */
function bornYearsAgo(years: number): string {
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - years);
  dob.setDate(dob.getDate() - 1);
  return dob.toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ childId: CHILD_ID });
  setSearchParams("");
});

describe("RFP §4.1 completeness", () => {
  /**
   * ★★ `recordedOn` was stored and accepted, and the *contract* dropped it.
   *
   * Zod strips what it is not told about, so a measurement's date could be
   * written through `PATCH /about-me` and never read back. A height with no date
   * is a number about a growing child that nobody can place in time.
   */
  it("shows when a height and weight were measured", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD_ID}/about-me`,
        body: { exists: true, heightCm: "98.5", weightKg: "15.2", recordedOn: "2026-03-14" },
      },
      { path: `/children/${CHILD_ID}/birthday-notes`, body: [] },
      {
        path: `/children/${CHILD_ID}`,
        body: {
          id: CHILD_ID,
          lastName: "Ганболд",
          firstName: "Батбаяр",
          sex: "MALE",
          dateOfBirth: bornYearsAgo(3),
          status: "ACTIVE",
          photoMediaFileId: null,
          enrollments: [],
          guardianships: [],
          kindergarten: { id: "33333333-3333-4333-8333-333333333333", name: "Цэцэрлэг" },
          healthNotes: null,
        },
      },
    ]);

    renderWithProviders(<AboutMePage />);

    expect(await screen.findByText("98.5 см")).toBeInTheDocument();
    expect(screen.getByText("2026.03.14")).toBeInTheDocument();
  });
});
