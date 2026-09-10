import { describe, expect, it } from "vitest";
import {
  canCreateObservation,
  defaultVisibleToParents,
  guardianMayEdit,
  initialReviewStatus,
} from "./observation-rules";

describe("canCreateObservation", () => {
  it("lets a guardian file a PARENT observation with read access alone", () => {
    // The §5.4 feature: a family contributes to the record.
    expect(canCreateObservation("PARENT", { canAccess: true, canRecord: false })).toBe(true);
  });

  it("REFUSES a guardian filing a TEACHER observation", () => {
    // Would put words in a teacher's mouth in the PDF the family receives.
    expect(canCreateObservation("TEACHER", { canAccess: true, canRecord: false })).toBe(false);
  });

  it("lets staff file either kind", () => {
    expect(canCreateObservation("TEACHER", { canAccess: true, canRecord: true })).toBe(true);
    expect(canCreateObservation("PARENT", { canAccess: true, canRecord: true })).toBe(true);
  });

  it("refuses someone with no access at all", () => {
    expect(canCreateObservation("PARENT", { canAccess: false, canRecord: false })).toBe(false);
    expect(canCreateObservation("TEACHER", { canAccess: false, canRecord: false })).toBe(false);
  });
});

describe("defaults", () => {
  it("keeps a teacher's note private and a parent's own note visible", () => {
    // Inverting this would publish every private teaching note in the system.
    expect(defaultVisibleToParents("TEACHER")).toBe(false);
    expect(defaultVisibleToParents("PARENT")).toBe(true);
  });

  it("approves a teacher's observation on save and queues a parent's", () => {
    expect(initialReviewStatus("TEACHER")).toBe("APPROVED");
    expect(initialReviewStatus("PARENT")).toBe("PENDING");
  });
});

describe("guardianMayEdit", () => {
  const own = { authorId: "parent-1", source: "PARENT" as const };

  it("allows editing their own pending submission", () => {
    expect(guardianMayEdit({ ...own, reviewStatus: "PENDING" }, "parent-1").allowed).toBe(true);
  });

  it("allows editing their own returned submission", () => {
    // A returned note exists to be corrected.
    expect(guardianMayEdit({ ...own, reviewStatus: "RETURNED" }, "parent-1").allowed).toBe(true);
  });

  it("allows the author to revise an approved submission for re-review", () => {
    const result = guardianMayEdit({ ...own, reviewStatus: "APPROVED" }, "parent-1");
    expect(result.allowed).toBe(true);
  });

  it("refuses another guardian's submission", () => {
    expect(guardianMayEdit({ ...own, reviewStatus: "PENDING" }, "parent-2").allowed).toBe(false);
  });

  it("refuses a teacher's observation", () => {
    expect(
      guardianMayEdit(
        { authorId: "parent-1", source: "TEACHER", reviewStatus: "APPROVED" },
        "parent-1",
      ).allowed,
    ).toBe(false);
  });

  it("refuses an observation with no recorded author", () => {
    // Legacy or imported rows must not become editable by anyone who asks.
    expect(
      guardianMayEdit({ authorId: null, source: "PARENT", reviewStatus: "PENDING" }, "parent-1")
        .allowed,
    ).toBe(false);
  });
});
