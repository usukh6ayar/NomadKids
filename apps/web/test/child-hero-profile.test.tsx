import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChildDetail } from "@kinder/contracts";
import { renderWithProviders } from "./support/render";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";

/**
 * The child's header — client, 2026-10-06: cleaner, and the camera badge
 * stays on the portrait on a phone instead of running to the card's edge.
 */

const CHILD = {
  id: "22222222-2222-4222-8222-222222222222",
  lastName: "Батжаргал",
  firstName: "Ану",
  sex: "FEMALE",
  dateOfBirth: "2022-01-25",
  status: "ACTIVE",
  healthNotes: "Самарт харшилтай",
  isForeign: false,
  enrollments: [],
} as unknown as ChildDetail;

describe("ChildHeroProfile", () => {
  it("keeps the camera badge's box no wider than the portrait", () => {
    renderWithProviders(<ChildHeroProfile child={CHILD} canEditPhoto />);

    const camera = screen.getByLabelText("Батжаргал Ану — профайл зураг солих");
    expect(camera.parentElement).toHaveClass("relative", "w-fit");
  });

  it("does not say «Суралцаж байгаа»; an unusual status is a word with a dot", () => {
    const { unmount } = renderWithProviders(<ChildHeroProfile child={CHILD} showHealthAlert />);
    expect(screen.queryByText("Суралцаж байгаа")).toBeNull();
    expect(screen.getByText("Эрүүл мэндийн тэмдэглэлтэй")).toHaveClass("text-peach-ink");
    unmount();

    renderWithProviders(
      <ChildHeroProfile child={{ ...CHILD, status: "ON_LEAVE" } as ChildDetail} />,
    );
    const away = screen.getByText(/чөлөө/i);
    expect(away.className).not.toMatch(/\bbg-sun\b/);
  });

  it("puts the school year in the corner and keeps it off the birth line", () => {
    renderWithProviders(
      <ChildHeroProfile
        child={
          {
            ...CHILD,
            enrollments: [
              {
                id: "e1",
                status: "ACTIVE",
                group: { id: "g1", name: "Дэлбээ бүлэг" },
                schoolYear: { id: "y1", name: "2026-2027" },
              },
            ],
          } as unknown as ChildDetail
        }
      />,
    );

    expect(screen.getByText("2026-2027 он")).toHaveClass("absolute");
    expect(screen.getByText(/^Төрсөн:/)).toHaveTextContent(/^Төрсөн: 2022\.01\.25$/);
  });

  it("pushes its actions to the right edge", () => {
    renderWithProviders(
      <ChildHeroProfile child={CHILD} actions={<a href="/x">Цахим хувийн хавтас</a>} />,
    );

    const link = screen.getByRole("link", { name: "Цахим хувийн хавтас" });
    expect(link.parentElement).toHaveClass("ml-auto", "justify-end");
    expect(link.querySelector("svg")).toBeNull();
  });
});
