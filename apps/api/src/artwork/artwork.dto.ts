import { z } from "zod";
import { uuidSchema } from "@kinder/contracts";

export const createComparisonSchema = z
  .object({
    mediaIdA: uuidSchema,
    mediaIdB: uuidSchema,
    conclusion: z.string().trim().min(1, "Дүгнэлт бичнэ үү").max(4000),
  })
  .strict()
  .refine((body) => body.mediaIdA !== body.mediaIdB, {
    // Comparing a work with itself has no earlier and no later, and the
    // "development" it would show is none.
    message: "Хоёр өөр бүтээл сонгоно уу",
    path: ["mediaIdB"],
  });
export type CreateComparisonDto = z.infer<typeof createComparisonSchema>;

/**
 * ★ The field names are `mediaIdA` / `mediaIdB`, not `earlier` / `later`.
 *
 * The service decides which is which from when the work was made, so asking the
 * caller to label them would be asking for a fact the server already has — and
 * a teacher who labelled them backwards would get a comparison that reads as
 * development running in reverse. The stored row is always ordered.
 */

export const updateComparisonSchema = z
  .object({ conclusion: z.string().trim().min(1).max(4000) })
  .strict();
export type UpdateComparisonDto = z.infer<typeof updateComparisonSchema>;
