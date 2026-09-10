import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import SurveyDetailPage from "@/app/(app)/surveys/[surveyId]/page";

/**
 * A published survey's results — the client's 2026-09-10 design.
 *
 * ★ Three readings of one dataset: Тойм · Асуултууд · Хариултууд.
 *
 * What is asserted here is the part of that design a refactor can quietly
 * lose: that each question type is drawn the way *that* type is read. All
 * three arrive from the API as the same `Record<string, number>`, and the
 * screen drew them all as sorted bars until this pass — treating a five-point
 * scale, a yes/no and a list of activities as one thing.
 *
 * ★★ A rating's rows are fixed 5 → 1 and keep their zeros. The shape is the
 * information: "nobody gave this a 1" is one of the more useful things on the
 * card, and a distribution whose rows move is not a distribution.
 */

const SURVEY_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_A = "44444444-4444-4444-8444-444444444444";
const GROUP_B = "55555555-5555-4555-8555-555555555555";

const RATING = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  order: 0,
  type: "RATING",
  prompt: "Хүүхдийн дассан зохицолдол сэтгэл хангалуун уу?",
  options: null,
};
const YES_NO = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  order: 1,
  type: "YES_NO",
  prompt: "Багштай харилцах боломж хангалттай байна уу?",
  options: null,
};
const TEXT = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  order: 2,
  type: "TEXT",
  prompt: "Нэмэлт санал, хүсэлт",
  options: null,
};

const SURVEY = {
  id: SURVEY_ID,
  title: "Эцэг эхийн сэтгэл ханамжийн судалгаа",
  description: null,
  category: "SATISFACTION",
  scope: "CHILD",
  kind: "FORM",
  status: "PUBLISHED",
  questions: [RATING, YES_NO, TEXT],
  group: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  publishedAt: "2026-08-20T00:00:00.000Z",
  closedAt: null,
};

const RESULTS = {
  survey: SURVEY,
  totalResponses: 6,
  expectedResponses: 10,
  missingResponses: 4,
  groupId: null,
  questions: [
    // 2×5, 2×4, 2×3 → 4.0 average, and the two empty scores must still draw.
    { question: RATING, responseCount: 6, counts: { "5": 2, "4": 2, "3": 2 }, responses: null },
    { question: YES_NO, responseCount: 6, counts: { true: 4, false: 2 }, responses: null },
    {
      question: TEXT,
      responseCount: 2,
      counts: null,
      responses: ["Багш нар маш анхааралтай ханддаг.", "Гадаа тоглох цагийг нэмэгдүүлбэл сайн."],
    },
  ],
  byGroup: [
    {
      group: { id: GROUP_A, name: "Далдбаа бүлэг" },
      responseCount: 5,
      expectedChildren: 6,
      questions: [],
    },
    {
      group: { id: GROUP_B, name: "Наран бүлэг" },
      responseCount: 1,
      expectedChildren: 4,
      questions: [],
    },
  ],
};

