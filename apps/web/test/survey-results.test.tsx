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
const CHILD_A = "66666666-6666-4666-8666-666666666666";
const CHILD_B = "77777777-7777-4777-8777-777777777777";
const CHILD_C = "88888888-8888-4888-8888-888888888888";
const POLL_ID = "33333333-3333-4333-8333-333333333333";

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

/**
 * Нэг сонголт — what a poll's one question is.
 *
 * ★ Two of the four options went unchosen, on purpose: a choice nobody picked
 * is part of the distribution, the same argument the rating bands carry.
 */
const CHOICE = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  order: 0,
  type: "SINGLE_CHOICE",
  prompt: "Нэг хөл дээрээ 5 секунд зогсох чадвар ямар байна?",
  options: ["тийм", "үгүй", "заримдаа", "би өөрөө"],
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
  createdById: "11111111-1111-4111-8111-111111111111",
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

/**
 * Who replied and who has not — what `/participation` answers.
 *
 * ★ The Хариулт tab reads this now, not only the per-question answers: its two
 * halves are "бөглөсөн" and "бөглөөгүй", and the second half exists nowhere in
 * the results payload. Out of order on purpose — the screen sorts by name.
 */
const PARTICIPATION = {
  anonymous: false,
  answered: [
    {
      child: { id: CHILD_B, firstName: "Болор", lastName: "Ба" },
      group: { id: GROUP_A, name: "Далдбаа бүлэг" },
      submittedAt: "2026-08-22T00:00:00.000Z",
    },
    {
      child: { id: CHILD_A, firstName: "Ананд", lastName: "Амар" },
      group: { id: GROUP_A, name: "Далдбаа бүлэг" },
      submittedAt: "2026-08-21T00:00:00.000Z",
    },
  ],
  pending: [
    {
      child: { id: CHILD_C, firstName: "Цэцэг", lastName: "Цог" },
      group: { id: GROUP_B, name: "Наран бүлэг" },
    },
  ],
  answeredCount: 2,
  roster: 3,
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
    // Ahead of `/surveys/:id` for the same prefix reason: without its own stub
    // the roster would parse the survey body into two empty lists and say so.
    { path: `/surveys/${SURVEY_ID}/participation`, body: PARTICIPATION },
    { path: `/surveys/${SURVEY_ID}/results`, body: RESULTS },
    { path: `/surveys/${SURVEY_ID}/comparison`, body: null, status: 404 },
    { path: `/surveys/${SURVEY_ID}`, body: { ...SURVEY, ...overrides } },
  ]);
}

/**
 * Асуулга — a poll, the kind a parent reads the result of straight away.
 *
 * ★ Its one question is a SINGLE_CHOICE, so it is also the case that proves the
 * per-question chart handles that type. See the two tests at the foot.
 */
const POLL = {
  ...SURVEY,
  id: POLL_ID,
  title: "Бие бялдрын хөгжил",
  kind: "POLL",
  category: "PHYSICAL_DEVELOPMENT",
  questions: [CHOICE],
};

const POLL_RESULTS = {
  ...RESULTS,
  survey: POLL,
  totalResponses: 2,
  expectedResponses: 10,
  missingResponses: 8,
  questions: [
    { question: CHOICE, responseCount: 2, counts: { тийм: 1, үгүй: 1 }, responses: null },
  ],
  byGroup: [],
};

