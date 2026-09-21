import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import ChildSurveysPage from "@/app/(app)/children/[childId]/surveys/page";
import SurveyDetailPage from "@/app/(app)/children/[childId]/surveys/[surveyId]/page";

/**
 * Эцэг эхийн судалгаанууд — a guardian's own list for one child.
 *
 * ★ REDESIGN 2026-09-13, at the client's request: "асуулга ба судалгаа хэт
 * эрээн мяраан байна, энгийн минимал орчин үеийн харагд. мөн хариулсан
 * хариултууд харагддаг баймаар байна. дээд хэсэгт хайлт шүүлтүүр товч 2 нэмээд
 * нас болон төрөлөөр хайдаг болго."
 *
 * What these cases hold is the part a restyle can quietly lose: that an
 * answered survey can be read back, that the two controls are behind two
 * buttons rather than occupying the page, and that "нас" means the age the
 * child *was* — which is computed here and has no column to fall back on.
 */

const CHILD = "11111111-1111-4111-8111-111111111111";

/** Born early in 2021, so the two surveys below fall in different years of life. */
const CHILD_DETAIL = {
  id: CHILD,
  firstName: "Сараа",
  lastName: "Болд",
  sex: "FEMALE",
  dateOfBirth: "2021-04-02",
  status: "ACTIVE",
  photoMediaFileId: null,
  enrollments: [],
  guardianships: [],
};

const RATING_Q = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  order: 0,
  type: "RATING",
  prompt: "Хүүхдийн зохицолдолд сэтгэл хангалуун уу?",
  options: null,
};
const TEXT_Q = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  order: 1,
  type: "TEXT",
  prompt: "Нэмэлт санал",
  options: null,
};
const CHOICE_Q = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  order: 0,
  type: "SINGLE_CHOICE",
  prompt: "Зугаалгаар хаана явах вэ?",
  options: ["Ботаник", "Үзэсгэлэн"],
};

/** Answered, and run when the child was 4. */
const ANSWERED = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Эцэг эхийн сэтгэл ханамжийн судалгаа",
  description: null,
  category: "SATISFACTION",
  scope: "CHILD",
  kind: "FORM",
  status: "PUBLISHED",
  questions: [RATING_Q, TEXT_Q],
  group: null,
  createdAt: "2025-10-01T00:00:00.000Z",
  publishedAt: "2025-10-01T00:00:00.000Z",
  closedAt: null,
  respondedByMe: true,
  myAnswers: [{ questionId: RATING_Q.id, value: 4 }],
};

/** Unanswered, still open, and run when the child was 5 — a poll, not a form. */
const OPEN_POLL = {
  ...ANSWERED,
  id: "33333333-3333-4333-8333-333333333333",
  title: "Зугаалгын санал асуулга",
  category: "CLASS_GROUP",
  kind: "POLL",
  questions: [CHOICE_Q],
  createdAt: "2026-09-01T00:00:00.000Z",
  publishedAt: "2026-09-01T00:00:00.000Z",
  respondedByMe: false,
  myAnswers: [],
};

function stub(surveys: Record<string, unknown>[] = [ANSWERED, OPEN_POLL]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["PARENT"]) },
    { path: `/children/${CHILD}/surveys`, body: surveys },
    { path: `/children/${CHILD}`, body: CHILD_DETAIL },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ childId: CHILD });
  setSearchParams("");
});

