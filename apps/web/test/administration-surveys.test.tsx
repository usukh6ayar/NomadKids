import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import AdministrationSurveysPage from "@/app/(app)/surveys/administration/page";

/**
 * «Удирдлагын судалгаа» as a teacher reads it — a table with the same columns
 * as «Судалгаа» and «Санал асуулга» (client, 2026-10-04).
 */

const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";

const SURVEY = {
  id: "77777777-7777-4777-8777-777777777777",
  title: "Эцэг эхийн сэтгэл ханамжийн судалгаа",
  description: null,
  category: "SATISFACTION",
  scope: "KINDERGARTEN",
  kind: "FORM",
  status: "PUBLISHED",
  questions: [],
  groupId: null,
  group: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  publishedAt: "2026-09-02T00:00:00.000Z",
  closedAt: null,
  isRead: false,
  respondedCount: 12,
  expectedCount: 48,
};

function stubPage(items: Record<string, unknown>[]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: `/kindergartens/${KINDERGARTEN_ID}/surveys/administration`,
      body: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Удирдлагын судалгаа", () => {
  it("lists the surveys in the boards' columns", async () => {
    stubPage([SURVEY]);
    renderWithProviders(<AdministrationSurveysPage />);

    const table = (await screen.findByText(SURVEY.title)).closest("table")!;
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Гарчиг", "Бүлэг", "Ангилал", "Судалгаа авсан", "Хариулт", "Хувь", "Огноо"]);

    const row = within(table).getByText(SURVEY.title).closest("tr")!;
    expect(within(row).getByRole("link", { name: SURVEY.title })).toHaveAttribute(
      "href",
      `/surveys/administration/${SURVEY.id}`,
    );
    expect(within(row).getByText("Шинэ")).toBeInTheDocument();
    expect(within(row).getByText("Бүх бүлэг")).toBeInTheDocument();
    expect(within(row).getByText("12 / 48")).toBeInTheDocument();
    expect(within(row).getByText("25%")).toBeInTheDocument();
    expect(within(row).getByText("2026.09.02")).toBeInTheDocument();
  });

  it("drops Шинэ once the survey has been opened", async () => {
    stubPage([{ ...SURVEY, isRead: true }]);
    renderWithProviders(<AdministrationSurveysPage />);

    await screen.findByText(SURVEY.title);
    expect(screen.queryByText("Шинэ")).not.toBeInTheDocument();
  });

  it("says what to expect when nothing has been sent", async () => {
    stubPage([]);
    renderWithProviders(<AdministrationSurveysPage />);

    expect(await screen.findByText("Удирдлагаас судалгаа ирээгүй байна")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
