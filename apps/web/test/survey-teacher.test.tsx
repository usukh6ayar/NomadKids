import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROUTER,
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import SurveysChooserPage from "@/app/(app)/surveys/page";
import ParentSurveysHubPage from "@/app/(app)/surveys/parents/page";
import TeacherSurveysPage from "@/app/(app)/surveys/teacher/page";
import TeacherSheetPage from "@/app/(app)/surveys/[surveyId]/fill/page";

/**
 * "Багшийн судалгаа" — client, 2026-09-21. The first screen asks who fills the
 * survey in; the teacher's own list is filed by wave like the families' hub;
 * and neither list shows the other's surveys.
 */

const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";

const FAMILY_FORM = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Намрын эцэг эхийн уулзалт",
  description: null,
  category: "SATISFACTION",
  scope: "CHILD",
  kind: "FORM",
  respondent: "GUARDIAN",
  status: "PUBLISHED",
  period: "BASELINE",
  questions: [],
  group: null,
  createdById: USER_ID,
  createdAt: new Date().toISOString(),
  publishedAt: new Date().toISOString(),
  closedAt: null,
};

const TEACHER_BASELINE = {
  ...FAMILY_FORM,
  id: "44444444-4444-4444-8444-444444444444",
  title: "А/79 Гарааны үнэлгээ",
  category: "OTHER",
  respondent: "TEACHER",
  status: "CLOSED",
  group: { id: "55555555-5555-4555-8555-555555555555", name: "Дэлбээ" },
  respondedCount: 12,
  expectedCount: 25,
};

const TEACHER_MIDLINE = {
  ...TEACHER_BASELINE,
  id: "66666666-6666-4666-8666-666666666666",
  title: "Явцын ажиглалт",
  period: "MIDLINE",
  status: "PUBLISHED",
};

function stub(items: Record<string, unknown>[]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/kindergartens/${KINDERGARTEN_ID}/surveys`, body: items },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
  setSearchParams("");
});

describe("the first survey screen", () => {
  it("asks who fills the survey in, and sends each answer to its own list", async () => {
    stub([]);
    renderWithProviders(<SurveysChooserPage />);

    const parents = await screen.findByRole("link", { name: /Эцэг эхээс авах судалгаа/ });
    const teacher = screen.getByRole("link", { name: /Багшийн судалгаа/ });

    expect(parents).toHaveAttribute("href", "/surveys/parents");
    expect(teacher).toHaveAttribute("href", "/surveys/teacher");
    // Plain rows since 2026-09-25 — the name and a chevron, no hint under it.
    expect(teacher).toHaveTextContent(/^Багшийн судалгаа$/);
  });
});

describe("a director's teacher surveys", () => {
  const DELBEE = "55555555-5555-4555-8555-555555555555";
  const NARAN = "77777777-7777-4777-8777-777777777777";

  function stubAdmin() {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/kindergartens/${KINDERGARTEN_ID}/surveys`,
        body: [
          { ...TEACHER_BASELINE, groupId: DELBEE },
          { ...TEACHER_MIDLINE, groupId: NARAN, group: { id: NARAN, name: "Наран" } },
        ],
      },
      {
        path: "/groups",
        body: {
          items: [
            { id: DELBEE, name: "Дэлбээ", ageBand: "MIDDLE", kindergartenId: KINDERGARTEN_ID },
            { id: NARAN, name: "Наран", ageBand: "SENIOR", kindergartenId: KINDERGARTEN_ID },
          ],
          page: 1,
          pageSize: 100,
          total: 2,
          totalPages: 1,
        },
      },
    ]);
  }

  /* No create card; the groups come first — client, 2026-09-25. */
  it("opens on the groups, with no create card", async () => {
    stubAdmin();
    renderWithProviders(<TeacherSurveysPage />);

    const delbee = await screen.findByRole("link", { name: /Дэлбээ.*1 судалгаа/ });
    expect(delbee).toHaveAttribute("href", `/surveys/teacher?group=${DELBEE}`);
    expect(screen.queryByRole("button", { name: "Судалгаа үүсгэх" })).toBeNull();
    expect(screen.queryByText(TEACHER_BASELINE.title)).toBeNull();
  });

  it("lists one group's surveys once a group is chosen", async () => {
    setSearchParams(`group=${DELBEE}`);
    stubAdmin();
    renderWithProviders(<TeacherSurveysPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Дэлбээ" })).toBeInTheDocument();
    expect(await screen.findByText(TEACHER_BASELINE.title)).toBeInTheDocument();
    expect(screen.queryByText(TEACHER_MIDLINE.title)).toBeNull();
    expect(screen.getByRole("link", { name: "Буцах" })).toHaveAttribute("href", "/surveys/teacher");
  });
});

