import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ageProfileSchema } from "@kinder/contracts";
import { AgeProfileProgress } from "@/components/child/age-profile-progress";

/**
 * The progress card — client, 2026-10-07: first the keepsake banner became a
 * small «Зургаар татах» button, then the button went too.
 */

const full = ageProfileSchema.parse({
  age: 2,
  favoriteToy: "Шоо",
  kindergartenSkills: ["Танин мэдэхүй"],
  familyLearningSkills: ["Нийгэмшихүй"],
  characterTraits: ["Тайван"],
  familyMemberTypes: ["Аав, ээж"],
});

describe("AgeProfileProgress", () => {
  it("offers no picture download, even when the year is filled in", () => {
    render(<AgeProfileProgress age={2} profile={full} />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    // «Зургаар татах» went — client, 2026-10-07.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/насны цахим карт/)).not.toBeInTheDocument();
  });
});
