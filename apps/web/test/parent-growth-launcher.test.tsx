import { screen } from "@testing-library/react";
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

    expect(screen.getByRole("heading", { level: 2, name: "Тэмдэглэл" })).toBeInTheDocument();
    expect(
      screen.getByText("Хүүхдийн хөгжилд гарч буй ахиц дэвшлийг багш, эцэг эх хамтран тэмдэглэнэ"),
    ).toBeInTheDocument();

    expect(await screen.findByText("Тэмдэглэл ороогүй")).toBeInTheDocument();
    expect(screen.queryByText("Одоогоор зурагтай мөч алга")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Багшийн хуваалцсан ажиглалт, бүтээл энд харагдана."),
    ).not.toBeInTheDocument();
  });
});
