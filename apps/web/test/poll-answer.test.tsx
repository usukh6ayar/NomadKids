import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import SurveyResponsePage from "@/app/(app)/children/[childId]/surveys/[surveyId]/page";

/**
 * A poll, as a family answers it — 2026-09-10, at the client's request:
 * "Авсан асуулгууд фэйсбүүкийн пост шиг эцэг эх дарахаар шууд хувь үзүүлэлт
 * нь харагдана. Эцэг эх түүн дээр нэмж шинэ хариулт үүсгэж болно."
 *
 * ★ The three things that make a poll a poll, rather than a one-question form,
 * are the three things asserted here: the tap *is* the submission, the reward
 * is the percentages, and a family may add a choice the teacher did not think
 * of.
 *
 * ★★ The result view follows the server's `respondedByMe`, never the fact that
 * this component just posted. A parent returning a week later must see the
 * bars, and a failed submission must not leave them looking at a result they
 * never cast — so the stub flips the tally between the two states rather than
 * the component remembering.
 */

const CHILD = "33333333-3333-4333-8333-333333333333";
const SURVEY = "88888888-8888-4888-8888-888888888888";
const QUESTION = "99999999-9999-4999-8999-999999999999";

const POLL = {
  id: SURVEY,
  title: "Аялалд оролцох уу?",
  category: "CLASS_GROUP",
  scope: "CHILD",
  kind: "POLL",
  status: "PUBLISHED",
  createdAt: "2026-09-01T00:00:00.000Z",
  publishedAt: "2026-09-01T00:00:00.000Z",
  questions: [
    {
      id: QUESTION,
      order: 0,
      type: "SINGLE_CHOICE",
      prompt: "Аялалд оролцох уу?",
      options: ["Ирнэ", "Ирэхгүй"],
    },
  ],
  respondedByMe: false,
};

function tally(answered: boolean) {
  return {
    surveyId: SURVEY,
    respondedByMe: answered,
    questions: [
      {
        questionId: QUESTION,
        prompt: "Аялалд оролцох уу?",
        type: "SINGLE_CHOICE",
        totalResponses: answered ? 4 : 3,
        options: answered
          ? [
              { label: "Ирнэ", count: 3 },
              { label: "Ирэхгүй", count: 1 },
            ]
          : [
              { label: "Ирнэ", count: 2 },
              { label: "Ирэхгүй", count: 1 },
            ],
        myAnswer: answered ? "Ирнэ" : null,
      },
    ],
  };
}

function stubPoll(answered = false) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["PARENT"]) },
    {
      path: `/children/${CHILD}/surveys/${SURVEY}/questions/${QUESTION}/options`,
      method: "POST",
      body: { questionId: QUESTION, options: ["Ирнэ", "Ирэхгүй", "Хожим шийднэ"], added: true },
    },
    { path: `/children/${CHILD}/surveys/${SURVEY}/tally`, body: tally(answered) },
    { path: `/surveys/${SURVEY}/responses`, method: "POST", body: {} },
    { path: `/children/${CHILD}/surveys`, body: [POLL] },
  ]);
}

/** The one write this screen made, as `stubApi` recorded it. */
function posted(api: ReturnType<typeof stubApi>, path: string) {
  return api.calls.find((call) => call.method === "POST" && call.url === path);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ childId: CHILD, surveyId: SURVEY });
  setSearchParams("");
});

