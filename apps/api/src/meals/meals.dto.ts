import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");

export const dateParamSchema = z.object({ date: isoDate });
export type DateParam = z.infer<typeof dateParamSchema>;

export const listMenuQuerySchema = z.object({ from: isoDate, to: isoDate });
export type ListMenuQuery = z.infer<typeof listMenuQuerySchema>;

const menuDishInputSchema = z.object({
  name: z.string().min(1).max(200),
  allergenTags: z.array(z.string().min(1).max(60)).max(20).default([]),
});

export const saveMenuDaySchema = z
  .object({
    dishes: z.array(menuDishInputSchema).max(20),
  })
  .strict();
export type SaveMenuDayDto = z.infer<typeof saveMenuDaySchema>;
