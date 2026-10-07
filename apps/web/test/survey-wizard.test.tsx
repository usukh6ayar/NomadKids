import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  selectOption,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import { CreateSurveyWizard } from "@/components/survey/create-survey-wizard";
import { A79_LEVELS, a79Questions } from "@/lib/a79-assessment";
import { PARENT_SURVEY_TEMPLATES } from "@/lib/parent-survey-templates";

const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const NEW_ID = "66666666-6666-4666-8666-666666666666";
const TERM_ID = "77777777-7777-4777-8777-777777777777";

function stubWizard(roles: Parameters<typeof sessionFor>[0] = ["ADMIN"], createFailure?: unknown) {
  const year = new Date().getUTCFullYear();
  return stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    {
      path: "/groups",
      body: {
        items: [{ id: GROUP_ID, name: "Дэлбээ бүлэг", ageBand: "MIDDLE", childCount: 18 }],
        page: 1,
        pageSize: 100,
        total: 1,
        totalPages: 1,
      },
    },
    {
      path: `/kindergartens/${KINDERGARTEN_ID}/terms`,
      body: [
        {
          id: TERM_ID,
          number: 1,
          name: "1-р улирал",
          startsOn: `${year}-01-01`,
          endsOn: `${year}-12-31`,
        },
      ],
    },
    {
      path: `/kindergartens/${KINDERGARTEN_ID}/surveys`,
      method: "POST",
      status: createFailure ? 400 : 201,
      body:
        createFailure ??
        ({
          id: NEW_ID,
          title: "Шинэ",
          category: "PARENT_ENGAGEMENT",
          scope: "CHILD",
          kind: "FORM",
          status: "DRAFT",
          questions: [],
          createdAt: new Date().toISOString(),
        } as const),
    },
    { path: `/surveys/${NEW_ID}/questions`, method: "PUT", body: {} },
    { path: `/surveys/${NEW_ID}/publish`, method: "POST", status: 201, body: {} },
  ]);
}

function open(roles: Parameters<typeof sessionFor>[0] = ["ADMIN"], kind: "FORM" | "POLL" = "FORM") {
  const api = stubWizard(roles);
  renderWithProviders(
    <CreateSurveyWizard kindergartenId={KINDERGARTEN_ID} kind={kind} onClose={() => {}} />,
  );
  return api;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  setParams({});
  setSearchParams("");
});

