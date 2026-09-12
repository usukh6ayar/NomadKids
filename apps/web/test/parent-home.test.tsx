import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ParentHomePage from "@/app/(app)/home/page";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";

function stubParentHome(sex: "MALE" | "FEMALE") {
  stubApi([
    { path: "/auth/me", body: sessionFor(["PARENT"]) },
    { path: "/notifications/unread-count", body: { count: 0 } },
    {
      path: "/dashboard/parent",
      body: {
        children: [
          {
            id: CHILD_ID,
            lastName: "Ганболд",
            firstName: "Батбаяр",
            sex,
            dateOfBirth: "2021-04-12",
            photoMediaFileId: null,
            group: { id: "55555555-5555-4555-8555-555555555555", name: "Дэлбээ" },
            assessments: [],
          },
        ],
        currentTerm: null,
        recent: [],
      },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("parent home portfolio artwork", () => {
  it("uses the static cloud artwork instead of a background video", async () => {
    stubParentHome("MALE");

    renderWithProviders(<ParentHomePage />);

    await screen.findByRole("link", { name: "Цахим хувийн хавтас" });
    const backdrop = screen.getByTestId("parent-home-backdrop");
    const source = backdrop.querySelector("source");
    const image = backdrop.querySelector("img");

    expect(backdrop.querySelector("video")).toBeNull();
    expect(source).toHaveAttribute("srcset", "/background/parent-home-clouds-wide.png");
    expect(image).toHaveAttribute("src", "/background/parent-home-clouds-mobile.png");
  });

  it.each([
    ["MALE", "icon-portfolio-boy-3d"],
    ["FEMALE", "icon-portfolio-girl-3d"],
  ] as const)("uses the child's %s artwork on the portfolio card", async (sex, asset) => {
    stubParentHome(sex);

    renderWithProviders(<ParentHomePage />);

    const link = await screen.findByRole("link", { name: "Цахим хувийн хавтас" });
    const artwork = link.querySelector('[data-testid="parent-home-portfolio-art"]');
    const image = artwork?.querySelector("img");

    expect(link).toHaveClass("h-28");
    expect(image).not.toBeNull();
    expect(image!.getAttribute("src")).toContain(asset);
    expect(artwork).toHaveClass("h-full", "items-end", "bg-transparent");
    expect(image).toHaveClass("object-bottom");
  });
});