describe("эцэг эхийн судалгааны жагсаалт", () => {
  /*
    ★ The row is a title, a word and one grey line — no tinted icon tile and
    no filled badges. Asserted as the absence of the category pill, which is
    what made the list "эрээн мяраан": every row carried its subject twice,
    once as a colour and once as a word nobody filters on here.
  */
  it("★ draws a minimal row — no category badge, no icon tile", async () => {
    stub();
    renderWithProviders(<ChildSurveysPage />);

    const row = (await screen.findByText(ANSWERED.title)).closest("li")!;

    expect(within(row).getByText("Хариулсан")).toBeInTheDocument();
    // The category is gone from the row entirely — it was a badge and a tile.
    expect(within(row).queryByText("Сэтгэл ханамжийн судалгаа")).not.toBeInTheDocument();
    expect(row.querySelector("img")).toBeNull();
    // One grey line of facts, the kind and the question count among them.
    expect(row).toHaveTextContent("Судалгаа");
    expect(row).toHaveTextContent("2 асуулт");
  });

  /**
   * ★ Every row is a link now, whatever its state — the client, 2026-09-17:
   * "Хариулсан статустай хэсгийг сонгоход доошоо дэлгэгддэг цэс харагдаж
   * байгааг болиулна ... дарсан даруйд дэлгэрэнгүй эсвэл хариулсан үр дүнгийн
   * хуудас руу шилжинэ."
   *
   * What this replaces is a list with three behaviours in it: an unanswered
   * row was a link, an answered one unfolded a panel, and a closed one did
   * nothing at all. One of the three had to be discovered by pressing.
   */
  it("links every survey, answered or not", async () => {
    stub();
    renderWithProviders(<ChildSurveysPage />);

    expect(await screen.findByRole("link", { name: new RegExp(OPEN_POLL.title) })).toHaveAttribute(
      "href",
      `/children/${CHILD}/surveys/${OPEN_POLL.id}`,
    );
    expect(screen.getByRole("link", { name: new RegExp(ANSWERED.title) })).toHaveAttribute(
      "href",
      `/children/${CHILD}/surveys/${ANSWERED.id}`,
    );
  });

  /**
   * ★ Flat, not folded — the client, 2026-09-17: "хариулсан байдал ил
   * харагдах ... дарахад харагддаг биш".
   *
   * The toggle is gone and so is the panel it opened; what it used to hold is
   * drawn on the card instead, so the answer is readable without a press and
   * the press is reserved for going to the survey itself.
   */
  it("shows an answered survey's answer without a press", async () => {
    stub();
    renderWithProviders(<ChildSurveysPage />);

    await screen.findByText(ANSWERED.title);

    expect(screen.queryByRole("button", { name: new RegExp(ANSWERED.title) })).toBeNull();
    expect(document.getElementById(`survey-answers-${ANSWERED.id}`)).toBeNull();

    // The rating they chose, on the card, with no interaction at all.
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
    // And the question it answers, in one line rather than a stacked panel.
    expect(screen.getByText(RATING_Q.prompt)).toBeInTheDocument();
  });

  /**
   * ★ The list asks for no tally.
   *
   * It never did — a form's aggregate is the teacher's (§1.7) — and now that
   * nothing expands, a poll's shares are not this screen's either. They are
   * drawn where the row leads: `poll-answer.test.tsx` holds them.
   */
  it("fetches no tally for a list", async () => {
    const { calls } = stub();
    renderWithProviders(<ChildSurveysPage />);

    await screen.findByText(ANSWERED.title);
    expect(calls.some((call) => call.url.includes("/tally"))).toBe(false);
  });
});

/**
 * Where an answered row now leads.
 *
 * ★ A questionnaire reads back rather than asking again. Following the link
 * onto a blank form would offer the questions a second time and the API would
 * refuse the answers — which is why this case lives beside the list that sends
 * a family here.
 */
describe("хариулсан судалгааны хуудас", () => {
  it("reads the family's own answers back", async () => {
    setParams({ childId: CHILD, surveyId: ANSWERED.id });
    stub();
    renderWithProviders(<SurveyDetailPage />);

    expect(await screen.findByText(`1. ${RATING_Q.prompt}`)).toBeInTheDocument();
    // The score they chose, not the teacher's band word.
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
    // Every question, including the one they skipped — a questionnaire read
    // back with its blanks dropped is a different questionnaire.
    expect(screen.getByText(`2. ${TEXT_Q.prompt}`)).toBeInTheDocument();
    expect(screen.getByText("Хариулаагүй")).toBeInTheDocument();
    // And no form to fill in again.
    expect(screen.queryByRole("button", { name: "Илгээх" })).toBeNull();
  });
});

