/**
 * Loads the reference ingredients and technology cards into one kindergarten.
 *
 * ★ Takes a kindergarten id rather than guessing one. A script that picks "the
 * first kindergarten" is correct exactly once — on a deployment with a single
 * tenant — and silently wrong the day a second one is registered, which is the
 * day nobody is watching it.
 *
 * ★★ Idempotent by name. Run it twice and the second run reports what already
 * exists rather than creating a second "Төмс" for the same kitchen to pick
 * between. A cook who has adjusted a quantity keeps their adjustment: this
 * only ever inserts what is missing, and never updates what is there.
 *
 * Run:
 *   KINDERGARTEN_ID=… pnpm --filter @kinder/api exec tsx prisma/seed-kitchen.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { REFERENCE_INGREDIENTS, REFERENCE_RECIPES } from "./kitchen-reference";

loadDotenv({ path: resolve(__dirname, "../../../.env"), quiet: true });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main(): Promise<void> {
  const kindergartenId = process.env.KINDERGARTEN_ID;
  if (!kindergartenId) {
    throw new Error(
      "KINDERGARTEN_ID is not set.\n" +
        '  Find one with: select id, name from kindergartens where "deletedAt" is null;',
    );
  }

  const kindergarten = await prisma.kindergarten.findFirst({
    where: { id: kindergartenId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!kindergarten) throw new Error(`No live kindergarten with id ${kindergartenId}`);

  console.log(`Seeding kitchen reference data into "${kindergarten.name}"…`);

  // ── Ingredients ────────────────────────────────────────────────────────────
  const byName = new Map<string, string>();
  let createdIngredients = 0;

  for (const item of REFERENCE_INGREDIENTS) {
    const existing = await prisma.ingredient.findFirst({
      where: { kindergartenId, name: item.name, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      byName.set(item.name, existing.id);
      continue;
    }

    const created = await prisma.ingredient.create({
      data: {
        kindergartenId,
        name: item.name,
        unit: item.unit,
        caloriesPer100: item.caloriesPer100,
        proteinPer100: item.proteinPer100,
        fatPer100: item.fatPer100,
        carbsPer100: item.carbsPer100,
        allergenTags: item.allergenTags,
        note: "Жишиг утга — гал тогооны нягтлан шалгаж, шаардлагатай бол засна.",
      },
      select: { id: true },
    });
    byName.set(item.name, created.id);
    createdIngredients += 1;
  }

  console.log(
    `  ingredients: ${createdIngredients} created, ${REFERENCE_INGREDIENTS.length - createdIngredients} already there`,
  );

  // ── Recipes ────────────────────────────────────────────────────────────────
  let createdRecipes = 0;
  const skipped: string[] = [];

  for (const recipe of REFERENCE_RECIPES) {
    const existing = await prisma.recipe.findFirst({
      where: { kindergartenId, name: recipe.name, deletedAt: null },
      select: { id: true },
    });
    if (existing) continue;

    /*
     * ★ Every ingredient must resolve before the recipe is written. A card
     * missing one line is worse than no card: the cook reads it as complete,
     * and the calorie total it produces is short by exactly the ingredient
     * nobody noticed was gone.
     */
    const missing = recipe.items.filter((item) => !byName.has(item.name));
    if (missing.length > 0) {
      skipped.push(`${recipe.name} (${missing.map((m) => m.name).join(", ")})`);
      continue;
    }

    await prisma.recipe.create({
      data: {
        kindergartenId,
        name: recipe.name,
        mealKind: recipe.mealKind,
        yieldPortions: recipe.yieldPortions,
        instructions: recipe.instructions,
        // ★★ DRAFT, always. `MealsService` resolves allergens and calories from
        // approved recipes only, so nothing here reaches a parent's screen or
        // an allergy check until a cook has read it and approved it.
        status: "DRAFT",
        ingredients: {
          create: recipe.items.map((item, index) => ({
            ingredientId: byName.get(item.name)!,
            quantity: item.quantity,
            position: index,
          })),
        },
      },
    });
    createdRecipes += 1;
  }

  console.log(
    `  recipes:     ${createdRecipes} created (DRAFT), ${REFERENCE_RECIPES.length - createdRecipes - skipped.length} already there`,
  );
  if (skipped.length > 0) {
    console.log(`  SKIPPED (unresolved ingredients):\n    ${skipped.join("\n    ")}`);
  }

  console.log(
    "\nDone. The recipes are DRAFT — a cook approves each one after checking it\n" +
      "against what this kitchen actually does. Nothing reaches a parent's menu\n" +
      "or the allergy cross-check until then.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
