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

function stubResults(
  overrides: Record<string, unknown> = {},
  extra: Parameters<typeof stubApi>[0] = [],
) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    // Ahead of the 404 below: `stubApi` matches on a prefix and answers with
    // the first hit, so a comparison a case wants must precede the empty one.
    ...extra,
    // The two writes the lock makes, before the survey route that would
    // otherwise swallow them — `stubApi` matches on the path's prefix.
    { path: `/surveys/${SURVEY_ID}/close`, method: "POST", body: { ...SURVEY, status: "CLOSED" } },
    {
      path: `/surveys/${SURVEY_ID}/reopen`,
      method: "POST",
      body: { ...SURVEY, status: "PUBLISHED" },
    },
    { path: `/surveys/${SURVEY_ID}/results`, body: RESULTS },
    { path: `/surveys/${SURVEY_ID}/comparison`, body: null, status: 404 },
    { path: `/surveys/${SURVEY_ID}`, body: { ...SURVEY, ...overrides } },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ surveyId: SURVEY_ID });
  setSearchParams("");
});

const openTab = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(await screen.findByRole("tab", { name }));

/**
 * Opens "эцэг эхэд харагдах байдал" — the eye beside Хувилах.
 *
 * ★ The preview used to sit open on the page, so every visit to read the
 * answers scrolled past a copy of the questions first. 2026-09-12, at the
 * client's request, it waits behind a control.
 */
const openPreview = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(await screen.findByRole("button", { name: "Эцэг эхэд харагдах байдал" }));

/*
  ★ A way back — 2026-09-12, at the client's request: "дэлгэрэнгүй гэдэг дээр
  дарахаар буцаж болохгүй байна."

  The screen is reached from one of the two boards and had no exit of its own,
  so a teacher opening a survey to read its answers was left with the browser's
  own button. The fallback is the board the survey belongs to — a form's board
  for a form, a poll's for a poll.
*/
describe("getting back out of a survey", () => {
  it("offers a back arrow, pointing at the board the survey belongs to", async () => {
    stubResults();
    renderWithProviders(<SurveyDetailPage />);

    /*
      The arrow is on the loading branch too, pointing at the hub while the
      survey's kind is still unknown — so this waits for the loaded screen
      before reading it, or it would assert on that first one.
    */
    // Wait for the loaded screen: the arrow is on the loading branch too,
    // pointing at the hub while the survey's kind is still unknown.
    await screen.findByRole("button", { name: "Эцэг эхэд харагдах байдал" });
    expect(screen.getByRole("link", { name: "Буцах" })).toHaveAttribute("href", "/surveys/forms");
  });
});

/*
  The lock, and the eye — 2026-09-12, at the client's request: "судалгааны цоож
  дээр дарахаар судалгаа хаагдлаа гэж бичиг гар, цоожоо онгойлгоод нээж болдог
  бай" and "хувилах гэдгийн урд нүдний зураг нэм".
*/
describe("closing, re-opening and previewing", () => {
  it("says so when the lock goes on", async () => {
    const user = userEvent.setup();
    const { calls } = stubResults();
    renderWithProviders(<SurveyDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Хаах" }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith("/close") && call.method === "POST")).toBe(
        true,
      ),
    );
    expect(await screen.findByText(/Судалгааг хаалаа/)).toBeInTheDocument();
  });

  /** A closed survey offers the way back open, where the lock used to be. */
  it("offers Дахин нээх once the survey is closed", async () => {
    const user = userEvent.setup();
    const { calls } = stubResults({ status: "CLOSED" });
    renderWithProviders(<SurveyDetailPage />);

    expect(screen.queryByRole("button", { name: "Хаах" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Дахин нээх" }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith("/reopen") && call.method === "POST")).toBe(
        true,
      ),
    );
  });

  /*
    ★ The preview is closed until asked for.

    It used to sit open under the header, so every visit to read the answers
    scrolled past a copy of the questions first.
  */
  it("keeps the parent's view behind the eye", async () => {
    const user = userEvent.setup();
    stubResults();
    renderWithProviders(<SurveyDetailPage />);

    await screen.findByRole("button", { name: "Эцэг эхэд харагдах байдал" });
    expect(screen.queryByRole("heading", { name: "Асуулгын харагдац" })).not.toBeInTheDocument();

    await openPreview(user);
    expect(await screen.findByRole("heading", { name: "Асуулгын харагдац" })).toBeInTheDocument();

    await openPreview(user);
    expect(screen.queryByRole("heading", { name: "Асуулгын харагдац" })).not.toBeInTheDocument();
  });
});

