import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, selectOption, sessionFor, stubApi } from "./support/render";
import MenuPage from "@/app/(app)/menu/page";

const KG_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Mirrors `(app)/menu/page.tsx`'s own `mondayOf` — the page's Monday card, not "today". */
function mondayOfThisWeek(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
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

    // Every day starts empty until seeded — first in DOM order is Monday.
    const addButtons = await screen.findAllByRole("button", { name: "Хоол нэмэх" });
    await user.click(addButtons[0]!);

    const nameInputs = await screen.findAllByLabelText("Хоолны нэр");
    await user.type(nameInputs[0]!, "Гурилтай шөл");

    const allergenInputs = screen.getAllByLabelText("Харшлын орц");
    await user.type(allergenInputs[0]!, "сүү, өндөг");

    const calorieInputs = screen.getAllByLabelText("Илчлэг (ккал)");
    await user.type(calorieInputs[0]!, "350");

    const portionInputs = screen.getAllByLabelText("Порц");
    await user.type(portionInputs[0]!, "1");

    await selectOption(user, "Хоолны цаг", "Үдийн хоол");

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
            date: mondayOfThisWeek(),
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

    const addButtons = await screen.findAllByRole("button", { name: "Хоол нэмэх" });
    await user.click(addButtons[0]!);

    // A new row opens on "Бэлэн хоол" once there is an approved card to pick.
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

    const addButtons = await screen.findAllByRole("button", { name: "Хоол нэмэх" });
    await user.click(addButtons[0]!);

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
