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

/** Both answered — for the cases that filter within one tab. */
const ANSWERED_POLL = { ...OPEN_POLL, respondedByMe: true };

/** Opens «Дууссан», where an answered survey lives since 2026-10-06. */
async function openDone(user = userEvent.setup()) {
  await user.click(await screen.findByRole("tab", { name: /^Дууссан/ }));
  return user;
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
    await openDone();

    const row = (await screen.findByText(ANSWERED.title)).closest("li")!;

    // ★ Client, 2026-10-06 (a drawing): answered is a green tick, and the
    // line under the title is the date alone.
    expect(within(row).getByRole("img", { name: "Хариулсан" })).toBeInTheDocument();
    // The category is gone from the row entirely — it was a badge and a tile.
    expect(within(row).queryByText("Сэтгэл ханамжийн судалгаа")).not.toBeInTheDocument();
    expect(row.querySelector("img")).toBeNull();
    expect(row).not.toHaveTextContent("2 асуулт");
    // The date sits above the title (2026-10-06, "эсрэгээрээ").
    const link = within(row).getAllByRole("link")[0]!;
    expect(link.textContent).toMatch(new RegExp(`^2025\\.10\\.01${ANSWERED.title}`));
  });

  /** Client, 2026-10-06: the answers as a numbered table — question │ answer. */
  it("lays an answered questionnaire out as a numbered question │ answer table", async () => {
    stub();
    renderWithProviders(<ChildSurveysPage />);
    await openDone();

    const row = (await screen.findByText(ANSWERED.title)).closest("li")!;
    const lines = within(row)
      .getAllByRole("term")
      .map((term) => term.parentElement!);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent(/^1Хүүхдийн зохицолдолд сэтгэл хангалуун уу\?★★★★☆$/);
    // Unanswered still has its line, with a dash.
    expect(lines[1]).toHaveTextContent(/^2Нэмэлт санал—$/);
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
    await openDone();
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
    await openDone();

    await screen.findByText(ANSWERED.title);

    expect(screen.queryByRole("button", { name: new RegExp(ANSWERED.title) })).toBeNull();
    expect(document.getElementById(`survey-answers-${ANSWERED.id}`)).toBeNull();

    // The rating they chose, on the card, with no interaction at all.
    expect(screen.getByText("★★★★☆")).toBeInTheDocument();
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

    await screen.findByText(OPEN_POLL.title);
    await openDone();
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

    const answers = within(await screen.findByRole("list"));
    const items = answers.getAllByRole("listitem");
    // ★ 2026-10-06: the question numbered in ink, the answer under it on its
    // own block — no «Асуулт ба таны хариулт» heading, no «Таны хариулт» label.
    expect(screen.queryByText(/Таны хариулт/)).toBeNull();
    expect(items[0]).toHaveTextContent(`1.${RATING_Q.prompt}★★★★☆`);
    // Every question, including the one they skipped — a questionnaire read
    // back with its blanks dropped is a different questionnaire.
    expect(items[1]).toHaveTextContent(`2.${TEXT_Q.prompt}Хариулаагүй`);

    // What the survey is: its subject, its audience, when it ran.
    expect(screen.getByText("Чиглэл").nextSibling).toHaveTextContent("Сэтгэл ханамжийн судалгаа");
    expect(screen.getByText("Хамрах хүрээ").nextSibling).toHaveTextContent("Бүх цэцэрлэг");
    expect(screen.getByText("Эхэлсэн").nextSibling).toHaveTextContent("2025.10.01");
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

    await screen.findByText(OPEN_POLL.title);
    expect(screen.getByLabelText("Судалгааны нэрээр хайх")).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: "Хайх" }));
    expect(screen.getByLabelText("Судалгааны нэрээр хайх")).toBeVisible();
  });

  it("narrows the list by what was typed", async () => {
    stub([ANSWERED, ANSWERED_POLL]);
    renderWithProviders(<ChildSurveysPage />);
    const user = await openDone();

    await screen.findByText(ANSWERED.title);
    await user.click(screen.getByRole("button", { name: "Хайх" }));
    await user.type(screen.getByLabelText("Судалгааны нэрээр хайх"), "Зугаалгын");

    expect(screen.getByText(OPEN_POLL.title)).toBeInTheDocument();
    expect(screen.queryByText(ANSWERED.title)).not.toBeInTheDocument();
  });

  it("narrows the list by kind", async () => {
    stub([ANSWERED, ANSWERED_POLL]);
    renderWithProviders(<ChildSurveysPage />);
    const user = await openDone();

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
    stub([ANSWERED, ANSWERED_POLL]);
    renderWithProviders(<ChildSurveysPage />);
    const user = await openDone();

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

    await screen.findByText(OPEN_POLL.title);
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

    await openDone(user);
    await screen.findByText(ANSWERED.title);
    await user.click(screen.getByRole("button", { name: "Шүүлтүүр" }));

    expect(screen.queryByRole("group", { name: "Насаар шүүх" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Төрлөөр шүүх" })).toBeInTheDocument();
  });
});

/**
 * ★ Two states — client, 2026-10-06: «Идэвхтэй» is what is still being
 * collected and not yet answered; «Дууссан» is what was answered, and
 * anything closed, which can no longer be answered.
 */
describe("идэвхтэй ба дууссан", () => {
  it("opens on Идэвхтэй and keeps the answered ones under Дууссан", async () => {
    const CLOSED = {
      ...OPEN_POLL,
      id: "44444444-4444-4444-8444-444444444444",
      title: "Хаагдсан санал асуулга",
      status: "CLOSED",
    };
    stub([ANSWERED, OPEN_POLL, CLOSED]);
    renderWithProviders(<ChildSurveysPage />);

    expect(await screen.findByRole("tab", { name: "Идэвхтэй 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Дууссан 2" })).toBeInTheDocument();
    expect(screen.getByText(OPEN_POLL.title)).toBeInTheDocument();
    expect(screen.queryByText(ANSWERED.title)).toBeNull();
    expect(screen.queryByText(CLOSED.title)).toBeNull();

    await openDone();
    expect(screen.getByText(ANSWERED.title)).toBeInTheDocument();
    expect(screen.getByText(CLOSED.title)).toBeInTheDocument();
    expect(screen.queryByText(OPEN_POLL.title)).toBeNull();
  });

  it("says there is nothing to fill in when every survey is answered", async () => {
    stub([ANSWERED]);
    renderWithProviders(<ChildSurveysPage />);

    expect(await screen.findByText("Шинэ судалгаа байхгүй")).toBeInTheDocument();
    expect(screen.queryByText(/Бөглөсөн судалгаа «Дууссан»-д/)).toBeNull();
  });
});