describe("the teacher's surveys", () => {
  /*
    The families' hub, drawn for the teacher — 2026-09-25. One create card and
    no Асуулга: the API refuses a teacher poll, so that card would be a door
    onto an error.
  */
  it("is laid out as the families' hub, with one card that starts a survey", async () => {
    stub([TEACHER_BASELINE]);
    renderWithProviders(<TeacherSurveysPage />);

    const title = await screen.findByRole("heading", { name: "Багшийн судалгаа" });
    const header = title.closest("header")!;
    expect(within(header).getByRole("combobox", { name: "Хичээлийн жил" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Судалгаа үүсгэх" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Шинэ$/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Асуулга/ })).toBeNull();
    expect(await screen.findByRole("heading", { name: "Сүүлийн үүсгэсэн" })).toBeInTheDocument();
  });

  /**
   * ⋯ → Засах · Эксэл татах · Дахин ашиглах · Устгах — client, 2026-09-22.
   * The families' card's own actions, less Оролцоо, which it did not ask for.
   */
  it("offers edit, Excel, reuse and delete from the card's ⋯ menu", async () => {
    const user = userEvent.setup();
    stub([TEACHER_BASELINE]);
    renderWithProviders(<TeacherSurveysPage />);

    await user.click(
      await screen.findByRole("button", { name: `${TEACHER_BASELINE.title} үйлдэл` }),
    );
    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
    expect(labels.map((label) => label.split("Асуулт")[0])).toEqual([
      "Засах",
      "Эксэл татах",
      "Дахин ашиглах",
      "Устгах",
    ]);

    await user.click(screen.getByRole("menuitem", { name: /Засах/ }));
    expect(ROUTER.push).toHaveBeenCalledWith(`/surveys/${TEACHER_BASELINE.id}`);
  });

  it("reuses a teacher survey as a new draft and opens it", async () => {
    const user = userEvent.setup();
    const COPY_ID = "99999999-9999-4999-8999-999999999990";
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/surveys/${TEACHER_BASELINE.id}/clone`,
        method: "POST",
        status: 201,
        body: { ...TEACHER_BASELINE, id: COPY_ID, status: "DRAFT" },
      },
      { path: `/kindergartens/${KINDERGARTEN_ID}/surveys`, body: [TEACHER_BASELINE] },
    ]);
    renderWithProviders(<TeacherSurveysPage />);

    await user.click(
      await screen.findByRole("button", { name: `${TEACHER_BASELINE.title} үйлдэл` }),
    );
    await user.click(screen.getByRole("menuitem", { name: /Дахин ашиглах/ }));

    await vi.waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith(`/surveys/${COPY_ID}`));
    expect(api.calls.some((c) => c.method === "POST" && c.url.endsWith("/clone"))).toBe(true);
  });

  it("asks before deleting, then deletes", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/surveys/${TEACHER_BASELINE.id}`, method: "DELETE", body: {} },
      { path: `/kindergartens/${KINDERGARTEN_ID}/surveys`, body: [TEACHER_BASELINE] },
    ]);
    renderWithProviders(<TeacherSurveysPage />);

    await user.click(
      await screen.findByRole("button", { name: `${TEACHER_BASELINE.title} үйлдэл` }),
    );
    await user.click(screen.getByRole("menuitem", { name: /Устгах/ }));
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);

    const dialog = await screen.findByRole("dialog", { name: /устгах уу/ });
    await user.click(within(dialog).getByRole("button", { name: "Устгах" }));
    await vi.waitFor(() =>
      expect(
        api.calls.some((c) => c.method === "DELETE" && c.url === `/surveys/${TEACHER_BASELINE.id}`),
      ).toBe(true),
    );
  });

  it("lists only teacher surveys, with the group's progress and state", async () => {
    stub([FAMILY_FORM, TEACHER_BASELINE]);
    renderWithProviders(<TeacherSurveysPage />);

    const card = await screen.findByRole("link", { name: /А\/79 Гарааны үнэлгээ/ });
    expect(card).toHaveAttribute("href", `/surveys/${TEACHER_BASELINE.id}`);
    expect(within(card).getByText("Дууссан")).toBeInTheDocument();
    expect(within(card).getByText(/12\/25 хүүхэд/)).toBeInTheDocument();
    expect(screen.queryByText(FAMILY_FORM.title)).toBeNull();
  });

  it("files them by wave, in the URL", async () => {
    const user = userEvent.setup();
    setSearchParams("period=MIDLINE");
    stub([TEACHER_BASELINE, TEACHER_MIDLINE]);
    renderWithProviders(<TeacherSurveysPage />);

    expect(await screen.findByText(TEACHER_MIDLINE.title)).toBeInTheDocument();
    expect(screen.queryByText(TEACHER_BASELINE.title)).toBeNull();
    expect(screen.getByRole("button", { name: "Явцын үнэлгээ" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Бүгд" }));
    expect(ROUTER.replace).toHaveBeenCalledWith("/surveys/teacher", { scroll: false });
  });

  it("says what to do when there are none", async () => {
    stub([FAMILY_FORM]);
    renderWithProviders(<TeacherSurveysPage />);

    expect(await screen.findByText("Багшийн судалгаа алга")).toBeInTheDocument();
  });
});

describe("the families' hub", () => {
  it("does not list a teacher survey", async () => {
    setSearchParams("period=BASELINE");
    stub([FAMILY_FORM, TEACHER_BASELINE]);
    renderWithProviders(<ParentSurveysHubPage />);

    expect((await screen.findAllByText(FAMILY_FORM.title)).length).toBeGreaterThan(0);
    expect(screen.queryByText(TEACHER_BASELINE.title)).toBeNull();
  });
});

describe("filling the whole group as one table", () => {
  const BAT = "77777777-7777-4777-8777-777777777777";
  const SARUUL = "88888888-8888-4888-8888-888888888888";
  const QUESTION = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    order: 0,
    type: "SINGLE_CHOICE",
    prompt: "Өнгө ялгадаг уу?",
    options: ["0", "1"],
  };
  const SURVEY = { ...TEACHER_MIDLINE, questions: [QUESTION] };
  const GROUP = { id: "55555555-5555-4555-8555-555555555555", name: "Дэлбээ" };

  function sheet(rows: Record<string, unknown>[], survey: Record<string, unknown> = SURVEY) {
    return [
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/surveys/${SURVEY.id}/teacher-sheet`, method: "GET", body: { survey, rows } },
    ];
  }

  const bat = {
    child: { id: BAT, firstName: "Бат", lastName: "Болд" },
    group: GROUP,
    response: null,
  };
  const saruul = {
    child: { id: SARUUL, firstName: "Саруул", lastName: null },
    group: GROUP,
    response: {
      id: "99999999-9999-4999-8999-999999999999",
      submittedAt: "2026-09-15T08:00:00.000Z",
      respondent: { id: USER_ID, lastName: "Дорж", firstName: "Сарнай" },
      answers: [{ questionId: QUESTION.id, value: "0" }],
    },
  };

  beforeEach(() => setParams({ surveyId: SURVEY.id }));

  it("draws names down the side and the choices across, with saved answers ticked", async () => {
    stubApi(sheet([bat, saruul]));
    renderWithProviders(<TeacherSheetPage />);

    const [table] = await screen.findAllByRole("table");
    const headers = within(table!)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual(["Хүүхдийн нэр", "0", "1"]);
    expect(within(table!).getByRole("rowheader", { name: "Б.Бат" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Саруул: 0" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Б.Бат: 0" })).not.toBeChecked();
  });

  it("saves only the rows that changed, in one request", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      ...sheet([bat, saruul]),
      { path: `/surveys/${SURVEY.id}/teacher-sheet`, method: "PUT", body: { saved: 1 } },
    ]);
    renderWithProviders(<TeacherSheetPage />);

    await user.click(await screen.findByRole("radio", { name: "Б.Бат: 1" }));
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    const put = await vi.waitFor(() => {
      const call = api.calls.find((c) => c.method === "PUT");
      expect(call).toBeDefined();
      return call!;
    });
    expect(put.body).toEqual({
      responses: [{ childId: BAT, answers: [{ questionId: QUESTION.id, value: "1" }] }],
    });
  });

  it("clears an accidental choice when the teacher presses it again", async () => {
    const user = userEvent.setup();
    stubApi(sheet([bat, saruul]));
    renderWithProviders(<TeacherSheetPage />);

    const choice = await screen.findByRole("radio", { name: "Б.Бат: 1" });
    await user.click(choice);
    expect(choice).toBeChecked();
    expect(screen.getByRole("button", { name: "Хадгалах" })).toBeEnabled();

    await user.click(choice);
    expect(choice).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Хадгалах" })).toBeDisabled();
    expect(screen.getByText("Хүүхэд бүрийн мөрөнд сонголтоо тэмдэглэнэ үү.")).toBeInTheDocument();
  });

  it("will not save a child whose row is only half done", async () => {
    const user = userEvent.setup();
    const second = { ...QUESTION, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", order: 1 };
    stubApi(sheet([bat], { ...SURVEY, questions: [QUESTION, second] }));
    renderWithProviders(<TeacherSheetPage />);

    const [first] = await screen.findAllByRole("radio", { name: "Б.Бат: 1" });
    await user.click(first!);

    expect(screen.getByRole("button", { name: "Хадгалах" })).toBeDisabled();
    expect(screen.getByText(/Дутуу: Б.Бат/)).toBeInTheDocument();
  });

  it("totals each child's score, as the А/79 form's Нийт row does", async () => {
    stubApi(sheet([bat, saruul]));
    renderWithProviders(<TeacherSheetPage />);

    const totals = (await screen.findByText("Нийт")).closest("div")!;
    expect(
      within(totals).getByRole("rowheader", { name: "Б.Бат" }).closest("tr"),
    ).toHaveTextContent("—");
    expect(
      within(totals).getByRole("rowheader", { name: "Саруул" }).closest("tr"),
    ).toHaveTextContent("0 / 1");
  });

  it("saves a large sheet ten children at a time", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 12 }, (_, i) => ({
      child: {
        id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`,
        firstName: `Хүүхэд${i}`,
        lastName: null,
      },
      group: GROUP,
      response: null,
    }));
    const api = stubApi([
      ...sheet(many),
      { path: `/surveys/${SURVEY.id}/teacher-sheet`, method: "PUT", body: { saved: 10 } },
    ]);
    renderWithProviders(<TeacherSheetPage />);

    for (const row of many) {
      await user.click(await screen.findByRole("radio", { name: `${row.child.firstName}: 1` }));
    }
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await vi.waitFor(() => expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    const sizes = api.calls
      .filter((c) => c.method === "PUT")
      .map((c) => (c.body as { responses: unknown[] }).responses.length);
    expect(sizes).toEqual([10, 2]);
  });

  it("is read-only once the survey is closed", async () => {
    stubApi(sheet([bat, saruul], { ...SURVEY, status: "CLOSED" }));
    renderWithProviders(<TeacherSheetPage />);

    expect(await screen.findByRole("radio", { name: "Б.Бат: 1" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Хадгалах" })).toBeNull();
  });
});
