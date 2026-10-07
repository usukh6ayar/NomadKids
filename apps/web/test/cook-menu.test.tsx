import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, selectOption, sessionFor, stubApi } from "./support/render";
import MenuPage from "@/app/(app)/menu/page";
import { MenuDishEditor, toDraft } from "@/components/menu/menu-dish-editor";

const KG_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Today, in UTC.
 *
 * ★ The week view opens on **today**, not on Monday — `menu/page.tsx` gained
 * `todayIso()` and its weekday labels so a cook lands on the day they are
 * actually cooking. A fixture keyed to Monday is only the day being shown one
 * morning in seven, so anything asserting on the rendered day keys to this.
 */
function todayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10);
}

/** The week the kitchen opens on. Sunday previews the plan beginning Monday. */
function visibleWeekStartIso(): string {
  const today = todayIso();
  const date = new Date(`${today}T00:00:00.000Z`);
  if (date.getUTCDay() === 0) {
    date.setUTCDate(date.getUTCDate() + 1);
  } else {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  }
  return date.toISOString().slice(0, 10);
}

/** Opens the Excel panel, which is a step rather than a permanent block. */
async function openImport(user: ReturnType<typeof userEvent.setup>) {
  // From the week since 2026-10-07: the header's ⋯ and the editing flow are gone.
  await user.click(await screen.findByRole("tab", { name: "7 хоног" }));
  const panel = await screen.findByRole("tabpanel", { name: "7 хоног" });
  await user.click(within(panel).getByRole("button", { name: "Excel оруулах" }));
}

/**
 * The week, stubbed — every request this screen makes, in one place.
 *
 * ★ Added for the 2026-09-11 import tests. The cases above predate it and stub
 * inline; they are left alone rather than rewritten, because what they assert is
 * unrelated and a churned diff hides the change that matters.
 */
function stubWeek(
  roles: ("COOK" | "TEACHER" | "ADMIN")[] = ["COOK"],
  importResult: Record<string, unknown> = {
    dryRun: true,
    days: [
      { date: "2026-03-02", dishes: 2 },
      { date: "2026-03-03", dishes: 2 },
    ],
    dishCount: 4,
    problems: [],
  },
) {
  const today = todayIso();
  const visibleWeekStart = visibleWeekStartIso();
  const menuDay = (date: string) => ({
    id: `44444444-4444-4444-8444-${date.replaceAll("-", "").padEnd(12, "0")}`,
    date,
    dishes: [{ name: "Тараг", allergenTags: [], kind: "BREAKFAST" }],
    totalCalories: null,
    status: "DRAFT",
    warnings: [],
  });

  return stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    {
      path: `/kindergartens/${KG_ID}/menu/import?dryRun=true`,
      method: "POST",
      body: { ...importResult, dryRun: true },
      status: 201,
    },
    {
      path: `/kindergartens/${KG_ID}/menu/import?dryRun=false`,
      method: "POST",
      body: { ...importResult, dryRun: false },
      status: 201,
    },
    {
      path: `/kindergartens/${KG_ID}/menu/with-warnings`,
      // One real day, so the table has a row to draw rather than its empty
      // state — `WeekTable` shows nothing at all for a week with no dishes.
      body:
        visibleWeekStart === today ? [menuDay(today)] : [menuDay(today), menuDay(visibleWeekStart)],
    },
    {
      path: `/kindergartens/${KG_ID}/menu/`,
      method: "PUT",
      body: {
        id: "44444444-4444-4444-8444-444444444444",
        date: todayIso(),
        dishes: [],
        totalCalories: null,
        status: "DRAFT",
        warnings: [],
      },
    },
  ]);
}

/**
 * The Тогооч role's own screen — client reported (2026-08-30) that it could
 * only ever save a dish's name.
 *
 * ★ The regression this guards against was not cosmetic. `PUT
 * .../menu/:date` **replaces** the day's `dishes` outright
 * (`meals.repository.ts`'s `upsertDay`), and `findAllergenWarnings` only
 * ever produces a warning by reading `dish.allergenTags` — RFP Module 2's
 * one named requirement for this role. A name-only save could never trigger
 * that warning, and it silently erased any `kind`/`allergenTags`/
 * `ingredients`/`calories`/`portions` a teacher had already entered for the
 * same day through `child-menu.tsx`'s own editor. Both screens now share
 * `MenuDishEditor` (`components/menu/menu-dish-editor.tsx`).
 */
