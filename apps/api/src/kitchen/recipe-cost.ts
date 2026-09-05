import Decimal from "decimal.js";

/**
 * What one portion of a technology card costs — Order А/261, kindergarten
 * criterion 38: "нэг хүүхдэд ногдох хүнсний түүхий эд, бүтээгдэхүүний өртөг".
 *
 * ★ Pure functions over `Decimal`, no database access — `invoice-math.ts`'s
 * shape and `invoice-math.ts`'s reason. A cost figure appears on a card an
 * inspector reads, and it should be possible to prove it right without
 * fixtures.
 *
 * ★★ `decimal.js` directly, never `Prisma.Decimal` (CLAUDE.md §2.2). Prisma's
 * decimal *is* this library underneath, so a repository's values arrive here
 * unchanged; importing the re-export would open the query surface to a pure
 * module for nothing but a type name.
 *
 * ★★★ **The `null` discipline is `sumNutrition`'s, deliberately copied.**
 *
 * An ingredient the kindergarten has never bought has no price. Treating that
 * as zero produces a confidently-too-low cost — a card that says a meal costs
 * 380₮ when two of its five ingredients were simply not counted. That is worse
 * than no figure at all, because nobody can see it is wrong. One unpriced
 * ingredient nulls the whole card, and `unpricedIngredients` names which ones
 * so the screen can say what to do about it.
 */

/** One line of a technology card, as the cost calculation needs it. */
export interface RecipeLineForCost {
  readonly ingredientId: string;
  readonly ingredientName: string;
  /** In the ingredient's own unit — grams, millilitres or a count. */
  readonly quantity: Decimal;
}

export interface RecipeCost {
  /**
   * What the whole card costs to make, or `null` if any ingredient is
   * unpriced. In tögrög, to two places.
   */
  readonly total: string | null;
  /** `total / yieldPortions` — the figure criterion 38 actually asks for. */
  readonly perPortion: string | null;
  /**
   * The ingredients with no purchase history, by name. Empty when `total` is
   * a number; never empty when it is `null` for want of a price.
   */
  readonly unpricedIngredients: readonly string[];
  /**
   * The date the prices were read as of, `YYYY-MM-DD`. Carried so the screen
   * can say "2026-09-01-ний үнээр" rather than presenting a moving number as
   * a fact about the recipe.
   */
  readonly pricedOn: string;
}

/**
 * ★ Prices are **per the ingredient's own unit**, matching
 * `FoodOrderLine.unitPrice`, whose `totalPrice` is `quantity × unitPrice` with
 * `quantity` in that same unit. So a gram-denominated ingredient carries a
 * price per gram and the multiplication below needs no scaling — unlike
 * nutrition, which is per 100 and divides.
 *
 * This is the assumption most likely to be wrong in real data: a cook who
 * types a per-kilogram price into a per-gram field produces a cost 1000× too
 * high, which at least *looks* wrong, rather than 1000× too low, which does
 * not. `costOfRecipe` cannot detect it; the order form's own validation is
 * where that belongs.
 */
export function costOfRecipe(input: {
  lines: readonly RecipeLineForCost[];
  yieldPortions: number;
  /** Ingredient id → price per the ingredient's own unit. Missing = unpriced. */
  prices: ReadonlyMap<string, Decimal>;
  pricedOn: string;
}): RecipeCost {
  const { lines, yieldPortions, prices, pricedOn } = input;

  const unpriced: string[] = [];
  let total = new Decimal(0);

  for (const line of lines) {
    const price = prices.get(line.ingredientId);
    if (price === undefined) {
      unpriced.push(line.ingredientName);
      continue;
    }
    total = total.plus(price.times(line.quantity));
  }

  /*
   * A card with no ingredients costs nothing knowable, not nothing. `0₮` on an
   * empty draft reads as "this meal is free" rather than "nobody has filled
   * this in", and a draft with no lines is the normal state of a card someone
   * started five minutes ago.
   *
   * `yieldPortions` is a required positive Int in the schema, so the guard is
   * belt-and-braces — but a division by zero here would emit `Infinity`, which
   * serialises to `null` through JSON and would arrive at the screen looking
   * exactly like an honest "not priced".
   */
  if (lines.length === 0 || unpriced.length > 0 || yieldPortions <= 0) {
    return { total: null, perPortion: null, unpricedIngredients: unpriced, pricedOn };
  }

  return {
    total: money(total),
    perPortion: money(total.dividedBy(yieldPortions)),
    unpricedIngredients: [],
    pricedOn,
  };
}

/**
 * Two decimal places, half-up — the rounding `Decimal @db.Decimal(12, 2)`
 * stores and the one an accountant expects. Returned as a string so it crosses
 * the HTTP boundary without ever becoming a JavaScript float.
 */
function money(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}
