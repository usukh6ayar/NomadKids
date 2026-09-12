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
  createdById: "11111111-1111-4111-8111-111111111111",
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

    expect(screen.getByText(SURVEY.title).closest('[data-ui="card"]')).toHaveClass("p-3");
  });

  /*
    ★ REDESIGN 2026-09-12, to the client's own drawing: "хэт их өнгөтэй, онцгүй
    байна. ийм минимал болго, цэвэрхэн… энэ зураг дээр байгаагаас бусад үг зураг
    харагдахгүй."

    The instruction was literal about what may appear, so this case is written
    as what may *not*: the tinted category tile and its icon, the two filled
    badges, the audience row, the question count and the three little calendar
    and list icons are all gone. What survives is the six things the drawing
    has, and the assertions below name each one.
  */
  it("★ carries only the six things the client's drawing has", async () => {
    stubSurveys();
    renderWithProviders(<SurveyBoard kind="FORM" />);

    const card = within(
      (await screen.findByText(SURVEY.title)).closest('[data-ui="card"]') as HTMLElement,
    );

    // The date, the state as a plain coloured word, the title, the count, the
    // percentage, and the category in the footer.
    expect(card.getByText("2026.09.02")).toBeInTheDocument();
    expect(card.getByText("Нийтэлсэн")).toHaveClass("text-mint-ink");
    expect(card.getByText(SURVEY.title)).toBeInTheDocument();
    expect(card.getByText("0 / 0 хариулсан")).toBeInTheDocument();
    expect(card.getByText("0%")).toBeInTheDocument();
    expect(card.getByText("Сэтгэл ханамжийн судалгаа")).toBeInTheDocument();

    // …and nothing else. The audience and the question count were the two
    // lines the drawing has no room for.
    expect(card.queryByText("Бүх бүлэг")).not.toBeInTheDocument();
    expect(card.queryByText(/асуулт$/)).not.toBeInTheDocument();
    // One decorative graphic on the card — the chevron. The category icon tile
    // and the two badges are what used to bring the colour.
    expect(card.queryByText("Судалгаа")).not.toBeInTheDocument();
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
  it("hides management-created surveys from a teacher", async () => {
    const teacherId = "11111111-1111-4111-8111-111111111111";
    const teacherSurvey = {
      ...SURVEY,
      id: "99999999-9999-4999-8999-999999999991",
      title: "Багшийн судалгаа",
      createdById: teacherId,
    };
    const managementSurvey = {
      ...SURVEY,
      id: "99999999-9999-4999-8999-999999999992",
      title: "Удирдлагын судалгаа",
      createdById: "99999999-9999-4999-8999-999999999999",
    };

    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"], teacherId) },
      {
        path: `/kindergartens/${KINDERGARTEN_ID}/surveys`,
        body: [managementSurvey, teacherSurvey],
      },
    ]);
    renderWithProviders(<SurveyBoard kind="FORM" />);

    expect(await screen.findByText(teacherSurvey.title)).toBeInTheDocument();
    expect(screen.queryByText(managementSurvey.title)).not.toBeInTheDocument();
  });

  it("shows management only its own surveys on the main board", async () => {
    const adminId = "99999999-9999-4999-8999-999999999999";
    const managementSurvey = {
      ...SURVEY,
      id: "99999999-9999-4999-8999-999999999993",
      title: "Удирдлагын өөрийн судалгаа",
      createdById: adminId,
    };
    const teacherSurvey = {
      ...SURVEY,
      id: "99999999-9999-4999-8999-999999999994",
      title: "Бүлгийн багшийн судалгаа",
      createdById: "11111111-1111-4111-8111-111111111111",
    };

    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"], adminId) },
      {
        path: `/kindergartens/${KINDERGARTEN_ID}/surveys`,
        body: [teacherSurvey, managementSurvey],
      },
    ]);
    renderWithProviders(<SurveyBoard kind="FORM" />);

    expect(await screen.findByText(managementSurvey.title)).toBeInTheDocument();
    expect(screen.queryByText(teacherSurvey.title)).not.toBeInTheDocument();
  });

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

    const dialog = await screen.findByRole("dialog", { name: "Шинэ асуулга" });
    // Nothing in the wizard asks which kind it is: the board decided.
    expect(within(dialog).queryByRole("radio", { name: /Судалгаа/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Шинэ асуулга" })).toBeInTheDocument();
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