describe("ерөнхий дүн", () => {
  it("shows the questionnaire's real answer shapes behind the eye", async () => {
    const user = userEvent.setup();
    stubResults();
    renderWithProviders(<SurveyDetailPage />);

    await openPreview(user);
    const preview = await screen.findByRole("heading", { name: "Асуулгын харагдац" });
    const card = preview.closest<HTMLElement>("[aria-labelledby='survey-preview-title']")!;
    expect(within(card).getByText(RATING.prompt, { exact: false })).toBeInTheDocument();
    expect(within(card).getByText("Үнэлгээ (1–5)")).toBeInTheDocument();
    expect(within(card).getByText(YES_NO.prompt, { exact: false })).toBeInTheDocument();
    expect(within(card).getByText("Тийм")).toBeInTheDocument();
    expect(within(card).getByText("Үгүй")).toBeInTheDocument();
  });

  /*
    ★ The controls at the foot of the card, round and hard right — 2026-09-12,
    from the client's header drawing and the note after it.

    What the row holds is the things a teacher *does* with a survey. The clone
    period that used to sit beside the title is gone entirely.
  */
  it("gathers the survey's controls at the foot of its card", async () => {
    stubResults();
    const { container } = renderWithProviders(<SurveyDetailPage />);

    await screen.findByRole("tab", { name: "Ерөнхий дүн" });
    const actions = container.querySelector('[data-ui="survey-actions"]') as HTMLElement;

    expect(within(actions).getByRole("link", { name: "Excel татах" })).toBeInTheDocument();
    for (const label of ["Эцэг эхэд харагдах байдал", "Хэвлэх", "Хувилах", "Хаах", "Устгах"]) {
      expect(within(actions).getByRole("button", { name: label })).toBeInTheDocument();
    }

    /*
      ★ No period picker anywhere on the card — 2026-09-12: "харшлын судалгаа
      гэсний ард байгаа хайрцаг хэсэг арилга." A copy is filed as the midline,
      and the wave is editable on the copy itself.
    */
    expect(screen.queryByRole("combobox", { name: "Хувилах үе" })).not.toBeInTheDocument();

    // And the row hugs the right edge, at every width — `ms-auto` is a no-op
    // while it shares a line with the audience and the fix once it wraps.
    expect(actions).toHaveClass("ms-auto");
  });
  it("★ rings how many replied, and names both halves", async () => {
    stubResults();
    renderWithProviders(<SurveyDetailPage />);

    // 6 of 10 replied, so four have not — and the gap is a named figure, not
    // the empty part of a circle.
    expect(await screen.findByText("Хамрагдсан байдал")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("6/10")).toBeInTheDocument();
    expect(screen.getByText("Бөглөсөн").parentElement).toHaveTextContent("6");
    expect(screen.getByText("Бөглөөгүй").parentElement).toHaveTextContent("4");
    // The ring carries the same fact for a screen reader, since a donut is the
    // one element on this card whose meaning is entirely visual.
    expect(screen.getAllByRole("img").map((node) => node.getAttribute("aria-label"))).toContain(
      "10-аас 6 нь бөглөсөн",
    );

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "Хариулт" })).toBeInTheDocument();
  });

  /*
    ★ The header card the client drew: the survey as a card inside a screen
    called "Судалгааны дүн" — icon, title, the window it runs in, whether it is
    live, and who it went to.
  */
  it("★ heads the screen with the survey's own card", async () => {
    stubResults();
    renderWithProviders(<SurveyDetailPage />);

    expect(await screen.findByRole("heading", { name: "Судалгааны дүн" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: SURVEY.title })).toBeInTheDocument();
    // "Нийтэлсэн" on the board; "Идэвхтэй" here, matching the tab it was found
    // under.
    expect(screen.getByText("Идэвхтэй")).toBeInTheDocument();
    // The roster comes off the results query the tabs below already read.
    expect(await screen.findByText(/Бүх бүлэг · 10 хүүхэд/)).toBeInTheDocument();
  });

  it("offers the way through to who has and has not replied", async () => {
    stubResults();
    renderWithProviders(<SurveyDetailPage />);

    expect(
      await screen.findByRole("link", { name: /Хэн бөглөсөн \/ бөглөөгүй харах/ }),
    ).toHaveAttribute("href", `/surveys/${SURVEY_ID}/respondents`);
  });

  /** A row per question, its mean beside it — the drawing's "Асуултуудын дүн". */
  it("scores every question in one list", async () => {
    stubResults();
    renderWithProviders(<SurveyDetailPage />);

    await screen.findByText("Асуултуудын дүн");
    const rows = screen.getAllByRole("listitem");

    // 2×5 + 2×4 + 2×3 over 6 answers.
    expect(within(rows[0]!).getByText(RATING.prompt)).toBeInTheDocument();
    expect(rows[0]!.textContent).toContain("4.0");

    // A yes/no and a free text carry no mean, so the row shows how many
    // answered rather than an invented score.
    expect(rows[2]!.textContent).toContain("2");
  });

  it("opens the question a row names, on the other tab", async () => {
    const user = userEvent.setup();
    stubResults();
    renderWithProviders(<SurveyDetailPage />);

    await user.click(await screen.findByRole("button", { name: new RegExp(RATING.prompt) }));

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Асуулт тус бүр" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByRole("combobox", { name: "Асуулт сонгох" })).toHaveTextContent(
      RATING.prompt,
    );
  });
});

