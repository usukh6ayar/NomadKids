import { screen } from "@testing-library/react";
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

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ childId: CHILD_ID });
  setSearchParams("");
});

describe("portfolio hub header", () => {
  it("keeps only the right-aligned PDF action and hides the child profile", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}`,
        body: {
          id: CHILD_ID,
          lastName: "Ганболд",
          firstName: "Батбаяр",
          sex: "MALE",
          dateOfBirth: "2021-04-12",
          status: "ACTIVE",
          photoMediaFileId: null,
          enrollments: [
            {
              id: "eeee1111-1111-4111-8111-eeeeeeeeeeee",
              group: {
                id: "55555555-5555-4555-8555-555555555555",
                name: "Дэлбээ бүлэг",
                ageBand: "JUNIOR",
              },
              schoolYear: {
                id: "ffff1111-1111-4111-8111-ffffffffffff",
                name: "2026-2027",
              },
              status: "ACTIVE",
              startedOn: "2026-08-01",
              endedOn: null,
            },
          ],
          guardianships: [],
          kindergarten: {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Цэцэрлэг",
          },
          healthNotes: null,
        },
      },
    ]);

    renderWithProviders(<PortfolioPage />);

    const pdfButton = await screen.findByRole("button", { name: "PDF татах" });
    expect(pdfButton.parentElement).toHaveClass("flex", "justify-end");
    expect(screen.queryByText("Б")).not.toBeInTheDocument();
    expect(screen.queryByText("Ганболд Батбаяр")).not.toBeInTheDocument();
    expect(screen.queryByText("Суралцаж байгаа")).not.toBeInTheDocument();
    expect(screen.queryByText("5 нас · Хүү · Дэлбээ бүлэг")).not.toBeInTheDocument();
    expect(screen.queryByText("Төрсөн: 2021.04.12 · 2026-2027")).not.toBeInTheDocument();
  });
});