describe("the cook's weekly menu", () => {
  it("adds a compact meal from Today and gives lunch two dish rows", async () => {
    const user = userEvent.setup();
    const { calls } = stubWeek();
    renderWithProviders(<MenuPage />);

    await user.click(await screen.findByRole("button", { name: "Хоол нэмэх" }));
    const dialog = await screen.findByRole("dialog", { name: "Хоол нэмэх" });
    await selectOption(user, "Хугацаа", "Үндсэн хоол");

    expect(within(dialog).getByLabelText("1-р хоол")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("2-р хоол")).toBeInTheDocument();
    expect(within(dialog).getAllByLabelText("Илчлэг")).toHaveLength(2);
    expect(within(dialog).getByLabelText("Цаг")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("1-р хоол"), "Шөл");
    await user.type(within(dialog).getByLabelText("2-р хоол"), "Будаа");
    await user.click(within(dialog).getByRole("button", { name: "Нэмэх" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const saved = calls.find((call) => call.method === "PUT")?.body as {
      dishes: { name: string; kind: string; time: string }[];
    };
    expect(saved.dishes.slice(-2)).toEqual([
      expect.objectContaining({ name: "Шөл", kind: "LUNCH", time: "12:40" }),
      expect.objectContaining({ name: "Будаа", kind: "LUNCH", time: "12:40" }),
    ]);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Хоол нэмэх" })).not.toBeInTheDocument(),
    );
  });

  it("shows the allergy warning the cross-check names, per dish", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["COOK"]) },
      {
        path: `/kindergartens/${KG_ID}/menu/with-warnings`,
        body: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            date: todayIso(),
            dishes: [{ name: "Самрын бялуу", allergenTags: ["самар"] }],
            totalCalories: null,
            status: "DRAFT",
            warnings: [
              {
                childId: "55555555-5555-4555-8555-555555555555",
                childName: "Батаа Золбоо",
                dishName: "Самрын бялуу",
                allergenTag: "самар",
                allergen: "Самар",
                severity: "SEVERE",
              },
            ],
          },
        ],
      },
    ]);

    renderWithProviders(<MenuPage />);

    expect(await screen.findByText("Харшлын анхааруулга")).toBeInTheDocument();
    expect(screen.getByText(/Батаа Золбоо — Самар/)).toBeInTheDocument();
  });
});

/**
 * The editor on a screen that has no kitchen — `child-menu.tsx`'s quick edit
 * from inside a child's page.
 *
 * ★ There was no test over this at all, which is how the regression these
 * guard against reached a commit: `cook-menu.test.tsx` above always supplies
 * `kitchen`, and `menu.test.tsx` is the action-menu dropdown, not this. 488
 * tests passed with the bug in place.
 */