describe("хайлт ба шүүлтүүр", () => {
  /* Two buttons, and neither control takes a phone row until it is asked for. */
  it("★ keeps search and filter behind one button each", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<ChildSurveysPage />);

    await screen.findByText(ANSWERED.title);
    expect(screen.getByLabelText("Судалгааны нэрээр хайх")).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: "Хайх" }));
    expect(screen.getByLabelText("Судалгааны нэрээр хайх")).toBeVisible();
  });

  it("narrows the list by what was typed", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<ChildSurveysPage />);

    await screen.findByText(ANSWERED.title);
    await user.click(screen.getByRole("button", { name: "Хайх" }));
    await user.type(screen.getByLabelText("Судалгааны нэрээр хайх"), "Зугаалгын");

    expect(screen.getByText(OPEN_POLL.title)).toBeInTheDocument();
    expect(screen.queryByText(ANSWERED.title)).not.toBeInTheDocument();
  });

  it("narrows the list by kind", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<ChildSurveysPage />);

    await screen.findByText(ANSWERED.title);
    await user.click(screen.getByRole("button", { name: "Шүүлтүүр" }));
    await user.click(screen.getByRole("button", { name: "Асуулга" }));

    expect(screen.getByText(OPEN_POLL.title)).toBeInTheDocument();
    expect(screen.queryByText(ANSWERED.title)).not.toBeInTheDocument();
    // The button carries a count while a filter is on.
    expect(screen.getByRole("button", { name: /Шүүлтүүр/ })).toHaveTextContent("1");
  });

  /*
    ★ "Нас" is the age the child *was* when the survey ran, computed from
    `dateOfBirth` and the survey's own date — a survey carries no age column.

    Born 2021-04-02: the satisfaction form ran 2025-10-01, at 4; the poll ran
    2026-09-01, at 5. Only the ages the list actually contains become chips.
  */
  it("★ narrows the list by the age the child was when it ran", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<ChildSurveysPage />);

    await screen.findByText(ANSWERED.title);
    await user.click(screen.getByRole("button", { name: "Шүүлтүүр" }));

    const ages = within(screen.getByRole("group", { name: "Насаар шүүх" }));
    expect(ages.getByRole("button", { name: "4 нас" })).toBeInTheDocument();
    expect(ages.getByRole("button", { name: "5 нас" })).toBeInTheDocument();
    // No chip for a year this child has no survey in.
    expect(ages.queryByRole("button", { name: "2 нас" })).not.toBeInTheDocument();

    await user.click(ages.getByRole("button", { name: "4 нас" }));
    expect(screen.getByText(ANSWERED.title)).toBeInTheDocument();
    expect(screen.queryByText(OPEN_POLL.title)).not.toBeInTheDocument();
  });

  it("says so when the filters match nothing, rather than showing an empty list", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<ChildSurveysPage />);

    await screen.findByText(ANSWERED.title);
    await user.click(screen.getByRole("button", { name: "Хайх" }));
    await user.type(screen.getByLabelText("Судалгааны нэрээр хайх"), "байхгүй");

    expect(screen.getByText("Хайлтад тохирох судалгаа алга")).toBeInTheDocument();
  });

  /* A child with no birth date on file loses the age chips, not the screen. */
  it("offers no age chips when the child has no date of birth", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: `/children/${CHILD}/surveys`, body: [ANSWERED] },
      { path: `/children/${CHILD}`, body: { ...CHILD_DETAIL, dateOfBirth: null } },
    ]);
    renderWithProviders(<ChildSurveysPage />);

    await screen.findByText(ANSWERED.title);
    await user.click(screen.getByRole("button", { name: "Шүүлтүүр" }));

    expect(screen.queryByRole("group", { name: "Насаар шүүх" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Төрлөөр шүүх" })).toBeInTheDocument();
  });
});