/** The same stubs as `stubResults`, for the poll rather than the form. */
function stubPoll() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/surveys/${POLL_ID}/participation`, body: PARTICIPATION },
    { path: `/surveys/${POLL_ID}/results`, body: POLL_RESULTS },
    { path: `/surveys/${POLL_ID}/comparison`, body: null, status: 404 },
    { path: `/surveys/${POLL_ID}`, body: POLL },
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

describe("management-owned survey access", () => {
  it("does not expose the survey or request its responses to a teacher", async () => {
    const { calls } = stubResults({
      createdById: "99999999-9999-4999-8999-999999999999",
    });
    renderWithProviders(<SurveyDetailPage />);

    expect(await screen.findByText("Судалгаа олдсонгүй")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Судалгааны дүн" })).not.toBeInTheDocument();
    expect(calls.some((call) => call.url === `/surveys/${SURVEY_ID}/results`)).toBe(false);
    expect(calls.some((call) => call.url === `/surveys/${SURVEY_ID}/participation`)).toBe(false);
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

  /*
    ★ 2026-09-12, at the client's request: "Ерөнхий дүн гэсэн хэсгээс Хэн
    бөглөсөн / бөглөөгүй харах энийг хас."

    The Хариулт tab opens on those two rosters itself now, so the row was a
    second door onto lists one tab away — and the ring's own legend already
    names them.
  */
  it("★ no longer sends the reader off to a separate roster screen", async () => {
    stubResults();
    renderWithProviders(<SurveyDetailPage />);

    await screen.findByText("Хамрагдсан байдал");
    expect(
      screen.queryByRole("link", { name: /Хэн бөглөсөн \/ бөглөөгүй харах/ }),
    ).not.toBeInTheDocument();
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

  it("jumps to the question a row names, on the other tab", async () => {
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
    // The panel it lands on lists every question, so what the row does is put
    // the reader on that question's own section rather than select it.
    expect(screen.getByRole("region", { name: new RegExp(RATING.prompt) })).toBeInTheDocument();
  });
});

describe("асуулт тус бүр", () => {
  /**
   * Opens the tab and hands back the rating question's own section.
   *
   * ★ Every question is drawn, so an assertion about one of them has to be
   * scoped to it — three charts on one page share the words "Тийм" and "33%".
   */
  async function open(user: ReturnType<typeof userEvent.setup>) {
    stubResults();
    renderWithProviders(<SurveyDetailPage />);
    await openTab(user, "Асуулт тус бүр");
    return screen.findByRole("region", { name: new RegExp(RATING.prompt) });
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
    const section = within(await open(user));

    for (const band of ["Маш сайн", "Сайн", "Дунд", "Муу", "Маш муу"]) {
      expect(section.getByText(band)).toBeInTheDocument();
    }

    // 2 of 6 is 33%; the two unused scores are still drawn, at zero.
    expect(section.getAllByText("(33%)")).toHaveLength(3);
    expect(section.getAllByText("(0%)")).toHaveLength(2);
  });

  /*
    ★ 2026-09-12, at the client's request: "асуултуудыг бүгдийг доош жагсаан
    харуулаад өг сонгохгүй."

    The tab had a picker and drew one question at a time, so reading a
    ten-question survey was ten selections. All three questions are now on the
    page at once, each drawn the way its own type reads — and no picker is left
    to select with.
  */
  it("★ lists every question down one page, with no picker", async () => {
    const user = userEvent.setup();
    await open(user);

    expect(screen.queryByRole("combobox", { name: "Асуулт сонгох" })).not.toBeInTheDocument();

    for (const question of [RATING, YES_NO, TEXT]) {
      expect(screen.getByRole("region", { name: new RegExp(question.prompt) })).toBeInTheDocument();
    }

    // The yes/no's own two bars, without anything being selected first.
    const yesNo = within(screen.getByRole("region", { name: new RegExp(YES_NO.prompt) }));
    expect(yesNo.getByText("Тийм")).toBeInTheDocument();
    expect(yesNo.getByText("Үгүй")).toBeInTheDocument();
  });

  /*
    ★ Dropped in the same pass, also at the client's request: the "Дундаж
    үнэлгээ" and "Оролцсон" tiles under every chart. The mean is the number
    each row of "Асуултуудын дүн" already carries and the participation figure
    is what the ring at the head of Ерөнхий дүн says.
  */
  it("★ no longer repeats the mean and the turnout under each chart", async () => {
    const user = userEvent.setup();
    await open(user);

    expect(screen.queryByText("Дундаж үнэлгээ")).not.toBeInTheDocument();
    expect(screen.queryByText("Оролцсон")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Хариултуудыг харах/ })).not.toBeInTheDocument();
  });

  it("shows free text as what people wrote", async () => {
    const user = userEvent.setup();
    await open(user);

    const text = within(screen.getByRole("region", { name: new RegExp(TEXT.prompt) }));
    expect(text.getByText("Багш нар маш анхааралтай ханддаг.")).toBeInTheDocument();
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

/*
  ★ 2026-09-12, at the client's request: "хариулт хэсэг рүү дарахаар бөглөсөн
  бөглөөгүй гэсэн 2 тусдаа болгочих, бөглөсөн хүүхэд дээр дараад орохоор асуулт
  тус бүрд юу гэж хариулсан нь дропдаун харагд."

  What it replaced was a question picker over one flat list of children, so
  reading one family's questionnaire meant selecting each question in turn and
  finding the same name in six lists. The axis is turned: the child is the row,
  and their whole questionnaire opens underneath it.
*/
describe("хүүхэд бүрийн хариулт", () => {
  /** The per-question answers, pivoted by the screen into one child's replies. */
  const ANSWER_STUBS = [
    {
      path: `/surveys/${SURVEY_ID}/questions/${RATING.id}/answers`,
      body: {
        anonymous: false,
        items: [
          { child: { id: CHILD_A, firstName: "Ананд", lastName: "Амар" }, value: 5 },
          { child: { id: CHILD_B, firstName: "Болор", lastName: "Ба" }, value: 3 },
        ],
      },
    },
    {
      path: `/surveys/${SURVEY_ID}/questions/${YES_NO.id}/answers`,
      body: {
        anonymous: false,
        items: [
          { child: { id: CHILD_A, firstName: "Ананд", lastName: "Амар" }, value: true },
          { child: { id: CHILD_B, firstName: "Болор", lastName: "Ба" }, value: false },
        ],
      },
    },
    {
      path: `/surveys/${SURVEY_ID}/questions/${TEXT.id}/answers`,
      body: {
        anonymous: false,
        items: [
          {
            child: { id: CHILD_A, firstName: "Ананд", lastName: "Амар" },
            value: "Багш нар маш анхааралтай ханддаг.",
          },
        ],
      },
    },
  ];

  it("★ splits the tab into бөглөсөн and бөглөөгүй", async () => {
    const user = userEvent.setup();
    stubResults({}, ANSWER_STUBS);
    renderWithProviders(<SurveyDetailPage />);

    await openTab(user, "Хариулт");

    // Two replied, one has not — the counts come off /participation, which is
    // the only place the second half of this tab exists.
    expect(await screen.findByRole("tab", { name: "Бөглөсөн (2)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Бөглөөгүй (1)" })).toBeInTheDocument();

    // Бөглөсөн opens first, sorted by name rather than by when they submitted.
    const names = screen
      .getAllByRole("button", { expanded: false })
      .map((node) => node.textContent ?? "")
      .filter((text) => /Ананд|Болор/.test(text));
    expect(names[0]).toContain("Ананд");
    expect(names[1]).toContain("Болор");

    // …and the picker the tab used to open on is gone with it.
    expect(
      screen.queryByRole("combobox", { name: "Хариултын асуулт сонгох" }),
    ).not.toBeInTheDocument();
  });

  it("★ opens one child's answer to every question", async () => {
    const user = userEvent.setup();
    stubResults({}, ANSWER_STUBS);
    renderWithProviders(<SurveyDetailPage />);

    await openTab(user, "Хариулт");
    const row = await screen.findByRole("button", { name: /Ананд/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    await user.click(row);

    await waitFor(() => expect(row).toHaveAttribute("aria-expanded", "true"));

    // Each question, numbered, with what this child said to it.
    expect(screen.getByText(`1. ${RATING.prompt}`)).toBeInTheDocument();
    expect(screen.getByText(`2. ${YES_NO.prompt}`)).toBeInTheDocument();
    expect(screen.getByText(`3. ${TEXT.prompt}`)).toBeInTheDocument();
    expect(screen.getByText("Маш сайн")).toBeInTheDocument();
    expect(screen.getByText("Тийм")).toBeInTheDocument();
    expect(screen.getByText("Багш нар маш анхааралтай ханддаг.")).toBeInTheDocument();

    // One at a time: opening the next child closes this one.
    await user.click(screen.getByRole("button", { name: /Болор/ }));
    await waitFor(() => expect(row).toHaveAttribute("aria-expanded", "false"));
    expect(screen.getByText("Дунд")).toBeInTheDocument();
    expect(screen.getByText("Үгүй")).toBeInTheDocument();
    // Болор answered two of the three, and the third says so rather than
    // leaving a blank where an answer should be.
    expect(screen.getByText("Хариулаагүй")).toBeInTheDocument();
  });

  it("★ names who has not replied yet", async () => {
    const user = userEvent.setup();
    stubResults({}, ANSWER_STUBS);
    renderWithProviders(<SurveyDetailPage />);

    await openTab(user, "Хариулт");
    await user.click(await screen.findByRole("tab", { name: "Бөглөөгүй (1)" }));

    // A pending row goes to the child — the next thing a teacher does with this
    // list is find the family's number.
    expect(screen.getByRole("link", { name: /Цэцэг/ })).toHaveAttribute(
      "href",
      `/children/${CHILD_C}/general`,
    );
    expect(screen.queryByText(/Ананд/)).not.toBeInTheDocument();
  });

  /*
    ★★ An anonymous wave shows neither list. That is the API's decision, not the
    screen's: a list of everybody who has *not* replied names the others by
    subtraction.
  */
  it("★★ withholds both halves for an anonymous survey", async () => {
    const user = userEvent.setup();
    stubResults({}, [
      {
        path: `/surveys/${SURVEY_ID}/participation`,
        body: { anonymous: true, answered: [], pending: [], answeredCount: 6, roster: 10 },
      },
    ]);
    renderWithProviders(<SurveyDetailPage />);

    await openTab(user, "Хариулт");
    expect(await screen.findByText("Нэргүй судалгаа")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Бөглөсөн/ })).not.toBeInTheDocument();
  });
});

/*
  ★ Асуулга — 2026-09-12, at the client's request: "Судалгааны дүн гэж бичсэн
  байна, Асуулгын дүн болго. энэ бол эцэг эхэд шууд үр дүн харагддаг судалгаа
  юм… асуулт тус бүрд хариулсан хувиуд харагдана."

  A poll is an асуулга everywhere else in the product — its board, its composer
  tab, `SURVEY_KIND_LABEL` — and this screen was the one place that called it a
  судалгаа.
*/
describe("асуулгын дүн", () => {
  it("★ titles the screen by the kind, not always 'Судалгааны дүн'", async () => {
    setParams({ surveyId: POLL_ID });
    stubPoll();
    renderWithProviders(<SurveyDetailPage />);

    expect(await screen.findByRole("heading", { name: "Асуулгын дүн" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Судалгааны дүн" })).not.toBeInTheDocument();
    // …and a form keeps its own word.
    expect(screen.getByRole("link", { name: "Буцах" })).toHaveAttribute("href", "/surveys/polls");
  });

  /*
    ★ A poll is one SINGLE_CHOICE question by definition, and `slicesOf` had no
    branch for that type — so it fell through to the free-text path and the tab
    that exists to show a poll's percentages answered "Бичвэр хариулт алга".
    The counts were in the payload the whole time.
  */
  it("★ charts a single choice as percentages, unchosen options included", async () => {
    const user = userEvent.setup();
    setParams({ surveyId: POLL_ID });
    stubPoll();
    renderWithProviders(<SurveyDetailPage />);

    await openTab(user, "Асуулт тус бүр");

    const section = within(await screen.findByRole("region", { name: new RegExp(CHOICE.prompt) }));
    expect(section.queryByText("Бичвэр хариулт алга.")).not.toBeInTheDocument();

    // 1 of 2 each for the two that were picked; the two that were not are drawn
    // at zero rather than dropped.
    for (const option of CHOICE.options) {
      expect(section.getByText(option)).toBeInTheDocument();
    }
    expect(section.getAllByText("(50%)")).toHaveLength(2);
    expect(section.getAllByText("(0%)")).toHaveLength(2);

    // The bars carry the same reading for a screen reader.
    expect(section.getAllByRole("img").map((node) => node.getAttribute("aria-label"))).toContain(
      "тийм: 1 хариулт, 50 хувь",
    );
  });
});
