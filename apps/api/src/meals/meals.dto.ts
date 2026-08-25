import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");

export const dateParamSchema = z.object({ date: isoDate });
export type DateParam = z.infer<typeof dateParamSchema>;

export const listMenuQuerySchema = z.object({ from: isoDate, to: isoDate });
export type ListMenuQuery = z.infer<typeof listMenuQuerySchema>;

/**
 * One dish on a day's menu — `нэмэлт.md` §12.
 *
 * §12 asks for a name, ingredients, a date, a meal kind and a note. The date is
 * the row's own (`MenuDay.date`), and the rest live here inside the `dishes`
 * JSON — a dish is a line on a menu, not an entity anything else points at.
 *
 * `ingredients` is separate from `allergenTags` on purpose: the tags are what
 * the allergy cross-check matches on and stay a short controlled list, while
 * the ingredients are the cook's full recipe line. Merging them would either
 * bury the tags in prose or turn every ingredient into a warning.
 */
const menuDishInputSchema = z.object({
  name: z.string().min(1).max(200),
  allergenTags: z.array(z.string().min(1).max(60)).max(20).default([]),
  kind: z.enum(["BREAKFAST", "LUNCH", "AFTERNOON_SNACK", "EXTRA"]).optional(),
  ingredients: z.string().max(1000).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
});

export const saveMenuDaySchema = z
  .object({
    dishes: z.array(menuDishInputSchema).max(20),
  })
  .strict();
export type SaveMenuDayDto = z.infer<typeof saveMenuDaySchema>;

// ── The meal register — нэмэлт.md §2 ─────────────────────────────────────────

export const mealKindSchema = z.enum(["BREAKFAST", "LUNCH", "AFTERNOON_SNACK", "EXTRA"]);
export const mealStatusSchema = z.enum(["TAKEN", "NOT_TAKEN", "PARTIAL", "SPECIAL"]);

/**
 * A whole group's meals for one sitting, in one request — §2's "нэг дэлгэцээс
 * хурдан бүртгэх".
 *
 * ★ A batch, not one request per child.
 *
 * A teacher marks twenty children at a serving hatch with the queue waiting.
 * Twenty round trips over a kindergarten's connection is the difference between
 * a usable screen and a form nobody fills in — and a half-completed batch is
 * exactly the state a per-child endpoint leaves behind when the connection
 * drops mid-list.
 */
export const recordGroupMealsSchema = z
  .object({
    date: isoDate,
    kind: mealKindSchema,
    entries: z
      .array(
        z.object({
          childId: z.string().uuid(),
          status: mealStatusSchema,
          note: z.string().max(500).nullable().optional(),
        }),
      )
      .min(1, "Хүүхэд сонгоно уу")
      .max(100),
  })
  .strict();
export type RecordGroupMealsDto = z.infer<typeof recordGroupMealsSchema>;

export const groupMealSheetQuerySchema = z.object({ date: isoDate, kind: mealKindSchema });
export type GroupMealSheetQuery = z.infer<typeof groupMealSheetQuerySchema>;

/** A child's month — what a cost calculation counts. */
export const mealSummaryQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Сар YYYY-MM хэлбэртэй байна"),
});
export type MealSummaryQuery = z.infer<typeof mealSummaryQuerySchema>;