function stubResults() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/surveys/${SURVEY_ID}/results`, body: RESULTS },
    { path: `/surveys/${SURVEY_ID}/comparison`, body: null, status: 404 },
    { path: `/surveys/${SURVEY_ID}`, body: SURVEY },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ surveyId: SURVEY_ID });
  setSearchParams("");
});

const openTab = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(await screen.findByRole("tab", { name }));

describe("the survey results overview", () => {
  it("opens on Тойм with the four headline figures", async () => {
    stubResults();
    renderWithProviders(<SurveyDetailPage />);

    expect(await screen.findByText("Нийт асуулт")).toBeInTheDocument();
    expect(screen.getByText("Нийт хариулт")).toBeInTheDocument();
    // 6 of 10. Asserted on the ring's own name as well as the figure, because
    // the ring is what carries it for a screen reader — `Ring` is `aria-hidden`
    // everywhere else on the product precisely because the number is usually
    // beside it, and here it is the sole carrier.
    expect(screen.getAllByText("60%").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: "10-аас 6 нь хариулсан" })).toBeInTheDocument();
    expect(screen.getByText("Бүх бүлэг")).toBeInTheDocument();
  });

  /**
   * ★ Each group against its own roster, not against the biggest group.
   *
   * 5 of 6 is nearly done; 1 of 4 has barely started. Scaled against each other
   * they were drawn five-to-one and the second looked merely quieter.
   */
  it("measures each group against its own roster", async () => {
    stubResults();
    renderWithProviders(<SurveyDetailPage />);

    expect(await screen.findByText("5 / 6")).toBeInTheDocument();
    expect(screen.getByText("(83%)")).toBeInTheDocument();
    expect(screen.getByText("1 / 4")).toBeInTheDocument();
    expect(screen.getByText("(25%)")).toBeInTheDocument();
  });

  it("goes straight to the answers from the overview", async () => {
    const user = userEvent.setup();
    stubResults();
    renderWithProviders(<SurveyDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Үр дүнг дэлгэрэнгүй харах" }));

    expect(await screen.findByRole("tab", { name: "Хариултууд" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("the question index", () => {
  it("lists every question with its type and count", async () => {
    const user = userEvent.setup();
    stubResults();
    renderWithProviders(<SurveyDetailPage />);
    await openTab(user, "Асуултууд");

    expect(await screen.findByText("Нийт 3 асуулт")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]!).getByText("Үнэлгээ (1–5)")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Тийм/Үгүй")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("2 хариулт")).toBeInTheDocument();
  });

  it("opens the answers when a question is pressed", async () => {
    const user = userEvent.setup();
    stubResults();
    renderWithProviders(<SurveyDetailPage />);
    await openTab(user, "Асуултууд");

    await user.click(await screen.findByRole("button", { name: new RegExp(RATING.prompt) }));

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Хариултууд" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
  });
});

describe("a question drawn the way its type is read", () => {
  async function answers(user: ReturnType<typeof userEvent.setup>) {
    stubResults();
    renderWithProviders(<SurveyDetailPage />);
    await openTab(user, "Хариултууд");
    return screen.findByText(RATING.prompt);
  }

  it("gives a rating its average", async () => {
    const user = userEvent.setup();
    await answers(user);

    // 2×5 + 2×4 + 2×3 over 6.
    expect(screen.getByText("4.0")).toBeInTheDocument();
  });

  /**
   * ★ Fixed 5 → 1, zeros included.
   *
   * `AnswerBars` sorts by count because a list of named options has no inherent
   * order; a scale does, and a scale that drops its empty scores hides the most
   * informative thing on the card.
   */
  it("keeps a rating's empty scores on the scale", async () => {
    const user = userEvent.setup();
    await answers(user);

    // "2" and "1" were never answered and still have a row.
    expect(screen.getAllByText("0")).not.toHaveLength(0);
    expect(screen.getAllByText("(0%)")).toHaveLength(2);
  });

  it("draws a yes/no as a share of the whole", async () => {
    const user = userEvent.setup();
    await answers(user);

    expect(screen.getByRole("img", { name: /Тийм 67 хувь, Үгүй 33 хувь/ })).toBeInTheDocument();
  });

  it("shows free text as what people wrote", async () => {
    const user = userEvent.setup();
    await answers(user);

    expect(screen.getByText("Багш нар маш анхааралтай ханддаг.")).toBeInTheDocument();
  });

  /** The number a teacher refers to a question by, in a meeting. */
  it("numbers the questions", async () => {
    const user = userEvent.setup();
    await answers(user);

    // The badge leads the card, so the card's text starts with its number —
    // asserted this way rather than by `getByText("1")`, which also matches the
    // "1" row of the rating scale inside the same card.
    const card = screen.getByText(RATING.prompt).closest('[data-ui="card"]')!;
    expect(card.textContent?.startsWith("1")).toBe(true);
  });
});
