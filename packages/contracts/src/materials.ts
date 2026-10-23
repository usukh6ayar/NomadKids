import { z } from "zod";
import { uuidSchema } from "./ids";
import { paginated, paginationQuerySchema } from "./pagination";

/**
 * Сургалтын хэрэглэгдэхүүн — ready-made lessons NomadKids sells to teachers,
 * one by one, through QPay (client, 2026-10-09; CLAUDE.md §7). The web app's
 * `lib/materials.ts` asked for this contract before the backend existed; this
 * is the backend's answer, field for field.
 *
 * ★ `previewUrl`/`previewUrls` are **API paths** (`/materials/:id/previews/0`),
 * never bucket URLs: the route checks the reader and only then redirects to a
 * five-minute presigned URL (§1.4). The web prefixes them with the API origin.
 */

export const MATERIAL_LEVELS = ["I", "II", "III", "IV"] as const;
export const materialLevelSchema = z.enum(MATERIAL_LEVELS);
export type MaterialLevel = z.infer<typeof materialLevelSchema>;

export const MATERIAL_FILE_TYPES = ["PDF", "PPT"] as const;
export const materialFileTypeSchema = z.enum(MATERIAL_FILE_TYPES);

export const MATERIAL_PREVIEW_STATUSES = ["MANUAL", "PENDING", "READY", "FAILED"] as const;
export const materialPreviewStatusSchema = z.enum(MATERIAL_PREVIEW_STATUSES);
export type MaterialPreviewStatus = z.infer<typeof materialPreviewStatusSchema>;

/** Sample pages per material — the operator's upload, or the server's. */
export const MATERIAL_PREVIEWS_MAX = 6;
export const MATERIAL_CONTENTS_MAX = 30;

export const materialSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  area: z.string(),
  level: materialLevelSchema.nullable(),
  fileType: materialFileTypeSchema,
  /** Whole tugrik; 0 is free. What a purchase is charged today — the discount while it runs. */
  price: z.number().int().nonnegative(),
  /** The price before the discount, while one runs (№6); otherwise absent. */
  regularPrice: z.number().int().positive().nullish(),
  /** The discount's last day, while one runs with an end. */
  discountEndsOn: z.string().nullish(),
  previewUrl: z.string().nullable(),
  previewUrls: z.array(z.string()),
  contents: z.array(z.string()),
  pages: z.number().int().nullable(),
  /** Whether the reader already owns it. */
  owned: z.boolean(),
});
export type Material = z.infer<typeof materialSchema>;

export const materialListSchema = paginated(materialSchema);
export const ownedMaterialsSchema = z.array(materialSchema);

export const materialListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  area: z.string().trim().max(60).optional(),
  level: materialLevelSchema.optional(),
});
export type MaterialListQuery = z.infer<typeof materialListQuerySchema>;

/** The operator's view: whether it is on sale, and how it sold. */
export const platformMaterialSchema = materialSchema.omit({ owned: true }).extend({
  /** ★ The stored list price here — never the discount: the edit form saves it back. */
  price: z.number().int().nonnegative(),
  /** The stored discount, whether or not it still runs (№6). */
  discountPrice: z.number().int().positive().nullable(),
  discountEndsOn: z.string().nullable(),
  published: z.boolean(),
  sales: z.number().int(),
  /** What its PAID purchases took, ₮ — not `sales × price` (№6). */
  revenue: z.number().int(),
  fileName: z.string().nullable(),
  previewStatus: materialPreviewStatusSchema,
});
export type PlatformMaterial = z.infer<typeof platformMaterialSchema>;
export const platformMaterialsSchema = z.array(platformMaterialSchema);

/** Multipart sends text; one `contents` part arrives as a string, several as an array. */
const formBoolean = z.enum(["true", "false"]).transform((v) => v === "true");
const formLines = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]))
  .pipe(z.array(z.string().trim().min(1).max(200)).max(MATERIAL_CONTENTS_MAX));

/**
 * The text fields of `POST`/`PUT /platform/materials`. The file and the
 * sample pages arrive as multipart file parts beside them.
 */
export const materialFormSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    area: z.string().trim().min(1).max(60),
    level: materialLevelSchema.optional(),
    price: z
      .string()
      .regex(/^\d{1,9}$/, "Үнийг бүхэл төгрөгөөр оруулна уу")
      .transform(Number),
    published: formBoolean.default(true),
    /**
     * The server draws the first pages of the file as the sample pages, on a
     * queue (2026-10-12); any `previews` sent beside it are ignored. Off unless
     * asked — the operator's own pictures are the default (the user,
     * 2026-10-12). Absent on an edit, the material keeps the source it had.
     */
    autoPreview: formBoolean.optional(),
    contents: formLines,
    /**
     * «Хямдрал» — a lower price until a day (backend list №6, 2026-10-23).
     * Absent means no discount: the form is a whole replacement, and its
     * toggle off is none. `discountEndsOn` absent means no end; the day itself
     * is still discounted, in Ulaanbaatar. Checked against `price` below.
     */
    discountPrice: z
      .string()
      .regex(/^\d{1,9}$/, "Хямдралтай үнийг бүхэл төгрөгөөр оруулна уу")
      .transform(Number)
      .optional(),
    discountEndsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Хямдрал дуусах өдрийг оруулна уу")
      .optional(),
  })
  .superRefine((form, ctx) => {
    if (form.discountPrice === undefined) {
      if (form.discountEndsOn !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["discountPrice"],
          message: "Хямдралтай үнийг оруулна уу",
        });
      }
      return;
    }
    if (form.discountPrice <= 0 || form.discountPrice >= form.price) {
      ctx.addIssue({
        code: "custom",
        path: ["discountPrice"],
        message: "Хямдралтай үнэ үндсэн үнээс бага, 0-ээс их байна",
      });
    }
  });
export type MaterialForm = z.infer<typeof materialFormSchema>;
