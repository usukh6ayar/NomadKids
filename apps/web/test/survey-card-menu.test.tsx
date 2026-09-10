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
import SurveysPage from "@/app/(app)/surveys/page";

/**
 * The survey card's overflow menu, and the participation panel behind it.
 *
 * ★ What "Оролцоо" is for, and what these cases protect: the *pending* half.
 *
 * `results` already reports how many replied. A teacher opens this to find the
 * families to ring, so a panel that could only list who answered would be the
 * half nobody needs — the API builds its roster from `Enrollment` for exactly
 * that reason, and the dialog leads with the names carrying nothing.
 */

const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";
const SURVEY_ID = "77777777-7777-4777-8777-777777777777";
const CHILD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHILD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const SURVEY = {
  id: SURVEY_ID,
  title: "Сэтгэл ханамжийн судалгаа",
  description: null,
  category: "SATISFACTION",
  scope: "CHILD",
  status: "PUBLISHED",
  questions: [],
  group: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  publishedAt: "2026-09-02T00:00:00.000Z",
  closedAt: null,
};

function stubSurveys() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/kindergartens/${KINDERGARTEN_ID}/surveys`, body: [SURVEY] },
    {
      path: `/surveys/${SURVEY_ID}/participation`,
      method: "GET",
      body: {
        answered: [
          {
            child: { id: CHILD_A, lastName: "Батжаргал", firstName: "Ануужин" },
            group: null,
            submittedAt: "2026-09-03T00:00:00.000Z",
          },
        ],
        pending: [
          { child: { id: CHILD_B, lastName: "Ганболд", firstName: "Батбаяр" }, group: null },
        ],
        familyResponses: 0,
        roster: 2,
      },
    },
    { path: `/surveys/${SURVEY_ID}`, method: "DELETE", body: {} },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
  setSearchParams("");
});

/** The card's own menu, by the survey it names. */
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole("button", {
    name: `${SURVEY.title} үйлдэл`,
  });
  await user.click(trigger);
}

describe("a survey card's menu", () => {
  it("offers the five actions the client asked for", async () => {
    const user = userEvent.setup();
    stubSurveys();
    renderWithProviders(<SurveysPage />);

    await openMenu(user);

    for (const label of ["Засах", "Оролцоо", "Тайлан татах", "Дахин ашиглах", "Устгах"]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("names who has not answered, before who has", async () => {
    const user = userEvent.setup();
    stubSurveys();
    renderWithProviders(<SurveysPage />);

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Оролцоо/ }));

    const dialog = await screen.findByRole("dialog", { name: /Оролцоо/ });
    expect(within(dialog).getByText("Ганболд Батбаяр")).toBeInTheDocument();
    expect(within(dialog).getByText("Батжаргал Ануужин")).toBeInTheDocument();

    // The list to ring comes first: DOCUMENT_POSITION_FOLLOWING means the
    // answered heading comes after the pending one.
    const pending = within(dialog).getByText("Бөглөөгүй");
    const answered = within(dialog).getByText("Бөглөсөн");
    expect(
      pending.compareDocumentPosition(answered) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("confirms before withdrawing, then withdraws", async () => {
    const user = userEvent.setup();
    const api = stubSurveys();
    renderWithProviders(<SurveysPage />);

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Устгах/ }));

    const dialog = await screen.findByRole("dialog", { name: /устгах уу/ });
    // The answers survive the survey — §3.2, and the copy has to say so.
    expect(within(dialog).getByText(/хариултууд хэвээр/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Устгах" }));

    await waitFor(() =>
      expect(
        api.calls.some((call) => call.method === "DELETE" && call.url === `/surveys/${SURVEY_ID}`),
      ).toBe(true),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Choosing what to create
// ═══════════════════════════════════════════════════════════════════════════

describe("the two create buttons", () => {
  /*
   * ★ One button opened a dialog whose first control was the choice between
   * the two kinds, so the decision was made twice — once by pressing the
   * button and again inside it. Naming the kinds on the buttons makes the
   * press *be* the choice.
   */
  it("names both kinds in the client's words", async () => {
    stubSurveys();
    renderWithProviders(<SurveysPage />);

    // "Пол" and "Форм судалгаа" until 2026-09-10: a transliteration and a
    // compound nobody says.
    expect(await screen.findByRole("button", { name: /Асуулга/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Судалгаа$/ })).toBeInTheDocument();
  });

  it("opens the dialog on the kind that was pressed", async () => {
    const user = userEvent.setup();
    stubSurveys();
    renderWithProviders(<SurveysPage />);

    await user.click(await screen.findByRole("button", { name: /Асуулга/ }));

    const dialog = await screen.findByRole("dialog");
    // The radio inside is still what the dialog reads; the button seeds it.
    expect(within(dialog).getByRole("radio", { name: /Асуулга/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /Судалгаа/ })).not.toBeChecked();
  });

  it("opens on Судалгаа when that is the one pressed", async () => {
    const user = userEvent.setup();
    stubSurveys();
    renderWithProviders(<SurveysPage />);

    await user.click(await screen.findByRole("button", { name: /^Судалгаа$/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: /Судалгаа/ })).toBeChecked();
  });
});
