import { screen, waitFor } from "@testing-library/react";
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

/**
 * Opens the editing flow, and then the day form.
 *
 * ★ The screen opens as the *family's* view since 2026-09-11, at the client's
 * clarification: "эцэг эхийн хоолны цэсний харагдац огт өөрчлөгдөж болохгүй …
 * зөвхөн засах үйл явц". Everything the client drew — the toolbar, the week
 * table, the day form — is behind "Цэс засах".
 */
async function openEdit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Цэс засах" }));
}

/**
 * Opens one day's editor.
 *
 * ★ Editing a day is its own screen since 2026-09-11, the client's second
 * drawing: Цэс засах → Жагсаалтаар → press a day. It has its own toolbar
 * ("← Жагсаалтад буцах"), its own day pager and its own footer, rather than
 * being a form stapled under the week.
 */
async function openList(user: ReturnType<typeof userEvent.setup>) {
  await openEdit(user);
  await user.click(await screen.findByRole("radio", { name: "Жагсаалтаар" }));
  // Any day; the cases below do not depend on which.
  // The strip's buttons are named "Да, 09.07" — see the page's own aria-label.
  const days = await screen.findAllByRole("button", { name: /^(Да|Мя|Лх|Пү|Ба|Бя|Ня), / });
  await user.click(days[0]!);
}

/**
 * Opens a row's detail — ⋮ → Засах.
 *
 * ★ Илчлэг, порц, харшлын шошго and the технологийн карт picker moved behind
 * the row menu on 2026-09-11, at the client's request: the card shows the
 * photograph, the name and what is in the dish, and everything else is one
 * press away. Every case that reaches those fields goes through here.
 */
async function openDetail(user: ReturnType<typeof userEvent.setup>) {
  const menus = await screen.findAllByRole("button", { name: /үйлдэл/ });
  await user.click(menus[0]!);
  await user.click(await screen.findByRole("menuitem", { name: "Засах" }));
}