describe("асуулт тус бүр", () => {
  async function open(user: ReturnType<typeof userEvent.setup>) {
    stubResults();
    renderWithProviders(<SurveyDetailPage />);
    await openTab(user, "Асуулт тус бүр");
    return screen.findByRole("combobox", { name: "Асуулт сонгох" });
  }

  /*
    ★ The five bands the drawing names — "Маш сайн · Сайн · Дунд · Муу".

    A RATING question stores a score and carries no labels of its own, so the
    words are the screen's. The empty scores keep their bars: "nobody gave this
    a 1" is one of the more useful things on the chart, and a distribution whose
    columns move is not a distribution.
  */
  it("★ draws a rating as named bands, zeros included", async () => {
    const user = userEvent.setup();
    await open(user);

    for (const band of ["Маш сайн", "Сайн", "Дунд", "Муу", "Маш муу"]) {
      expect(screen.getByText(band)).toBeInTheDocument();
    }

    // 2 of 6 is 33%; the two unused scores are still drawn, at zero.
    expect(screen.getAllByText("(33%)")).toHaveLength(3);
    expect(screen.getAllByText("(0%)")).toHaveLength(2);
  });

  it("qualifies the chart with the mean and who took part", async () => {
    const user = userEvent.setup();
    await open(user);

    expect(screen.getByText("Дундаж үнэлгээ").parentElement).toHaveTextContent("4.0");
    expect(screen.getByText("Оролцсон").parentElement).toHaveTextContent("6/10");
    expect(screen.getByText("Оролцсон").parentElement).toHaveTextContent("(60%)");
  });

  it("switches to another question's answers", async () => {
    const user = userEvent.setup();
    const picker = await open(user);

    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: new RegExp(YES_NO.prompt) }));

    expect(screen.getByText("Тийм")).toBeInTheDocument();
    expect(screen.getByText("Үгүй")).toBeInTheDocument();
    // A yes/no has no mean — the tile says so rather than inventing one.
    expect(screen.getByText("Дундаж үнэлгээ").parentElement).toHaveTextContent("—");
  });

  it("shows free text as what people wrote", async () => {
    const user = userEvent.setup();
    const picker = await open(user);

    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: new RegExp(TEXT.prompt) }));

    expect(screen.getByText("Багш нар маш анхааралтай ханддаг.")).toBeInTheDocument();
  });

  /*
    ★ No baseline, no block. A survey with nothing to compare against is the
    ordinary case — most are run once — and a heading over an empty state is a
    section a reader has to dismiss on every visit.
  */
  it("draws no comparison when there is nothing to compare against", async () => {
    const user = userEvent.setup();
    await open(user);

    expect(
      screen.queryByRole("heading", { name: "Өмнө авсан ижил судалгаатай харьцуулах" }),
    ).not.toBeInTheDocument();
  });

  /*
    ★ 2026-09-12, the client's second drawing: paired bars, the table that reads
    them out, and the one sentence the movement supports.
  */
  it("★ sets this question against the previous wave, and says what moved", async () => {
    const user = userEvent.setup();
    stubResults({}, [
      {
        path: `/surveys/${SURVEY_ID}/comparison`,
        body: {
          baseline: {
            id: GROUP_A,
            title: "2026.05 судалгаа",
            period: null,
            publishedAt: "2026-05-04T00:00:00.000Z",
          },
          endline: { id: SURVEY_ID, title: SURVEY.title, publishedAt: "2026-09-01T00:00:00.000Z" },
          indicators: [],
          children: [],
          note: null,
          questions: [
            {
              questionId: RATING.id,
              prompt: RATING.prompt,
              type: "RATING",
              // 2 of 5 was "Маш сайн" then; 2 of 6 now — 40% to 33%.
              baselineCounts: { "5": 2, "4": 2, "3": 1 },
              endlineCounts: { "5": 2, "4": 2, "3": 2 },
            },
          ],
        },
      },
    ]);
    renderWithProviders(<SurveyDetailPage />);
    await openTab(user, "Асуулт тус бүр");

    expect(
      await screen.findByRole("heading", { name: "Өмнө авсан ижил судалгаатай харьцуулах" }),
    ).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Хариултын харьцуулалт" });
    const row = within(table).getByRole("rowheader", { name: "Маш сайн" }).closest("tr")!;
    expect(
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["2 (40%)", "2 (33%)"]);

    expect(
      screen.getByText(/«Маш сайн» үзүүлэлт өмнөхөөс -7% буурсан байна\./),
    ).toBeInTheDocument();

    // The columns are named by when each wave ran, not "Өмнө/Одоо": "өмнө" is
    // true of every earlier wave there has ever been.
    expect(within(table).getByRole("columnheader", { name: "2026.05" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "2026.09" })).toBeInTheDocument();
    // And the question itself heads the card a teacher screenshots.
    expect(screen.getAllByText(RATING.prompt).length).toBeGreaterThan(0);
  });
});

describe("хүүхэд бүрийн хариулт", () => {
  it("асуултын дүнгээс хүүхэд бүрийн хариултыг нээнэ", async () => {
    const user = userEvent.setup();
    stubResults({}, [
      {
        path: `/surveys/${SURVEY_ID}/questions/${RATING.id}/answers`,
        body: {
          anonymous: false,
          items: [
            { child: { id: GROUP_A, firstName: "Ананд", lastName: "Амар" }, value: 5 },
            { child: { id: GROUP_B, firstName: "Болор", lastName: "Ба" }, value: 3 },
          ],
        },
      },
    ]);
    renderWithProviders(<SurveyDetailPage />);

    await openTab(user, "Хариулт");
    expect(
      await screen.findByRole("combobox", { name: "Хариултын асуулт сонгох" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /А\.Ананд/ })).toHaveTextContent("Маш сайн");
    expect(screen.getByRole("link", { name: /Б\.Болор/ })).toHaveTextContent("Дунд");
  });
});
