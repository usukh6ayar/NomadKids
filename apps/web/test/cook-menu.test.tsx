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
});
