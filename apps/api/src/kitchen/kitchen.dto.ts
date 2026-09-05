import { z } from "zod";
import { paginationQuerySchema } from "@kinder/contracts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");

/**
 * Money, as a decimal string — same reasoning as `funding.dto.ts`'s `money`:
 * a JSON double cannot round-trip `1234.56` exactly, and this is a figure a
 * receipt gets reconciled against.
 */
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Дүн 1234.56 хэлбэртэй байна");

/**
 * A quantity, in an ingredient's own base unit (grams / millilitres / count)
 * — never a JSON number, for the same reason. Non-negative: an order line or
 * a recipe line is always a positive amount of something.
 */
const qty = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, "Тоо хэмжээ 123.45 хэлбэртэй байна");

/** Nutrition per 100 of an ingredient's unit — smaller ceiling than `qty`,
 * since nothing is 100g of itself and also thousands of calories dense. */
const nutritionValue = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, "Тоо 123.45 хэлбэртэй байна")
  .nullable()
  .optional();

export const ingredientUnitSchema = z.enum(["GRAM", "MILLILITER", "PIECE"]);
export const mealKindSchema = z.enum([
  "BREAKFAST",
  "MID_MORNING_SNACK",
  "LUNCH",
  "AFTERNOON_SNACK",
  "EXTRA",
]);

// ── Ingredients ────────────────────────────────────────────────────────────

export const createIngredientSchema = z
  .object({
    name: z.string().trim().min(1, "Орцны нэрийг оруулна уу").max(200),
    unit: ingredientUnitSchema,
    /** One of `INGREDIENT_CATEGORIES` — a string column, not an enum, same
     * reasoning as `documents.dto.ts`'s `category`. */
    category: z.string().trim().max(100).nullable().optional(),
    caloriesPer100: nutritionValue,
    proteinPer100: nutritionValue,
    fatPer100: nutritionValue,
    carbsPer100: nutritionValue,
    allergenTags: z.array(z.string().min(1).max(60)).max(20).default([]),
    note: z.string().max(1000).nullable().optional(),
  })
  .strict();
export type CreateIngredientDto = z.infer<typeof createIngredientSchema>;

export const updateIngredientSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    unit: ingredientUnitSchema.optional(),
    category: z.string().trim().max(100).nullable().optional(),
    caloriesPer100: nutritionValue,
    proteinPer100: nutritionValue,
    fatPer100: nutritionValue,
    carbsPer100: nutritionValue,
    allergenTags: z.array(z.string().min(1).max(60)).max(20).optional(),
    note: z.string().max(1000).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdateIngredientDto = z.infer<typeof updateIngredientSchema>;

/** `q` searches the name; `category` matches one of `INGREDIENT_CATEGORIES`
 * exactly — same shape as `documents.dto.ts`'s list query. */
export const listIngredientsQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
});
export type ListIngredientsQuery = z.infer<typeof listIngredientsQuerySchema>;

// ── Recipes (технологийн карт) ────────────────────────────────────────────

export const recipeIngredientInputSchema = z.object({
  ingredientId: z.string().uuid(),
  quantity: qty,
});

export const createRecipeSchema = z
  .object({
    name: z.string().trim().min(1, "Хоолны нэрийг оруулна уу").max(200),
    mealKind: mealKindSchema.nullable().optional(),
    yieldPortions: z.number().int().min(1, "Дор хаяж 1 порц").max(1000),
    instructions: z.string().max(5000).nullable().optional(),
    ingredients: z.array(recipeIngredientInputSchema).min(1, "Дор хаяж нэг орц оруулна уу").max(60),
  })
  .strict();
export type CreateRecipeDto = z.infer<typeof createRecipeSchema>;

/**
 * ★ Editing an APPROVED recipe's ingredients or yield reverts it to DRAFT —
 * `KitchenService.updateRecipe` does that, not this schema.
 *
 * A batлагдсан technology card is a signed-off document; changing what it
 * actually contains without a fresh approval would let a menu keep showing
 * "Батлагдсан" against ingredients nobody signed off on.
 */
export const updateRecipeSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    mealKind: mealKindSchema.nullable().optional(),
    yieldPortions: z.number().int().min(1).max(1000).optional(),
    instructions: z.string().max(5000).nullable().optional(),
    ingredients: z.array(recipeIngredientInputSchema).min(1).max(60).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdateRecipeDto = z.infer<typeof updateRecipeSchema>;

export const listRecipesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["DRAFT", "APPROVED"]).optional(),
});
export type ListRecipesQuery = z.infer<typeof listRecipesQuerySchema>;

