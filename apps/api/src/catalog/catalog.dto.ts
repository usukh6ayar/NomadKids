import { z } from "zod";

/**
 * Request shapes for the administrator-editable configuration — RFP §2.1
 * ("Хөгжлийн шалгуур, үнэлгээний мэдээллийг удирдах"), §5.2, §6.1 and §6.2.
 *
 * These three tables existed and were seeded from day one; nothing could edit
 * them. CLAUDE.md §2.3 required them to be tables rather than TypeScript enums
 * precisely so an administrator could, and this is the surface that finally
 * lets them.
 */

/**
 * A stable machine key. Lowercase Latin, because it is compared in code
 * (`parentObservationType` looks one up by code) and a Cyrillic identifier that
 * differs from another by a homoglyph is a bug nobody can see.
 */
const codeSchema = z
  .string()
  .min(2, "Код дор хаяж 2 тэмдэгт байх ёстой")
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, "Код латин жижиг үсэг, тоо, доогуур зураас агуулна");

/** `#rrggbb`. The UI paints chips and chart series with it. */
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Өнгө #rrggbb хэлбэртэй байна");

const nameSchema = z.string().min(1, "Нэрийг оруулна уу").max(120);
const descriptionSchema = z.string().max(500).nullable();
const orderSchema = z.number().int().min(0).max(999);

// ── Development domains ──────────────────────────────────────────────────────

export const createDomainSchema = z.object({
  name: nameSchema,
  code: codeSchema,
  order: orderSchema.default(0),
  color: colorSchema.default("#94a3b8"),
  description: descriptionSchema.optional(),
});
export type CreateDomainDto = z.infer<typeof createDomainSchema>;

/**
 * ★ `code` is absent, deliberately.
 *
 * It is the stable key: renaming a domain is a display change, but re-coding
 * one silently repoints anything that looks it up. A kindergarten that needs a
 * different code deactivates this row and creates another.
 */
export const updateDomainSchema = z
  .object({
    name: nameSchema.optional(),
    order: orderSchema.optional(),
    color: colorSchema.optional(),
    description: descriptionSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdateDomainDto = z.infer<typeof updateDomainSchema>;

// ── Assessment levels ────────────────────────────────────────────────────────

/**
 * 1..4 — "Дэмжлэгтэй" … "Давсан" (RFP §6.2).
 *
 * Bounded rather than free: the level is what a term report and every progress
 * comparison are computed from, and a scale that varies in length between
 * kindergartens makes those numbers incomparable.
 */
const levelValueSchema = z
  .number()
  .int()
  .min(1, "Үнэлгээний түвшин 1-ээс 4 хооронд байна")
  .max(4, "Үнэлгээний түвшин 1-ээс 4 хооронд байна");

export const createLevelSchema = z.object({
  value: levelValueSchema,
  label: nameSchema,
  color: colorSchema.default("#94a3b8"),
  description: descriptionSchema.optional(),
  order: orderSchema.default(0),
});
export type CreateLevelDto = z.infer<typeof createLevelSchema>;

/**
 * ★ `value` is absent for the same reason `code` is, only sharper.
 *
 * Published `Assessment` rows point at this level, and reports render "3 / 4"
 * from it. Editing the number would rewrite what a family was already told
 * about their child last term, with no record that it changed.
 */
export const updateLevelSchema = z
  .object({
    label: nameSchema.optional(),
    color: colorSchema.optional(),
    description: descriptionSchema.optional(),
    order: orderSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdateLevelDto = z.infer<typeof updateLevelSchema>;

// ── Observation types ────────────────────────────────────────────────────────

export const createObservationTypeSchema = z.object({
  name: nameSchema,
  code: codeSchema,
  order: orderSchema.default(0),
});
export type CreateObservationTypeDto = z.infer<typeof createObservationTypeSchema>;

export const updateObservationTypeSchema = z
  .object({
    name: nameSchema.optional(),
    order: orderSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdateObservationTypeDto = z.infer<typeof updateObservationTypeSchema>;
