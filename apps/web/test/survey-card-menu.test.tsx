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
  title: "Намрын эцэг эхийн уулзалт",
  description: null,
  category: "SATISFACTION",
  scope: "CHILD",
  kind: "FORM",
  status: "PUBLISHED",
  questions: [],
  group: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  publishedAt: "2026-09-02T00:00:00.000Z",
  closedAt: null,
};

/** A poll from an earlier month — what the kind and date filters exclude. */
const OLD_POLL = {
  ...SURVEY,
  id: "88888888-8888-4888-8888-888888888888",
  title: "Зугаалгын санал асуулга",
  kind: "POLL",
  createdAt: "2026-07-01T00:00:00.000Z",
  publishedAt: "2026-07-02T00:00:00.000Z",
};

function stubSurveys() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/kindergartens/${KINDERGARTEN_ID}/surveys`, body: [SURVEY, OLD_POLL] },
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
// The two kinds, and creating one
// ═══════════════════════════════════════════════════════════════════════════

describe("the kind tabs", () => {
  /*
   * ★ Tabs, not two create buttons over one pile.
   *
   * A poll and a form are answered differently and read differently, and one
   * undifferentiated list meant a teacher looking for last term's poll read
   * past every form to find it. The press that chooses what to look at is now
   * also the press that chooses what to make.
   */
  it("names both kinds in the client's words", async () => {
    stubSurveys();
    renderWithProviders(<SurveysPage />);

    const strip = await screen.findByRole("tablist", { name: "Судалгааны төрөл" });
    // "Пол" and "Форм судалгаа" until 2026-09-10: a transliteration and a
    // compound nobody says.
    expect(within(strip).getByRole("tab", { name: "Асуулга" })).toBeInTheDocument();
    expect(within(strip).getByRole("tab", { name: "Судалгаа" })).toBeInTheDocument();
  });

  it("shows only the open kind's surveys", async () => {
    const user = userEvent.setup();
    stubSurveys();
    renderWithProviders(<SurveysPage />);

    // Судалгаа is the tab a teacher lands on.
    expect(await screen.findByText(SURVEY.title)).toBeInTheDocument();
    expect(screen.queryByText(OLD_POLL.title)).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Асуулга" }));

    await waitFor(() => expect(screen.getByText(OLD_POLL.title)).toBeInTheDocument());
    expect(screen.queryByText(SURVEY.title)).not.toBeInTheDocument();
  });

  it("creates whichever kind is open", async () => {
    const user = userEvent.setup();
    stubSurveys();
    renderWithProviders(<SurveysPage />);
    await screen.findByText(SURVEY.title);

    await user.click(screen.getByRole("tab", { name: "Асуулга" }));
    await user.click(screen.getByRole("button", { name: /Шинэ асуулга үүсгэх/ }));

    const dialog = await screen.findByRole("dialog");
    // The radio inside is still what the dialog reads; the tab seeds it.
    expect(within(dialog).getByRole("radio", { name: /Асуулга/ })).toBeChecked();
  });

  /*
   * ★ Grouped by the school year's term. What a teacher asks of an old survey
   * is which term it belonged to, not which week.
   */
  it("groups the list under term headings", async () => {
    stubSurveys();
    renderWithProviders(<SurveysPage />);

    // The September form falls in the first term.
    expect(await screen.findByRole("heading", { name: /1-р улирал/ })).toBeInTheDocument();
    // A term with nothing in it draws no heading — an empty one reads as
    // missing data rather than as a quiet term.
    expect(screen.queryByRole("heading", { name: /2-р улирал/ })).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Narrowing the list
// ═══════════════════════════════════════════════════════════════════════════

describe("the survey filters", () => {
  const openFilters = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: "Шүүлтүүр" }));
  };

  /*
   * ★ Three separate rows, because they are three separate questions. A chip
   * row mixing "Асуулга" with "Сэтгэл ханамжийн судалгаа" would read as one
   * set of alternatives and behave as two.
   */
  /*
   * The range filters on the date the *card shows* — closed, else published,
   * else created. Filtering on `createdAt` while the card reads a later
   * publication date would be a list that disagrees with itself.
   */
  it("narrows by the date the card shows", async () => {
    const user = userEvent.setup();
    stubSurveys();
    renderWithProviders(<SurveysPage />);
    await screen.findByText(SURVEY.title);

    await openFilters(user);
    await user.type(screen.getByLabelText("Эхлэх огноо"), "2026-08-01");

    // The September form survives; nothing older is in this tab to drop, so
    // the assertion is that the range did not take the one it should keep.
    await waitFor(() => expect(screen.getByText(SURVEY.title)).toBeInTheDocument());

    await user.type(screen.getByLabelText("Дуусах огноо"), "2026-08-31");
    await waitFor(() => expect(screen.queryByText(SURVEY.title)).not.toBeInTheDocument());
  });

  it("counts every narrowing choice on the icon", async () => {
    const user = userEvent.setup();
    stubSurveys();
    renderWithProviders(<SurveysPage />);
    await screen.findByText(SURVEY.title);

    const trigger = screen.getByRole("button", { name: "Шүүлтүүр" });
    expect(within(trigger).queryByText("1")).not.toBeInTheDocument();

    await user.click(trigger);
    await user.type(screen.getByLabelText("Эхлэх огноо"), "2026-08-01");
    // A range counts once however many of its two ends are set.
    await waitFor(() => expect(within(trigger).getByText("1")).toBeInTheDocument());

    const categories = screen.getByRole("group", { name: "Судалгааны ангиллаар шүүх" });
    await user.click(within(categories).getByRole("button", { name: "Сэтгэл ханамжийн судалгаа" }));
    await waitFor(() => expect(within(trigger).getByText("2")).toBeInTheDocument());
  });
});