describe("answering a poll", () => {
  /**
   * ★ No submit button, which is the whole difference from a form.
   *
   * Asserted as an absence because a poll that grew an "Илгээх" underneath
   * would still pass every other test in this file while being the exact
   * thing the client asked not to have.
   */
  it("offers the choices with no submit button under them", async () => {
    stubPoll();
    renderWithProviders(<SurveyResponsePage />);

    expect(await screen.findByRole("radio", { name: /Ирнэ/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Ирэхгүй/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Илгээх" })).not.toBeInTheDocument();
  });

  it("submits on the tap, without waiting for a second action", async () => {
    const user = userEvent.setup();
    const api = stubPoll();
    renderWithProviders(<SurveyResponsePage />);

    await user.click(await screen.findByRole("radio", { name: /Ирнэ/ }));

    await waitFor(() =>
      expect(posted(api, `/surveys/${SURVEY}/responses`)?.body).toMatchObject({
        childId: CHILD,
        answers: [{ questionId: QUESTION, value: "Ирнэ" }],
      }),
    );
  });

  /**
   * ★ Percentages of the people who answered, not of the class.
   *
   * 3 of 4 is 75%. Computing against the roster would imply that everyone who
   * has not voted chose nothing, which is not what a share on a poll means
   * anywhere else.
   */
  it("shows the shares once the family has answered", async () => {
    stubPoll(true);
    renderWithProviders(<SurveyResponsePage />);

    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("4 хүн хариулсан")).toBeInTheDocument();
  });

  it("marks which choice was the family's own", async () => {
    stubPoll(true);
    renderWithProviders(<SurveyResponsePage />);

    // The visible marker, not the `sr-only` sentence that also carries the
    // words — the middot is what separates them.
    expect(await screen.findByText("· таны сонголт")).toBeInTheDocument();
  });

  /** Once answered, the choices are results — not something to tap again. */
  it("stops offering the choices as controls after answering", async () => {
    stubPoll(true);
    renderWithProviders(<SurveyResponsePage />);

    await screen.findByText("75%");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("says nobody has answered rather than drawing an empty share", async () => {
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD}/surveys/${SURVEY}/tally`,
        body: {
          ...tally(false),
          questions: [
            {
              ...tally(false).questions[0],
              totalResponses: 0,
              options: [
                { label: "Ирнэ", count: 0 },
                { label: "Ирэхгүй", count: 0 },
              ],
            },
          ],
        },
      },
      { path: `/children/${CHILD}/surveys`, body: [POLL] },
    ]);
    renderWithProviders(<SurveyResponsePage />);

    expect(await screen.findByText("Хараахан хэн ч хариулаагүй байна")).toBeInTheDocument();
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });
});

describe("adding a choice of one's own", () => {
  /**
   * ★ Closed until asked for.
   *
   * An input permanently open under every poll invites typing where the
   * intended action is tapping, and on a phone it raises the keyboard over the
   * choices the parent came to read.
   */
  it("keeps the field closed behind a link", async () => {
    stubPoll();
    renderWithProviders(<SurveyResponsePage />);

    expect(await screen.findByRole("button", { name: /Өөр хариулт нэмэх/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Шинэ хариулт")).not.toBeInTheDocument();
  });

  it("posts the new choice to the poll's own question", async () => {
    const user = userEvent.setup();
    const api = stubPoll();
    renderWithProviders(<SurveyResponsePage />);

    await user.click(await screen.findByRole("button", { name: /Өөр хариулт нэмэх/ }));
    await user.type(screen.getByLabelText("Шинэ хариулт"), "Хожим шийднэ");
    await user.click(screen.getByRole("button", { name: "Нэмэх" }));

    await waitFor(() =>
      expect(
        posted(api, `/children/${CHILD}/surveys/${SURVEY}/questions/${QUESTION}/options`)?.body,
      ).toEqual({ label: "Хожим шийднэ" }),
    );
  });

  it("will not post an empty choice", async () => {
    const user = userEvent.setup();
    const api = stubPoll();
    renderWithProviders(<SurveyResponsePage />);

    await user.click(await screen.findByRole("button", { name: /Өөр хариулт нэмэх/ }));
    expect(screen.getByRole("button", { name: "Нэмэх" })).toBeDisabled();
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });

  /** A family may add a choice to a poll they have already answered. */
  it("stays available after the family has voted", async () => {
    stubPoll(true);
    renderWithProviders(<SurveyResponsePage />);

    await screen.findByText("75%");
    expect(screen.getByRole("button", { name: /Өөр хариулт нэмэх/ })).toBeInTheDocument();
  });
});

describe("a questionnaire, which is not a poll", () => {
  /**
   * ★ SINGLE_CHOICE on a FORM had no control at all until 2026-09-10.
   *
   * The type has existed since 2026-08-31 and every other surface knew it, but
   * the answering form stopped at CHECKBOX — so the question drew its prompt,
   * nothing else, and `unanswered` kept the submit button disabled for ever.
   * The family could neither answer it nor send the rest of the form.
   */
  it("renders a single-choice question, and can be submitted", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: `/surveys/${SURVEY}/responses`, method: "POST", body: {} },
      { path: `/children/${CHILD}/surveys`, body: [{ ...POLL, kind: "FORM" }] },
    ]);
    renderWithProviders(<SurveyResponsePage />);

    await user.click(await screen.findByRole("radio", { name: "Ирнэ" }));

    const submit = screen.getByRole("button", { name: "Илгээх" });
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() =>
      expect(posted(api, `/surveys/${SURVEY}/responses`)?.body).toMatchObject({
        answers: [{ questionId: QUESTION, value: "Ирнэ" }],
      }),
    );
  });
});
