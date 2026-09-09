import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildDetail } from "@kinder/contracts";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { ParentGrowthLauncher } from "@/components/child/parent-growth-launcher";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";

const child = {
  id: CHILD_ID,
  lastName: "Ганболд",
  firstName: "Батбаяр",
  sex: "MALE",
  dateOfBirth: "2021-04-12",
  status: "ACTIVE",
  photoMediaFileId: null,
  enrollments: [],
  guardianships: [],
  kindergarten: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Цэцэрлэг",
  },
  healthNotes: null,
} satisfies ChildDetail;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parent growth launcher copy", () => {
  it("shows the revised heading, notes copy, and empty state", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/observations`,
        body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
      },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/terms",
        body: [],
      },
    ]);

    renderWithProviders(<ParentGrowthLauncher child={child} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Хүүхдийн явцын үнэлгээ" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Б")).not.toBeInTheDocument();
    expect(screen.queryByText("БИ ЦЭЦЭРЛЭГТЭЭ")).not.toBeInTheDocument();
    expect(screen.queryByText("Батбаяр-ийн өхөөрдөм ахиц")).not.toBeInTheDocument();

    // The lede sits under the page's own heading now, and only there — it
    // used to repeat under "Тэмдэглэл" too, which read as a mistake once both
    // were on screen together.
    expect(
      screen.getByText("Хүүхдийн хөгжилд гарч буй ахиц дэвшлийг багш, эцэг эх хамтран тэмдэглэнэ"),
    ).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 2, name: "Тэмдэглэл" })).toBeInTheDocument();

    expect(await screen.findByText("Тэмдэглэл ороогүй")).toBeInTheDocument();
    expect(screen.queryByText("Одоогоор зурагтай мөч алга")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Багшийн хуваалцсан ажиглалт, бүтээл энд харагдана."),
    ).not.toBeInTheDocument();
  });

  it("keeps the three doors collapsed behind a single + trigger", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/observations`,
        body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
      },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/terms",
        body: [],
      },
    ]);

    renderWithProviders(<ParentGrowthLauncher child={child} />);

    for (const label of ["Ажиглалт", "Ярилцлага", "Бүтээл"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }

    const trigger = screen.getByRole("button", { name: "Шинэ тэмдэглэл нэмэх" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    for (const label of ["Ажиглалт", "Ярилцлага", "Бүтээл"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });
});