describe("the dish editor without a kitchen", () => {
  const linkedDish = [
    {
      name: "Гурилтай шөл",
      kind: "LUNCH" as const,
      allergenTags: ["гурил"],
      ingredients: null,
      calories: 320,
      portions: 1,
      note: null,
      recipeId: "66666666-6666-4666-8666-666666666666",
      photoMediaFileId: null,
    },
  ];

  it("shows a recipe-linked dish's name as text, never as an input", () => {
    renderWithProviders(
      <MenuDishEditor
        draftDishes={toDraft(linkedDish)}
        onChange={() => {}}
        onSave={() => {}}
        saving={false}
        error={null}
      />,
    );

    /*
     * An input here would be a form that lies: `MealsService.saveDay` freezes a
     * recipe-linked dish's name from the card, so anything typed is discarded
     * and the save still reports success.
     */
    expect(screen.queryByRole("textbox", { name: "Хоолны нэр" })).not.toBeInTheDocument();
    expect(screen.getByText("Гурилтай шөл")).toBeInTheDocument();
  });

  it("offers no mode switch — there is nothing to switch to", () => {
    renderWithProviders(
      <MenuDishEditor
        draftDishes={toDraft(linkedDish)}
        onChange={() => {}}
        onSave={() => {}}
        saving={false}
        error={null}
      />,
    );

    expect(screen.queryByRole("group", { name: "Хоолыг хэрхэн оруулах" })).not.toBeInTheDocument();
  });

  it("a free-text dish is still editable", () => {
    renderWithProviders(
      <MenuDishEditor
        draftDishes={toDraft([{ ...linkedDish[0]!, recipeId: null, name: "Гар хоол" }])}
        onChange={() => {}}
        onSave={() => {}}
        saving={false}
        error={null}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Хоолны нэр" })).toHaveValue("Гар хоол");
  });
});

describe("the menu as a spreadsheet", () => {
  /*
    The menu from a spreadsheet, and who may enter one — 2026-09-11.

    ★ The client narrowed writing to COOK and TEACHER: "Багш болон тогооч засаж
    болдог … нягтлан, удирдлага, эцэг эх оруулсан цэсүүдийг зүгээр харна." An
    admin still opens this screen; what they must not be offered is a control
    whose save the API answers with 404.
  */
  it("offers a cook the Excel import from the week", async () => {
    stubWeek();
    const user = userEvent.setup();
    renderWithProviders(<MenuPage />);
    await openImport(user);

    expect(await screen.findByText("Excel-ээр оруулах")).toBeInTheDocument();
  });

  it("★ offers an admin neither the import nor the editor", async () => {
    const user = userEvent.setup();
    stubWeek(["ADMIN"]);
    renderWithProviders(<MenuPage />);

    await screen.findByText("Хоолны цэс");
    await user.click(await screen.findByRole("tab", { name: "7 хоног" }));
    await screen.findByRole("tabpanel", { name: "7 хоног" });
    expect(screen.queryByRole("button", { name: "Excel оруулах" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Засах" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Хадгалах/ })).not.toBeInTheDocument();
  });

  it("a teacher may enter the menu", async () => {
    const user = userEvent.setup();
    stubWeek(["TEACHER"]);
    renderWithProviders(<MenuPage />);
    await openImport(user);

    expect(await screen.findByText("Excel-ээр оруулах")).toBeInTheDocument();
  });

  /** Two presses: the file is checked before anything is written. */
  it("previews the file before writing it", async () => {
    const user = userEvent.setup();
    const { calls } = stubWeek();
    renderWithProviders(<MenuPage />);

    await openImport(user);
    await screen.findByText("Excel-ээр оруулах");
    const input = document.querySelector('input[type=file][accept*=".xlsx"]') as HTMLInputElement;
    await user.upload(input, new File(["PK"], "menu.xlsx"));

    expect(await screen.findByText(/2 өдөр, 4 хоол оруулна/)).toBeInTheDocument();
    // The dry run went up; nothing was written.
    expect(calls.some((call) => call.url.includes("dryRun=true"))).toBe(true);
    expect(calls.some((call) => call.url.includes("dryRun=false"))).toBe(false);

    await user.click(screen.getByRole("button", { name: "Оруулах" }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("dryRun=false"))).toBe(true));
    expect(
      await screen.findByText(/2 өдрийн цэс орууллаа \(2026-03-02 – 2026-03-03\)/),
    ).toBeInTheDocument();
    // The week moves to the imported one, and is read again from the API.
    await waitFor(() =>
      expect(
        calls.some((call) => call.url.includes("from=2026-03-02") && call.method === "GET"),
      ).toBe(true),
    );
    expect(screen.queryByText("Excel-ээр оруулах")).not.toBeInTheDocument();
  });

  it("names the rows it could not read", async () => {
    const user = userEvent.setup();
    stubWeek(["COOK"], {
      dryRun: true,
      days: [],
      dishCount: 0,
      problems: [{ rowNumber: 4, message: "Огноо танигдсангүй" }],
    });
    renderWithProviders(<MenuPage />);

    await openImport(user);
    await screen.findByText("Excel-ээр оруулах");
    const input = document.querySelector('input[type=file][accept*=".xlsx"]') as HTMLInputElement;
    await user.upload(input, new File(["PK"], "menu.xlsx"));

    expect(await screen.findByText(/4-р мөр: Огноо танигдсангүй/)).toBeInTheDocument();
    // Nothing to write, so the confirm button is not offered as usable.
    expect(screen.getByRole("button", { name: "Оруулах" })).toBeDisabled();
  });

  /*
    The client's 2026-09-11 drawing: a title with the week it is showing, one
    row of controls, then the week itself.
  */
  /*
    ★ The landing is the family's screen, unchanged.

    A cook, a teacher and a director open this and see what a parent sees. Every
    editing control is behind "Цэс засах".
  */
  it("opens as the family's own view, with no ⋯ and no view switch", async () => {
    stubWeek();
    renderWithProviders(<MenuPage />);

    expect(await screen.findByRole("tab", { name: "Өнөөдөр" })).toBeInTheDocument();
    // ★ No ⋯ beside the title and no Хүснэгтээр · Жагсаалтаар — 2026-10-07:
    // Өнөөдөр, Маргааш and 7 хоног already carry editing and Excel оруулах.
    expect(screen.queryByRole("button", { name: "Цэс засах" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Хоолны цэсний үйлдэл" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Хүснэгтээр" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excel оруулах" })).not.toBeInTheDocument();
  });

  /*
    ★ The allergy warnings sit above both views.

    They used to live inside the open day's card, which the table does not draw
    — switching to the week hid the one thing here that is about a child's
    safety rather than the kitchen's convenience (RFP Module 2).
  */
  it("keeps the allergy warning visible in the table view", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["COOK"]) },
      {
        path: `/kindergartens/${KG_ID}/menu/with-warnings`,
        body: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            date: todayIso(),
            dishes: [{ name: "Самрын бялуу", allergenTags: ["самар"] }],
            totalCalories: null,
            status: "DRAFT",
            warnings: [
              {
                childId: "55555555-5555-4555-8555-555555555555",
                childName: "Батаа Золбоо",
                dishName: "Самрын бялуу",
                allergenTag: "самар",
                allergen: "Самар",
                severity: "SEVERE",
              },
            ],
          },
        ],
      },
    ]);

    renderWithProviders(<MenuPage />);

    // Still on the table view — no press needed to see it.
    expect(await screen.findByText("Харшлын анхааруулга")).toBeInTheDocument();
    expect(screen.getByText(/Батаа Золбоо — Самар/)).toBeInTheDocument();
  });

  /*
    ★ Editing a sitting without leaving the day — the client's 2026-09-11
    report: on the teacher's Өнөөдөр card they expect a photo button on the
    picture (one camera since 2026-09-25) and "засах, хуулах, устгах" behind a ⋮ beside the time.

    ★★ A parent's screen is unchanged — `family-menu.test.tsx` asserts the same
    card carries none of these when no `actions` are passed.
  */
  it("puts the sitting's controls on the card a teacher reads", async () => {
    const user = userEvent.setup();
    stubWeek();
    renderWithProviders(<MenuPage />);

    const panel = await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    expect(within(panel).getByLabelText("Зураг нэмэх")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: /Өглөөний хоол — үйлдэл/ }));
    expect(screen.getByRole("menuitem", { name: "Засах" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Хуулах/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Устгах" })).toBeInTheDocument();
    // The photograph's removal lives on this menu since 2026-09-25, and only
    // when there is a photograph to remove.
    expect(screen.queryByRole("menuitem", { name: "Зургийг устгах" })).not.toBeInTheDocument();
  });

  /*
    ★ Засах edits in place — 2026-09-11: "засах гэдэг дээр дарахаар өөр цонх руу
    үсрэхгүй байх, бичвэрийг засаж болох болго."
  */
  it("Засах edits the dishes on the card, without leaving it", async () => {
    const user = userEvent.setup();
    const { calls } = stubWeek();
    renderWithProviders(<MenuPage />);

    const panel = await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    await user.click(within(panel).getByRole("button", { name: /Өглөөний хоол — үйлдэл/ }));
    await user.click(screen.getByRole("menuitem", { name: "Засах" }));

    // Still on the same screen.
    expect(screen.queryByText("Хоолны цэс засах")).not.toBeInTheDocument();

    const box = await screen.findByLabelText("Өглөөний хоол — хоолны нэрс");
    expect(box).toHaveValue("Тараг");

    await user.clear(box);
    await user.type(box, "Тараг{Enter}Талх");
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.method === "PUT")!;
    expect((put.body as { dishes: { name: string }[] }).dishes.map((d) => d.name)).toEqual([
      "Тараг",
      "Талх",
    ]);
  });

  it("Болих leaves the dishes as they were", async () => {
    const user = userEvent.setup();
    const { calls } = stubWeek();
    renderWithProviders(<MenuPage />);

    const panel = await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    await user.click(within(panel).getByRole("button", { name: /Өглөөний хоол — үйлдэл/ }));
    await user.click(screen.getByRole("menuitem", { name: "Засах" }));

    await user.type(await screen.findByLabelText("Өглөөний хоол — хоолны нэрс"), " өөрчлөв");
    await user.click(screen.getByRole("button", { name: "Болих" }));

    expect(screen.queryByLabelText("Өглөөний хоол — хоолны нэрс")).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  /** Every one of these writes the whole day back through the one PUT. */
  it("Устгах saves the day without that sitting", async () => {
    const user = userEvent.setup();
    const { calls } = stubWeek();
    renderWithProviders(<MenuPage />);

    const panel = await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    await user.click(within(panel).getByRole("button", { name: /Өглөөний хоол — үйлдэл/ }));
    await user.click(screen.getByRole("menuitem", { name: "Устгах" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.method === "PUT")!;
    expect((put.body as { dishes: unknown[] }).dishes).toEqual([]);
  });

  it("Хуулах saves the sitting twice over", async () => {
    const user = userEvent.setup();
    const { calls } = stubWeek();
    renderWithProviders(<MenuPage />);

    const panel = await screen.findByRole("tabpanel", { name: "Өнөөдөр" });
    await user.click(within(panel).getByRole("button", { name: /Өглөөний хоол — үйлдэл/ }));
    await user.click(screen.getByRole("menuitem", { name: /Хуулах/ }));

    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.method === "PUT")!;
    expect((put.body as { dishes: { name: string }[] }).dishes.map((d) => d.name)).toEqual([
      "Тараг",
      "Тараг",
    ]);
  });

  /*
    ★ The week edits in place too — 2026-09-11: "7 хоногийн дээд талд Excel-ээр
    оруулах, засах гэдэг тэмдэг оруул. Засах руу орохоор өөр хуудас руу үсэрч
    болохгүй."
  */
  it("offers Excel оруулах and Засах above the week", async () => {
    const user = userEvent.setup();
    stubWeek();
    renderWithProviders(<MenuPage />);

    await user.click(await screen.findByRole("tab", { name: "7 хоног" }));
    const panel = await screen.findByRole("tabpanel", { name: "7 хоног" });

    expect(within(panel).getByRole("button", { name: "Excel оруулах" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Засах" })).toBeInTheDocument();
  });

  it("turns the week's cells into text boxes, on the same screen", async () => {
    const user = userEvent.setup();
    stubWeek();
    renderWithProviders(<MenuPage />);

    await user.click(await screen.findByRole("tab", { name: "7 хоног" }));
    const panel = await screen.findByRole("tabpanel", { name: "7 хоног" });

    // Reading: no boxes.
    expect(within(panel).queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Засах" }));

    expect(within(panel).getAllByRole("textbox").length).toBeGreaterThan(0);
    // Still on the week — nothing navigated.
    expect(screen.queryByText("Хоолны цэс засах")).not.toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "Долоо хоногийн цэс" })).toBeInTheDocument();
  });

  /** A cell writes back when it is left, and only when it changed. */
  it("saves a cell on blur, and not when nothing changed", async () => {
    const user = userEvent.setup();
    const { calls } = stubWeek();
    renderWithProviders(<MenuPage />);

    await user.click(await screen.findByRole("tab", { name: "7 хоног" }));
    const panel = await screen.findByRole("tabpanel", { name: "7 хоног" });
    await user.click(within(panel).getByRole("button", { name: "Засах" }));

    const cells = within(panel).getAllByRole("textbox");
    const filled = cells.find((cell) => (cell as HTMLInputElement).value === "Тараг")!;

    // Touched and left unchanged: nothing is written.
    await user.click(filled);
    await user.tab();
    expect(calls.some((call) => call.method === "PUT")).toBe(false);

    await user.clear(filled);
    await user.type(filled, "Тараг, Талх");
    await user.tab();

    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.method === "PUT")!;
    expect((put.body as { dishes: { name: string }[] }).dishes.map((d) => d.name)).toEqual([
      "Тараг",
      "Талх",
    ]);
  });
});
