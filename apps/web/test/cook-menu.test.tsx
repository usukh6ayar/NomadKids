import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, selectOption, sessionFor, stubApi } from "./support/render";
import MenuPage from "@/app/(app)/menu/page";

const KG_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Mirrors `(app)/menu/page.tsx`'s own `todayIso` — the page opens on its
 * "Өнөөдөр" quick view by default, not the Monday-anchored week. */
function todayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10);
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

    // The page opens on "Өнөөдөр" by default — one empty day, one button.
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

  /**
   * ★ Regression for 2026-09-04: picking a технологийн карт leaves `name`'s
   * only input replaced by a read-only label (`recipe?.name`), so if the
   * picker's own `onChange` never wrote a `name` into the draft, the dish had
   * no way to ever get one back. `fromDraft` drops any dish whose `name` is
   * still blank before the request is even built (same filter the "blank
   * names are dropped" doc comment on it describes) — so the save silently
   * went out with an empty `dishes: []`, and a `Батлах` after it approved a
   * day that had never actually kept the dish. A cook watching the card after
   * a refresh read that as data lost on restart; it was a dish that was never
   * sent.
   */
  it("saves a recipe-linked dish under the technology card's own name", async () => {
    const user = userEvent.setup();
    const RECIPE_ID = "66666666-6666-4666-8666-666666666666";
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["COOK"]) },
      { path: `/kindergartens/${KG_ID}/menu/with-warnings`, body: [] },
      {
        path: `/kindergartens/${KG_ID}/recipes/approved`,
        body: [{ id: RECIPE_ID, name: "Сүүтэй будаа", yieldPortions: 20 }],
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

    await selectOption(user, "Технологийн карт", "Сүүтэй будаа");

    const saveButtons = screen.getAllByRole("button", { name: /Хадгалах/ });
    await user.click(saveButtons[0]!);

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));

    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({
      dishes: [
        {
          name: "Сүүтэй будаа",
          kind: "BREAKFAST",
          allergenTags: [],
          ingredients: null,
          calories: null,
          portions: 1,
          recipeId: RECIPE_ID,
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
});