/** Opens the Excel panel, which is a step rather than a permanent block. */
async function openImport(user: ReturnType<typeof userEvent.setup>) {
  await openEdit(user);
  await user.click(await screen.findByRole("button", { name: "Excel оруулах" }));
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
  return stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    {
      path: `/kindergartens/${KG_ID}/menu/import`,
      method: "POST",
      body: importResult,
      status: 201,
    },
    {
      path: `/kindergartens/${KG_ID}/menu/with-warnings`,
      // One real day, so the table has a row to draw rather than its empty
      // state — `WeekTable` shows nothing at all for a week with no dishes.
      body: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          date: todayIso(),
          dishes: [{ name: "Тараг", allergenTags: [], kind: "BREAKFAST" }],
          totalCalories: null,
          status: "DRAFT",
          warnings: [],
        },
      ],
    },
    {
      path: `/kindergartens/${KG_ID}/menu/`,
      method: "PUT",
      body: {
        id: "44444444-4444-4444-8444-444444444444",
        date: "2026-01-05",
        dishes: [],
        totalCalories: null,
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
  it("saves every field a dish carries, not just its name", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["COOK"]) },
      { path: `/kindergartens/${KG_ID}/menu/with-warnings`, body: [] },
      {
        path: `/kindergartens/${KG_ID}/menu/`,
        method: "PUT",
        body: {
          id: "44444444-4444-4444-8444-444444444444",
          date: "2026-01-05",
          dishes: [],
          totalCalories: null,
        },
      },
    ]);

    renderWithProviders(<MenuPage />);
    await openList(user);

    // One day open at a time, so one "Хоолны цаг нэмэх".
    const addButtons = await screen.findAllByRole("button", { name: "Хоолны цаг нэмэх" });
    await user.click(addButtons[0]!);

    const nameInputs = await screen.findAllByLabelText("Хоолны нэр");
    await user.type(nameInputs[0]!, "Гурилтай шөл");

    await openDetail(user);
    const allergenInputs = screen.getAllByLabelText("Харшлын орц");
    await user.type(allergenInputs[0]!, "сүү, өндөг");

    const calorieInputs = screen.getAllByLabelText("Илчлэг (ккал)");
    await user.type(calorieInputs[0]!, "350");

    const portionInputs = screen.getAllByLabelText("Порц");
    await user.type(portionInputs[0]!, "1");

    await selectOption(user, "Хоолны цаг", "Өдрийн хоол");

    const saveButtons = screen.getAllByRole("button", { name: /Хадгалах/ });
    await user.click(saveButtons[0]!);

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));

    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({
      dishes: [
        {
          name: "Гурилтай шөл",
          kind: "LUNCH",
          allergenTags: ["сүү", "өндөг"],
          ingredients: null,
          calories: 350,
          portions: 1,
        },
      ],
    });
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

  /**
   * ★★ The silent drop, fixed 2026-09-02.
   *
   * `fromDraft` filters out any row whose `name` is blank, and
   * `menuDishInputSchema` requires `name.min(1)`. Picking a технологийн карт
   * set `recipeId` and nothing else, so a freshly added row with a card chosen
   * and no typing had an empty name — and was **removed from the PUT body**.
   * The cook picked a dish, pressed Хадгалах, got a success toast, and the day
   * came back empty.
   *
   * It is the shape of bug this file was created for: the save succeeded, so
   * nothing anywhere reported a problem.
   */
  it("a dish picked from a технологийн карт is saved, not dropped for having no typed name", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["COOK"]) },
      { path: `/kindergartens/${KG_ID}/menu/with-warnings`, body: [] },
      {
        path: `/kindergartens/${KG_ID}/recipes/approved`,
        body: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            name: "Гурилтай шөл",
            yieldPortions: 20,
            mealKind: "LUNCH",
          },
        ],
      },
      {
        path: `/kindergartens/${KG_ID}/menu/`,
        method: "PUT",
        body: {
          id: "44444444-4444-4444-8444-444444444444",
          date: "2026-01-05",
          dishes: [],
          totalCalories: null,
        },
      },
    ]);

    renderWithProviders(<MenuPage />);

    await openList(user);

    const addButtons = await screen.findAllByRole("button", { name: "Хоолны цаг нэмэх" });
    await user.click(addButtons[0]!);

    // A new row opens on "Бэлэн хоол" once there is an approved card to pick.
    await openDetail(user);
    await selectOption(user, "Бэлэн хоол", "Гурилтай шөл");

    const saveButtons = screen.getAllByRole("button", { name: /Хадгалах/ });
    await user.click(saveButtons[0]!);

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));

    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({
      dishes: [
        {
          name: "Гурилтай шөл",
          // The card names its sitting, so the row follows it.
          kind: "LUNCH",
          allergenTags: [],
          ingredients: null,
          calories: null,
          portions: 1,
          recipeId: "66666666-6666-4666-8666-666666666666",
        },
      ],
    });
  });

  /**
   * ★ Discoverability, not capability.
   *
   * The picker used to render only when `recipes.length > 0`. A kindergarten
   * seeded from `kitchen-reference.ts` starts with eight **DRAFT** cards, so
   * `/recipes/approved` is empty and the control was absent entirely — the
   * cook had no way to learn that ready dishes exist. CLAUDE.md §5: an empty
   * state says what to do next.
   */
  it("with no approved card, the picker still appears and says where to make one", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["COOK"]) },
      { path: `/kindergartens/${KG_ID}/menu/with-warnings`, body: [] },
      { path: `/kindergartens/${KG_ID}/recipes/approved`, body: [] },
    ]);

    renderWithProviders(<MenuPage />);

    await openList(user);

    const addButtons = await screen.findAllByRole("button", { name: "Хоолны цаг нэмэх" });
    await user.click(addButtons[0]!);

    await openDetail(user);
    const readyButtons = await screen.findAllByRole("button", { name: /Бэлэн хоол/ });
    // Offered, and visibly unavailable — rather than missing with no explanation.
    expect(readyButtons[0]!).toBeDisabled();

    // Free text is the working path meanwhile, and it is the one selected.
    expect(screen.getAllByRole("button", { name: /Өөрөө бичих/ })[0]!).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByLabelText("Хоолны нэр")[0]!).toBeInTheDocument();
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
  it("offers a cook the Excel import beside the download", async () => {
    stubWeek();
    const user = userEvent.setup();
    renderWithProviders(<MenuPage />);
    await openImport(user);

    expect(await screen.findByText("Excel-ээр оруулах")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excel татах" })).toBeInTheDocument();
  });

  it("★ offers an admin neither the import nor the editor", async () => {
    stubWeek(["ADMIN"]);
    renderWithProviders(<MenuPage />);

    await screen.findByText("Хоолны цэс");
    // No door at all — a director reads the family's view and stays there.
    expect(screen.queryByRole("button", { name: "Цэс засах" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excel оруулах" })).not.toBeInTheDocument();
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
  it("opens as the family's own view, with the editing flow behind a door", async () => {
    stubWeek();
    renderWithProviders(<MenuPage />);

    expect(await screen.findByRole("tab", { name: "Өнөөдөр" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Цэс засах" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Хүснэгтээр" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excel оруулах" })).not.toBeInTheDocument();
  });

  it("opens the editing flow on the week as a table", async () => {
    const user = userEvent.setup();
    stubWeek();
    renderWithProviders(<MenuPage />);
    await openEdit(user);

    expect(await screen.findByText("7 хоногийн хоолны цэсийг удирдах")).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "Долоо хоногийн цэс" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Хоолны цаг нэмэх" })).not.toBeInTheDocument();
  });

  it("shows the day's form once Жагсаалтаар is pressed", async () => {
    const user = userEvent.setup();
    stubWeek();
    renderWithProviders(<MenuPage />);

    await openList(user);
    expect(await screen.findByRole("button", { name: "Хоолны цаг нэмэх" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Долоо хоногийн цэс" })).not.toBeInTheDocument();
    expect(screen.getByText("Хоолны цэс засах")).toBeInTheDocument();
  });

  /*
    ★ The pager is back — a kitchen plans *next* week, which is the whole point
    of the Excel round trip, and a screen fixed to this one could not do it.
  */
  it("pages the week and asks the API for the new range", async () => {
    const user = userEvent.setup();
    const { calls } = stubWeek();
    renderWithProviders(<MenuPage />);

    await openEdit(user);
    await screen.findByRole("table", { name: "Долоо хоногийн цэс" });
    const before = calls.filter((call) => call.url.includes("with-warnings")).length;

    await user.click(screen.getByRole("button", { name: "Дараах долоо хоног" }));

    await waitFor(() =>
      expect(calls.filter((call) => call.url.includes("with-warnings")).length).toBeGreaterThan(
        before,
      ),
    );
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
    ★ The card shows what a cook fills in daily; the rest is one press away.

    Client, 2026-09-11: "яг зураг дээрх шиг бай, гурван цэгээр засаж устгана"
    and "зураг оруулах, устгах ил хялбар бай".
  */
  it("shows the photo, the name and what is in the dish, and hides the rest", async () => {
    const user = userEvent.setup();
    stubWeek();
    renderWithProviders(<MenuPage />);
    await openList(user);
    await user.click((await screen.findAllByRole("button", { name: "Хоолны цаг нэмэх" }))[0]!);

    expect(screen.getAllByLabelText("Хоолны нэр")[0]).toBeInTheDocument();
    expect(screen.getAllByLabelText("Тайлбар (бүтэц, орц)")[0]).toBeInTheDocument();
    // Behind the ⋮ until asked for.
    expect(screen.queryByLabelText("Илчлэг (ккал)")).not.toBeInTheDocument();

    await openDetail(user);
    expect(screen.getAllByLabelText("Илчлэг (ккал)")[0]).toBeInTheDocument();
  });

  /** Both photo controls are on the card, not in a menu. */
  it("puts adding and removing the photo in the open", async () => {
    const user = userEvent.setup();
    stubWeek();
    renderWithProviders(<MenuPage />);
    await openList(user);
    await user.click((await screen.findAllByRole("button", { name: "Хоолны цаг нэмэх" }))[0]!);

    expect(screen.getAllByText("Зураг нэмэх")[0]).toBeInTheDocument();
    // Nothing to remove yet, so no Устгах beside it.
    expect(screen.queryByRole("button", { name: "Зургийг устгах" })).not.toBeInTheDocument();
  });

  it("offers Дээр зөөх only where there is a row above", async () => {
    const user = userEvent.setup();
    stubWeek();
    renderWithProviders(<MenuPage />);
    await openList(user);

    const add = (await screen.findAllByRole("button", { name: "Хоолны цаг нэмэх" }))[0]!;
    await user.click(add);

    // One row: it can go nowhere, so neither move entry is offered.
    await user.click((await screen.findAllByRole("button", { name: /үйлдэл/ }))[0]!);
    expect(screen.queryByRole("menuitem", { name: "Дээр зөөх" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Устгах" })).toBeInTheDocument();
  });

  /*
    ★ Editing a day is its own screen — the client's second drawing.

    Цэс засах → Жагсаалтаар → a day. It carries its own toolbar, its own day
    pager and its own footer, rather than being a form under the week.
  */
  it("opens a day on its own screen, with a way back to the list", async () => {
    const user = userEvent.setup();
    stubWeek();
    renderWithProviders(<MenuPage />);
    await openList(user);

    expect(await screen.findByText("Хоолны цэс засах")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Жагсаалтад буцах" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Дараах өдөр" })).toBeInTheDocument();
    // The week's own controls are not on the day screen.
    expect(screen.queryByRole("radio", { name: "Хүснэгтээр" })).not.toBeInTheDocument();
  });

  it("returns to the list without leaving the editing flow", async () => {
    const user = userEvent.setup();
    stubWeek();
    renderWithProviders(<MenuPage />);
    await openList(user);

    await user.click(screen.getByRole("button", { name: "Жагсаалтад буцах" }));

    expect(await screen.findByRole("radio", { name: "Жагсаалтаар" })).toBeInTheDocument();
    expect(screen.queryByText("Хоолны цэс засах")).not.toBeInTheDocument();
    // Still editing — not thrown back to the family's view.
    expect(screen.queryByRole("button", { name: "Цэс засах" })).not.toBeInTheDocument();
  });

  /** Цуцлах leaves the day, the drawing's pair for Хадгалах. */
  it("pairs Хадгалах with a Цуцлах that leaves the day", async () => {
    const user = userEvent.setup();
    stubWeek();
    renderWithProviders(<MenuPage />);
    await openList(user);

    await user.click(await screen.findByRole("button", { name: "Цуцлах" }));
    expect(screen.queryByText("Хоолны цэс засах")).not.toBeInTheDocument();
  });
});
