import { z } from "zod";
import { milestoneKindSchema } from "@kinder/contracts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");

/**
 * ★ A CUSTOM milestone must be named.
 *
 * RFP §4.5 lets a family invent their own event, which means the seven
 * suggested kinds carry their own label and `CUSTOM` has none — a row with
 * `kind: "CUSTOM"` and no title renders as "Өөрийн үйл явдал" and tells the
 * family nothing about their own memory. The other kinds may still override the
 * suggested wording, which is why `title` is optional rather than forbidden
 * there.
 */
const milestoneBody = z.object({
  kind: milestoneKindSchema,
  title: z.string().min(1).max(200).nullable().optional(),
  occurredOn: isoDate,
  description: z.string().max(2000).nullable().optional(),
});

const requireTitleForCustom = {
  check: (body: { kind: string; title?: string | null }) =>
    body.kind !== "CUSTOM" || Boolean(body.title?.trim()),
  message: "Өөрийн үйл явдалд нэр өгнө үү",
  path: ["title"] as const,
};

export const createMilestoneSchema = milestoneBody.strict().refine(requireTitleForCustom.check, {
  message: requireTitleForCustom.message,
  path: [...requireTitleForCustom.path],
});
export type CreateMilestoneDto = z.infer<typeof createMilestoneSchema>;

/**
 * Every field optional — a PATCH that sends only a description must not blank
 * the date. The CUSTOM rule is re-checked only when `kind` is being changed,
 * because a partial update that touches nothing else cannot break it.
 */
export const updateMilestoneSchema = milestoneBody
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" })
  .refine((body) => body.kind === undefined || requireTitleForCustom.check(body as never), {
    message: requireTitleForCustom.message,
    path: [...requireTitleForCustom.path],
  });
export type UpdateMilestoneDto = z.infer<typeof updateMilestoneSchema>;