describe("single-page survey creation", () => {
  it("shows every creation section on one screen without wizard steps", async () => {
    open();
    expect(await screen.findByLabelText(/Гарчиг/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Тайлбар/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Асуулт нэмэх" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Үнэлгээний төрөл" })).toHaveTextContent(
      "Явцын үнэлгээ",
    );
    expect(screen.queryByRole("button", { name: /-р алхам/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Зорилго")).not.toBeInTheDocument();
    expect(screen.queryByText("Нэмэлт тэмдэглэл")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Улирал")).not.toBeInTheDocument();
  });

  it("hides audience from a teacher and selects their group automatically", async () => {
    const user = userEvent.setup();
    const api = open(["TEACHER"]);
    expect(await screen.findByLabelText(/Гарчиг/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Хэнд")).not.toBeInTheDocument();
    await fillQuestion(user);
    await user.type(screen.getByLabelText(/Гарчиг/), "Сэтгэл ханамж");
    await waitFor(() => expect(screen.getByRole("button", { name: "Үүсгэх" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Үүсгэх" }));
    await waitFor(() =>
      expect(findCall(api, "POST", `/kindergartens/${KINDERGARTEN_ID}/surveys`)).toBeDefined(),
    );
    expect(findCall(api, "POST", `/kindergartens/${KINDERGARTEN_ID}/surveys`)!.body).toMatchObject({
      groupId: GROUP_ID,
    });
  });

  it("keeps audience selection for an administrator", async () => {
    open(["ADMIN"]);
    expect(await screen.findByLabelText("Хэнд")).toBeInTheDocument();
  });

  it("shows category and assessment-period validation errors in Mongolian", async () => {
    const user = userEvent.setup();
    stubWizard(["TEACHER"], {
      type: "about:blank",
      title: "Мэдээлэл буруу байна",
      status: 400,
      requestId: "test",
      detail:
        'Invalid option: expected one of "PARENT_ENGAGEMENT"|"SATISFACTION"|"SOCIAL_DEVELOPMENT"|"PHYSICAL_DEVELOPMENT"|"COGNITIVE_DEVELOPMENT"|"HABITS_INDEPENDENCE"|"CLASS_GROUP"|"OTHER". Invalid option: expected one of "BASELINE"|"MIDLINE"|"ENDLINE"',
      errors: {
        category: [
          'Invalid option: expected one of "PARENT_ENGAGEMENT"|"SATISFACTION"|"SOCIAL_DEVELOPMENT"|"PHYSICAL_DEVELOPMENT"|"COGNITIVE_DEVELOPMENT"|"HABITS_INDEPENDENCE"|"CLASS_GROUP"|"OTHER"',
        ],
        period: ['Invalid option: expected one of "BASELINE"|"MIDLINE"|"ENDLINE"'],
      },
    });
    renderWithProviders(
      <CreateSurveyWizard
        kindergartenId={KINDERGARTEN_ID}
        kind="FORM"
        respondent="TEACHER"
        onClose={() => {}}
      />,
    );

    await fillQuestion(user);
    await user.type(screen.getByLabelText(/Гарчиг/), "Хөгжлийн судалгаа");
    await user.click(screen.getByRole("button", { name: "Үүсгэх" }));

    expect(
      await screen.findByText("Ангиллаа зөв сонгоно уу. Үнэлгээний төрлийг зөв сонгоно уу"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Invalid option/)).not.toBeInTheDocument();
  });

  it("removes description from a poll and offers Other", async () => {
    const user = userEvent.setup();
    open(["TEACHER"], "POLL");
    expect(await screen.findByLabelText(/Гарчиг/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Тайлбар/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Үнэлгээний төрөл" }));
    expect(screen.getByRole("option", { name: "Бусад" })).toBeInTheDocument();
  });

  it("automatically saves the current term and selected assessment period", async () => {
    const user = userEvent.setup();
    const api = open(["TEACHER"]);
    await fillQuestion(user);
    await user.type(screen.getByLabelText(/Гарчиг/), "Хөгжлийн судалгаа");
    await user.click(screen.getByRole("combobox", { name: "Үнэлгээний төрөл" }));
    await user.click(screen.getByRole("option", { name: "Үр дүнгийн үнэлгээ" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Үүсгэх" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Үүсгэх" }));
    await waitFor(() =>
      expect(findCall(api, "POST", `/kindergartens/${KINDERGARTEN_ID}/surveys`)).toBeDefined(),
    );
    expect(findCall(api, "POST", `/kindergartens/${KINDERGARTEN_ID}/surveys`)!.body).toMatchObject({
      termId: TERM_ID,
      period: "ENDLINE",
      purpose: null,
      closingNote: null,
    });
  });

  it("starts from a ready template and previews the parent's phone form", async () => {
    const user = userEvent.setup();
    open(["TEACHER"]);

    await user.click(await screen.findByLabelText("Бэлэн загвараас эхлэх"));
    await user.click(screen.getByRole("option", { name: "Эцэг эхийн оролцоо" }));

    expect(screen.getByLabelText(/Гарчиг/)).toHaveValue("Эцэг эхийн оролцооны судалгаа");
    expect(screen.getAllByLabelText(/асуултын текст/)).toHaveLength(12);

    await user.click(screen.getByRole("button", { name: "Урьдчилан харах" }));
    expect(
      screen.getByText("Эцэг эхийн оролцооны судалгаа", { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  /**
   * ★ Client, 2026-10-06: the builder squeezed — template and period are two
   * small pickers on one line, the title, audience and category carry their
   * names inside them, no «Ноорог автоматаар хадгалагдана», no visible
   * «1-р асуултын текст», «Хариултын хэлбэр» on one line with its picker,
   * and «Урьдчилан харах» is an eye at the foot.
   */
  it("is compact: small pickers, no extra captions, the preview an eye at the foot", async () => {
    const user = userEvent.setup();
    open(["TEACHER"]);
    if (!screen.queryByLabelText(/асуултын текст/)) {
      await user.click(await screen.findByRole("button", { name: "Асуулт нэмэх" }));
    }

    const template = await screen.findByLabelText("Бэлэн загвараас эхлэх");
    const period = screen.getByRole("combobox", { name: "Үнэлгээний төрөл" });
    expect(template.parentElement).toBe(period.parentElement);
    // Ангилал sits on that line too, above the title (2026-10-06).
    const category = screen.getByRole("combobox", { name: "Ангилал" });
    expect(category.parentElement).toBe(period.parentElement);
    expect(
      category.compareDocumentPosition(screen.getByLabelText(/Гарчиг/)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText(/Загварыг сонгосны дараа/)).toBeNull();
    expect(screen.queryByText("Ноорог автоматаар хадгалагдана.")).toBeNull();

    // The labels are there for a screen reader, not on screen.
    expect(screen.getByText("Гарчиг", { selector: "label" })).toHaveClass("sr-only");
    expect(screen.queryByText("1-р асуултын текст")).toBeNull();
    expect(screen.getByLabelText("1-р асуултын текст")).toBeInTheDocument();

    // «Хариултын хэлбэр» shares a line with its picker.
    const typeLabel = screen.getByText("Хариултын хэлбэр");
    expect(typeLabel.parentElement).toContainElement(screen.getByLabelText("Хариултын хэлбэр"));

    // A card's tools: a small glyph on a 40px press target (2026-10-06).
    const copy = screen.getByRole("button", { name: "1-р асуултыг хувилах" });
    expect(copy).toHaveClass("size-10");
    expect(copy.querySelector("svg")).toHaveAttribute("width", "13");

    // The preview is an icon in the footer, beside «Үүсгэх».
    const eye = screen.getByRole("button", { name: "Урьдчилан харах" });
    expect(eye).not.toHaveTextContent("Урьдчилан харах");
    expect(eye.parentElement).toContainElement(screen.getByRole("button", { name: "Үүсгэх" }));
    // Right beside «Ноорог болгох» (2026-10-06).
    expect(eye.nextElementSibling).toBe(screen.getByRole("button", { name: "Ноорог болгох" }));
  });

  /**
   * ★ Client, 2026-10-06: a template chosen, the sheet closed with ×, and the
   * next «Шинэ судалгаа» opened on the same template. × drops the draft.
   */
  it("starts afresh after ×, rather than reopening on the last template", async () => {
    const user = userEvent.setup();
    stubWizard(["TEACHER"]);
    const onClose = vi.fn();
    const first = renderWithProviders(
      <CreateSurveyWizard kindergartenId={KINDERGARTEN_ID} kind="FORM" onClose={onClose} />,
    );

    await user.click(await screen.findByLabelText("Бэлэн загвараас эхлэх"));
    await user.click(screen.getByRole("option", { name: "Эцэг эхийн оролцоо" }));
    expect(screen.getAllByLabelText(/асуултын текст/)).toHaveLength(12);

    await user.click(screen.getByRole("button", { name: "Хаах" }));
    expect(onClose).toHaveBeenCalled();
    first.unmount();

    renderWithProviders(
      <CreateSurveyWizard kindergartenId={KINDERGARTEN_ID} kind="FORM" onClose={() => {}} />,
    );
    expect(await screen.findByLabelText(/Гарчиг/)).toHaveValue("");
    expect(screen.queryAllByLabelText(/асуултын текст/)).toHaveLength(0);
  });

  it("starts afresh after Escape too, not only after ×", async () => {
    const user = userEvent.setup();
    stubWizard(["TEACHER"]);
    const first = renderWithProviders(
      <CreateSurveyWizard kindergartenId={KINDERGARTEN_ID} kind="FORM" onClose={() => {}} />,
    );

    await user.click(await screen.findByLabelText("Бэлэн загвараас эхлэх"));
    await user.click(screen.getByRole("option", { name: "Эцэг эхийн оролцоо" }));
    expect(screen.getAllByLabelText(/асуултын текст/)).toHaveLength(12);

    await user.keyboard("{Escape}");
    first.unmount();

    renderWithProviders(
      <CreateSurveyWizard kindergartenId={KINDERGARTEN_ID} kind="FORM" onClose={() => {}} />,
    );
    expect(await screen.findByLabelText(/Гарчиг/)).toHaveValue("");
    expect(screen.queryAllByLabelText(/асуултын текст/)).toHaveLength(0);
  });

  /** Client, 2026-10-06: a teacher's own survey has no «Нэмэлт тохиргоо». */
  it("offers no «Нэмэлт тохиргоо» on a teacher's own survey", async () => {
    stubWizard(["TEACHER"]);
    renderWithProviders(
      <CreateSurveyWizard
        kindergartenId={KINDERGARTEN_ID}
        kind="FORM"
        respondent="TEACHER"
        onClose={() => {}}
      />,
    );

    await screen.findByLabelText(/Гарчиг/);
    expect(screen.queryByRole("button", { name: /Нэмэлт тохиргоо/ })).toBeNull();
  });

  /**
   * ★ Client, 2026-10-06: the three earlier family templates are gone; the
   * nine questionnaires from their workbook take their place.
   */
  it("offers the client's nine questionnaires and nothing else", async () => {
    const user = userEvent.setup();
    open(["TEACHER"]);

    await user.click(await screen.findByLabelText("Бэлэн загвараас эхлэх"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Загвар сонгох…",
      "Сэтгэл ханамж",
      "Хүүхдийн хөгжил",
      "Шинээр элсэгч",
      "Эрүүл мэнд хоол",
      "Эцэг эхийн оролцоо",
      "Сургалтын хэрэгцээ",
      "Харилцаа мэдээлэл",
      "Сургалтын үр дүн",
      "Хэрэгцээ санал",
    ]);
  });

  it("sends no purpose, and leaves the teacher's Ангилал alone", async () => {
    const user = userEvent.setup();
    const api = open(["TEACHER"]);

    // The teacher picks the kind of survey; the template does not change it.
    await selectOption(user, "Ангилал", "Сэтгэл ханамжийн судалгаа");
    await user.click(await screen.findByLabelText("Бэлэн загвараас эхлэх"));
    await user.click(screen.getByRole("option", { name: "Эцэг эхийн оролцоо" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Үүсгэх" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Үүсгэх" }));

    await waitFor(() =>
      expect(findCall(api, "POST", `/kindergartens/${KINDERGARTEN_ID}/surveys`)).toBeDefined(),
    );
    expect(findCall(api, "POST", `/kindergartens/${KINDERGARTEN_ID}/surveys`)!.body).toMatchObject({
      title: "Эцэг эхийн оролцооны судалгаа",
      category: "SATISFACTION",
      // The workbook's «Зорилго» lines were taken off (2026-10-06).
      purpose: null,
    });
  });

  it("maps the workbook's answer shapes", () => {
    const engagement = PARENT_SURVEY_TEMPLATES.engagement!;
    // «1–5» is stars, «Тийм / Магадгүй / Үгүй» one choice, «бичих» free text.
    expect(engagement.questions[0]!.type).toBe("RATING");
    expect(engagement.questions[4]).toMatchObject({
      type: "SINGLE_CHOICE",
      options: ["Тийм", "Магадгүй", "Үгүй"],
    });
    expect(engagement.questions[7]!.type).toBe("TEXT");
    // A four-step scale is one choice among its words.
    expect(PARENT_SURVEY_TEMPLATES.satisfaction!.questions[0]!.options).toEqual([
      "Огт санал нийлэхгүй",
      "Санал нийлнэ",
      "Сайн",
      "Маш сайн",
    ]);
    expect(
      Object.values(PARENT_SURVEY_TEMPLATES).reduce((sum, t) => sum + t.questions.length, 0),
    ).toBe(142);
  });

  it("duplicates and reorders question cards without leaving the page", async () => {
    const user = userEvent.setup();
    open(["TEACHER"]);
    await user.click(await screen.findByLabelText("Бэлэн загвараас эхлэх"));
    await user.click(screen.getByRole("option", { name: "Эцэг эхийн оролцоо" }));

    await user.click(screen.getByRole("button", { name: "1-р асуултыг хувилах" }));
    expect(screen.getAllByLabelText(/асуултын текст/)).toHaveLength(13);
    await user.click(screen.getByRole("button", { name: "2-р асуултыг доош зөөх" }));
    expect(screen.getAllByLabelText(/асуултын текст/)).toHaveLength(13);
  });

  it("keeps dates and advanced switches out of the main flow", async () => {
    const user = userEvent.setup();
    open(["TEACHER"]);

    await screen.findByLabelText(/Гарчиг/);
    expect(screen.queryByLabelText("Эхлэх огноо")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Хариулт нуух")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Нэмэлт тохиргоо" }));
    expect(screen.getByLabelText("Эхлэх огноо")).toBeInTheDocument();
    expect(screen.getByLabelText("Хариулт нуух")).toBeInTheDocument();
  });

  it("restores a locally autosaved draft", async () => {
    window.localStorage.setItem(
      `nomadkids:survey-draft:${KINDERGARTEN_ID}:FORM`,
      JSON.stringify({
        title: "Хадгалсан ноорог",
        description: "",
        questions: [{ type: "TEXT", prompt: "Санал хүсэлт", options: [] }],
      }),
    );

    open(["TEACHER"]);
    expect(await screen.findByLabelText(/Гарчиг/)).toHaveValue("Хадгалсан ноорог");
    expect(screen.getByLabelText(/асуултын текст/)).toHaveValue("Санал хүсэлт");
  });
});

async function fillQuestion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Асуулт нэмэх" }));
  await user.type(await screen.findByLabelText(/асуултын текст/), "Хүүхэд тань дуртай юу?");
  await user.type(screen.getByLabelText("1-р сонголт"), "Тийм");
  await user.type(screen.getByLabelText("2-р сонголт"), "Үгүй");
}

function findCall(api: ReturnType<typeof stubApi>, method: string, url: string) {
  return api.calls.find((call) => call.method === method && call.url === url);
}

describe("the А/79 assessment, ready for a teacher", () => {
  /*
    ★ The picker only — selecting a level renders 37–49 question editors, which
    takes ~8 s in jsdom and a minute in a full run, starving the files beside
    it (2026-09-22: `finance-dashboard` timed out behind it). What a level
    turns into is asserted on `a79Questions` below, which is pure.
  */
  it("offers the four levels on a teacher survey, and not the families' templates", async () => {
    const user = userEvent.setup();
    stubWizard(["TEACHER"]);
    renderWithProviders(
      <CreateSurveyWizard
        kindergartenId={KINDERGARTEN_ID}
        kind="FORM"
        respondent="TEACHER"
        onClose={() => {}}
      />,
    );

    await user.click(await screen.findByLabelText("Бэлэн загвараас эхлэх"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Загвар сонгох…",
      "А/79 хөгжлийн үнэлгээ — I түвшин (37 шалгуур)",
      "А/79 хөгжлийн үнэлгээ — II түвшин (41 шалгуур)",
      "А/79 хөгжлийн үнэлгээ — III түвшин (46 шалгуур)",
      "А/79 хөгжлийн үнэлгээ — IV түвшин (49 шалгуур)",
    ]);
  });

  it("carries all 173 criteria, each a 0/1 question led by its domain", () => {
    expect(A79_LEVELS.map((level) => level.criteria.length)).toEqual([37, 41, 46, 49]);

    const fourth = a79Questions(A79_LEVELS[3]!);
    expect(fourth).toHaveLength(49);
    expect(fourth.every((q) => q.type === "SINGLE_CHOICE")).toBe(true);
    expect(fourth.every((q) => q.options.join() === "0,1")).toBe(true);
    expect(fourth[0]!.prompt).toBe(
      "Мэдлэг: Аюултай нөхцөлд (галаас хол байх, шатаар болгоомжтой явах г.м) юу хийхийг мэддэг.",
    );
    expect(fourth[48]!.prompt).toBe("Төлөвшил: Дүрийн зан чанарын талаар харилцан ярилцдаг.");
  });
});