// ── Suppliers ──────────────────────────────────────────────────────────────

export const createSupplierSchema = z
  .object({
    name: z.string().trim().min(1, "Нийлүүлэгчийн нэрийг оруулна уу").max(200),
    registrationNumber: z.string().max(100).nullable().optional(),
    contactPerson: z.string().max(200).nullable().optional(),
    contactPhone: z.string().max(50).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    originNote: z.string().max(1000).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .strict();
export type CreateSupplierDto = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    registrationNumber: z.string().max(100).nullable().optional(),
    contactPerson: z.string().max(200).nullable().optional(),
    contactPhone: z.string().max(50).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    originNote: z.string().max(1000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdateSupplierDto = z.infer<typeof updateSupplierSchema>;

export const listSuppliersQuerySchema = paginationQuerySchema;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

// ── Food orders (Хүнсний захиалга) ────────────────────────────────────────

export const foodOrderLineInputSchema = z.object({
  ingredientId: z.string().uuid(),
  quantity: qty,
  unitPrice: money,
});

export const createFoodOrderSchema = z
  .object({
    supplierId: z.string().uuid(),
    orderDate: isoDate,
    note: z.string().max(1000).nullable().optional(),
    lines: z.array(foodOrderLineInputSchema).min(1, "Дор хаяж нэг орц оруулна уу").max(60),
  })
  .strict();
export type CreateFoodOrderDto = z.infer<typeof createFoodOrderSchema>;

/** Note/date/lines while DRAFT, or a status move to ORDERED/CANCELLED —
 * RECEIVED only happens through `POST .../receive`, which also moves stock. */
export const updateFoodOrderSchema = z
  .object({
    orderDate: isoDate.optional(),
    note: z.string().max(1000).nullable().optional(),
    status: z.enum(["ORDERED", "CANCELLED"]).optional(),
    lines: z.array(foodOrderLineInputSchema).min(1).max(60).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdateFoodOrderDto = z.infer<typeof updateFoodOrderSchema>;

/** Per-line overrides for a short or over-delivery. A line not named here
 * receives exactly what was ordered. */
export const receiveFoodOrderSchema = z
  .object({
    lines: z
      .array(z.object({ lineId: z.string().uuid(), receivedQuantity: qty }))
      .max(60)
      .default([]),
  })
  .strict();
export type ReceiveFoodOrderDto = z.infer<typeof receiveFoodOrderSchema>;

export const listFoodOrdersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"]).optional(),
});
export type ListFoodOrdersQuery = z.infer<typeof listFoodOrdersQuerySchema>;

// ── Stock ──────────────────────────────────────────────────────────────────

/**
 * A manual correction — нэмэлт.md §14's principle applied to stock: never an
 * edit to a past movement, always a new signed row. Positive raises stock,
 * negative lowers it; the service turns the sign into an IN/OUT/ADJUSTMENT
 * `direction` and a positive `quantity` for the ledger.
 */
export const stockAdjustmentSchema = z
  .object({
    ingredientId: z.string().uuid(),
    date: isoDate,
    quantity: z.string().regex(/^-?\d{1,8}(\.\d{1,2})?$/, "Тоо хэмжээ -123.45 хэлбэртэй байна"),
    note: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine((body) => body.quantity !== "0" && !/^0(\.0{1,2})?$/.test(body.quantity), {
    message: "Тохируулгын хэмжээ 0 байж болохгүй",
    path: ["quantity"],
  });
export type StockAdjustmentDto = z.infer<typeof stockAdjustmentSchema>;

export const listStockMovementsQuerySchema = paginationQuerySchema.extend({
  ingredientId: z.string().uuid().optional(),
});
export type ListStockMovementsQuery = z.infer<typeof listStockMovementsQuerySchema>;

// ── Meal servings (Тараалт) ─────────────────────────────────────────────────

/** One group, one day, one sitting. Not paginated — a kindergarten's own
 * groups times five sittings is never large enough to need it, same
 * reasoning as `CatalogService`'s config lists. */
export const listMealServingsQuerySchema = z.object({ date: isoDate });
export type ListMealServingsQuery = z.infer<typeof listMealServingsQuerySchema>;

export const markMealServedSchema = z
  .object({
    groupId: z.string().uuid(),
    date: isoDate,
    kind: mealKindSchema,
  })
  .strict();
export type MarkMealServedDto = z.infer<typeof markMealServedSchema>;

// ── Reports ────────────────────────────────────────────────────────────────

export const kitchenReportsQuerySchema = z.object({ from: isoDate, to: isoDate });
export type KitchenReportsQuery = z.infer<typeof kitchenReportsQuerySchema>;
