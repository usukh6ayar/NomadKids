/**
 * `MenuDay.dishes` is a `Json` column — its shape is asserted, never
 * guaranteed by the database. Shared by `MealsService` (the menu screen,
 * the allergy cross-check) and `KitchenService` (the nutrition report),
 * which both read the same rows.
 */
export interface MenuDishLike {
  name: string;
  allergenTags: string[];
  kind?: string | null;
  ingredients?: string | null;
  note?: string | null;
  calories?: number | null;
  portions?: number | null;
  /** The технологийн карт this dish was cooked from, if any — see
   * `MealsService.saveDay` for where this gets resolved and frozen in. */
  recipeId?: string | null;
  /** A photograph of the dish as plated — a `MENU_DISH` media id, verified
   * against this kindergarten in `MealsService.saveDay`. */
  photoMediaFileId?: string | null;
}

/** A day written before a field existed lacks it entirely; anything of the
 * wrong type becomes absent rather than crashing the screen that reads it. */
export function parseDishes(value: unknown): MenuDishLike[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const dish = entry as Record<string, unknown>;
    if (typeof dish.name !== "string") return [];

    return [
      {
        name: dish.name,
        allergenTags: Array.isArray(dish.allergenTags)
          ? dish.allergenTags.filter((tag): tag is string => typeof tag === "string")
          : [],
        kind: typeof dish.kind === "string" ? dish.kind : null,
        ingredients: typeof dish.ingredients === "string" ? dish.ingredients : null,
        note: typeof dish.note === "string" ? dish.note : null,
        calories: typeof dish.calories === "number" ? dish.calories : null,
        portions: typeof dish.portions === "number" ? dish.portions : null,
        recipeId: typeof dish.recipeId === "string" ? dish.recipeId : null,
        photoMediaFileId: typeof dish.photoMediaFileId === "string" ? dish.photoMediaFileId : null,
      },
    ];
  });
}
