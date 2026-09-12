import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import SurveyRespondentsPage from "@/app/(app)/surveys/[surveyId]/respondents/page";

const SURVEY_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "99999999-9999-4999-8999-999999999999";

const MANAGEMENT_SURVEY = {
  id: SURVEY_ID,
  title: "Удирдлагын судалгаа",
  description: null,
  category: "SATISFACTION",
  scope: "CHILD",
  kind: "FORM",
  status: "PUBLISHED",
  questions: [],
  group: null,
  createdById: ADMIN_ID,
  createdAt: "2026-09-01T00:00:00.000Z",
  publishedAt: "2026-09-02T00:00:00.000Z",
  closedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ surveyId: SURVEY_ID });
});

describe("management survey respondents", () => {
  it("does not request the respondent roster for a teacher", async () => {
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/surveys/${SURVEY_ID}`, body: MANAGEMENT_SURVEY },
    ]);

    renderWithProviders(<SurveyRespondentsPage />);

    expect(await screen.findByText("Судалгаа олдсонгүй")).toBeInTheDocument();
    expect(calls.some((call) => call.url === `/surveys/${SURVEY_ID}/participation`)).toBe(false);
  });

  it("allows management to see the respondent roster", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"], ADMIN_ID) },
      {
        path: `/surveys/${SURVEY_ID}/participation`,
        body: {
          anonymous: false,
          answered: [],
          pending: [],
          answeredCount: 0,
          roster: 0,
        },
      },
      { path: `/surveys/${SURVEY_ID}`, body: MANAGEMENT_SURVEY },
    ]);

    renderWithProviders(<SurveyRespondentsPage />);

    expect(await screen.findByRole("heading", { name: "Хариулсан хүүхдүүд" })).toBeInTheDocument();
    expect(await screen.findByText("Хүүхэд олдсонгүй")).toBeInTheDocument();
  });
});
