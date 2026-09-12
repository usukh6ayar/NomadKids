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

  it("links only the survey that can still be answered", async () => {
    stub();
    renderWithProviders(<ChildSurveysPage />);

    expect(await screen.findByRole("link", { name: new RegExp(OPEN_POLL.title) })).toHaveAttribute(
      "href",
      `/children/${CHILD}/surveys/${OPEN_POLL.id}`,
    );
    // An answered one has no form to return to — it opens instead.
    expect(
      screen.queryByRole("link", { name: new RegExp(ANSWERED.title) }),
    ).not.toBeInTheDocument();
  });

  /*
    ★ The change the client asked for by name: "хариулсан хариултууд харагддаг
    баймаар байна." The row used to be inert.
  */
  it("★ opens an answered survey onto the family's own answers", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<ChildSurveysPage />);

    const toggle = await screen.findByRole("button", { name: new RegExp(ANSWERED.title) });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(`1. ${RATING_Q.prompt}`)).toBeInTheDocument();
    // A rating reads as the score they chose, not as the teacher's band word.
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
    expect(screen.queryByText("Сайн")).not.toBeInTheDocument();

    /*
      Every question, including the one they skipped — a questionnaire read back
      with its blanks dropped is a different questionnaire.
    */
    expect(screen.getByText(`2. ${TEXT_Q.prompt}`)).toBeInTheDocument();

    /*
      Scoped to the panel: "Хариулаагүй" is also the state word on the open
      poll's own row, and an unscoped query cannot say which one it found.
    */
    const panel = within(document.getElementById(`survey-answers-${ANSWERED.id}`)!);
    expect(panel.getByText("Хариулаагүй")).toBeInTheDocument();
  });
});

/*
  ★ 2026-09-13, at the client's request: "эцэг эх дээр миний судалгааны
  асуулгын бусад хүмүүсийн хариулсан хувь болон өөрийн хариулт харагд."

  An answered асуулга opens onto the same bars the voting screen draws — every
  choice with its share, and the family's own marked. A questionnaire does not:
  `/tally` answers a poll and 404s a form, because a poll's running count is
  what a poll is and a form's aggregate is the teacher's (§1.7).
*/
describe("асуулгын хувь", () => {
  const ANSWERED_POLL = {
    ...OPEN_POLL,
    id: "44444444-4444-4444-8444-444444444444",
    title: "Ангийн хурлын цаг",
    respondedByMe: true,
    myAnswers: [{ questionId: CHOICE_Q.id, value: "Ботаник" }],
  };

  const TALLY = {
    surveyId: ANSWERED_POLL.id,
    respondedByMe: true,
    questions: [
      {
        questionId: CHOICE_Q.id,
        prompt: CHOICE_Q.prompt,
        type: "SINGLE_CHOICE",
        totalResponses: 8,
        options: [
          { label: "Ботаник", count: 6 },
          { label: "Үзэсгэлэн", count: 2 },
        ],
        myAnswer: "Ботаник",
      },
    ],
  };

  function stubPoll(tally: Record<string, unknown> | null = TALLY, status = 200) {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      // Before `/children/:id/surveys`, which is its own prefix.
      {
        path: `/children/${CHILD}/surveys/${ANSWERED_POLL.id}/tally`,
        body: tally,
        status,
      },
      { path: `/children/${CHILD}/surveys`, body: [ANSWERED_POLL] },
      { path: `/children/${CHILD}`, body: CHILD_DETAIL },
    ]);
  }

  it("★ shows every share and marks the family's own choice", async () => {
    const user = userEvent.setup();
    stubPoll();
    renderWithProviders(<ChildSurveysPage />);

    await user.click(await screen.findByRole("button", { name: new RegExp(ANSWERED_POLL.title) }));

    const panel = within(document.getElementById(`survey-answers-${ANSWERED_POLL.id}`)!);

    // 6 of 8 and 2 of 8 — the shares are of who answered, not of the class.
    expect(await panel.findByText("75%")).toBeInTheDocument();
    expect(panel.getByText("25%")).toBeInTheDocument();
    // Twice by design — once on the row, once in the row's `sr-only` sentence.
    expect(panel.getAllByText(/таны сонголт/).length).toBeGreaterThan(0);
    expect(panel.getByText("8 хүн хариулсан")).toBeInTheDocument();
  });

  /*
    A tally this family may not read is not worth a red panel — their own
    answers still are, and that is the fallback.
  */
  it("falls back to the family's own answer when the tally is refused", async () => {
    const user = userEvent.setup();
    stubPoll(null, 404);
    renderWithProviders(<ChildSurveysPage />);

    await user.click(await screen.findByRole("button", { name: new RegExp(ANSWERED_POLL.title) }));

    const panel = within(document.getElementById(`survey-answers-${ANSWERED_POLL.id}`)!);
    expect(await panel.findByText(`1. ${CHOICE_Q.prompt}`)).toBeInTheDocument();
    expect(panel.getByText("Ботаник")).toBeInTheDocument();
  });

  /* A questionnaire asks for no tally at all — its aggregate is the teacher's. */
  it("★ never asks for a questionnaire's tally", async () => {
    const user = userEvent.setup();
    const { calls } = stub([ANSWERED]);
    renderWithProviders(<ChildSurveysPage />);

    await user.click(await screen.findByRole("button", { name: new RegExp(ANSWERED.title) }));

    expect(await screen.findByText(`1. ${RATING_Q.prompt}`)).toBeInTheDocument();
    expect(calls.some((call) => call.url.includes("/tally"))).toBe(false);
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
