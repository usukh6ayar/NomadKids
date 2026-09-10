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
import { SurveyBoard } from "@/components/survey/survey-board";

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
    renderWithProviders(<SurveyBoard kind="FORM" />);

    await openMenu(user);

    for (const label of ["Засах", "Оролцоо", "Тайлан татах", "Дахин ашиглах", "Устгах"]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
    }

    expect(screen.getByText(SURVEY.title).closest('[data-ui="card"]')).toHaveClass(
      "min-h-[190px]",
      "p-3",
    );
  });

  it("names who has not answered, before who has", async () => {
    const user = userEvent.setup();
    stubSurveys();
    renderWithProviders(<SurveyBoard kind="FORM" />);

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
    renderWithProviders(<SurveyBoard kind="FORM" />);

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
// The two kinds, which are two screens
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ★ Two boards, not a tab strip — 2026-09-10, at the client's request, and
 * their words settle it: "Энэ 2 тусдаа байх ёстой."
 *
 * They were one page with a kind tab on it, which claims two views of one
 * thing. A poll is answered in a tap and read as a bar; a questionnaire is
 * filled in and read as a report. `SurveyBoard` takes the kind as a prop and
 * `/surveys/forms` and `/surveys/polls` each mount it once.
 */
describe("the two boards", () => {
  it("shows only its own kind, whichever board is mounted", async () => {
    stubSurveys();
    const form = renderWithProviders(<SurveyBoard kind="FORM" />);

    expect(await screen.findByText(SURVEY.title)).toBeInTheDocument();
    expect(screen.queryByText(OLD_POLL.title)).not.toBeInTheDocument();
    form.unmount();

    stubSurveys();
    renderWithProviders(<SurveyBoard kind="POLL" />);

    expect(await screen.findByText(OLD_POLL.title)).toBeInTheDocument();
    expect(screen.queryByText(SURVEY.title)).not.toBeInTheDocument();
  });

  /**
   * ★ There is no kind tab left to press.
   *
   * Asserted as an absence because restoring the strip would leave every other
   * test in this file passing — the boards would still work, and the client's
   * "тусдаа" would be quietly undone.
   */
  it("offers no way to switch kind from inside a board", async () => {
    stubSurveys();
    renderWithProviders(<SurveyBoard kind="FORM" />);

    await screen.findByText(SURVEY.title);
    expect(screen.queryByRole("tablist", { name: "Судалгааны төрөл" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Асуулга" })).not.toBeInTheDocument();
  });

  /** The heading names the board, in the client's words for each kind. */
  it("names itself in the client's words", async () => {
    stubSurveys();
    renderWithProviders(<SurveyBoard kind="POLL" />);

    // "Пол" and "Форм судалгаа" until 2026-09-10: a transliteration and a
    // compound nobody says.
    expect(await screen.findByRole("heading", { level: 1, name: "Асуулга" })).toBeInTheDocument();
  });

  /**
   * ★ Three tabs since 2026-09-10 — and Ноорог is the new one.
   *
   * `DRAFT` used to be folded into Идэвхтэй, which made that count answer two
   * questions at once: a teacher reading "Идэвхтэй 2" could not tell whether
   * either was actually out with families.
   */
  it("separates drafts from what is actually out with families", async () => {
    const user = userEvent.setup();
    stubSurveys();
    renderWithProviders(<SurveyBoard kind="FORM" />);

    // The list first: the tab strip renders before the query resolves, so
    // waiting on the strip alone would assert against an empty board.
    expect(await screen.findByText(SURVEY.title)).toBeInTheDocument();

    const strip = screen.getByRole("tablist", { name: "Судалгааны төлөв" });
    expect(within(strip).getByRole("tab", { name: /Ноорог/ })).toBeInTheDocument();
    await user.click(within(strip).getByRole("tab", { name: /Ноорог/ }));
    await waitFor(() => expect(screen.queryByText(SURVEY.title)).not.toBeInTheDocument());
  });

  /**
   * ★ The board decides the kind, and the dialog does not ask again —
   * 2026-09-10, at the client's request ("Асуулга гэдэг товчин дээр судалгаа
   * гэсэн хажууд нь хэсэг орж ирж болохгүй").
   *
   * The dialog used to open with a radio pair drawn as tabs, so a teacher who
   * had just chosen Асуулга met Судалгаа sitting beside it as though the
   * choice had not counted — and switching there left them on the poll board
   * having made a form, which disappears from the list the moment it exists.
   *
   * Asserted as the *absence* of either kind's control rather than as the
   * presence of a heading: a heading would still read correctly with the radio
   * pair restored underneath it.
   */
  it("creates its own kind, without asking again", async () => {
    const user = userEvent.setup();
    stubSurveys();
    renderWithProviders(<SurveyBoard kind="POLL" />);
    await screen.findByText(OLD_POLL.title);

    await user.click(screen.getByRole("button", { name: "Шинэ" }));

    const dialog = await screen.findByRole("dialog", { name: "Шинээр асуулга үүсгэх" });
    expect(within(dialog).queryByRole("radio", { name: /Судалгаа/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("radio", { name: /Асуулга/ })).not.toBeInTheDocument();
    expect(within(dialog).getByTestId("survey-create-fields-primary")).toHaveClass("grid-cols-2");
    expect(within(dialog).getByTestId("survey-create-fields-secondary")).toHaveClass("grid-cols-2");
  });

  /*
   * ★ Grouped by the school year's term. What a teacher asks of an old survey
   * is which term it belonged to, not which week.
   */
  it("groups the list under term headings", async () => {
    stubSurveys();
    renderWithProviders(<SurveyBoard kind="FORM" />);

    // The September form falls in the first term.
    expect(await screen.findByRole("heading", { name: /1-р улирал/ })).toBeInTheDocument();
    // A term with nothing in it draws no heading — an empty one reads as
    // missing data rather than as a quiet term.
    expect(screen.queryByRole("heading", { name: /2-р улирал/ })).not.toBeInTheDocument();
  });
});

describe("the survey filters", () => {
  const openFilters = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: "Шүүлтүүр" }));
  };

  it("opens category and date controls inside one compact panel", async () => {
    const user = userEvent.setup();
    stubSurveys();
    renderWithProviders(<SurveyBoard kind="FORM" />);

    await openFilters(user);

    const panel = screen.getByTestId("survey-filter-panel");
    expect(panel).toHaveClass("rounded-card", "border-border", "bg-surface", "p-3");
    expect(screen.getByLabelText("Эхлэх огноо").parentElement?.parentElement).toHaveClass(
      "grid-cols-2",
    );
    expect(within(panel).getByRole("group", { name: "Судалгааны ангиллаар шүүх" })).toBeVisible();
  });

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
    renderWithProviders(<SurveyBoard kind="FORM" />);
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
    renderWithProviders(<SurveyBoard kind="FORM" />);
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
