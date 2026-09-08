import { z } from "zod";
import {
  mediaAttributionSchema,
  mediaCategorySchema,
  paginationQuerySchema,
  uuidSchema,
} from "@kinder/contracts";

/**
 * Request shapes for the media endpoints.
 *
 * The category and attribution vocabularies live in `@kinder/contracts` so the
 * gallery's filter chips and this validation cannot drift — the same reason
 * every other list shares its pagination schema.
 */

export const mediaPurposeSchema = z.enum(["CHILD_PHOTO", "OBSERVATION", "REPORT_OUTPUT"]);

/**
 * ★ `GET /children/:id/media` is paginated — CLAUDE.md §3.4.
 *
 * It was not, and a child with six hundred photographs returned six hundred
 * rows and six hundred signed-URL redirects on one screen. It was the only list
 * in the API that did not go through `toSkipTake`.
 *
 * `observationId` arrives with pagination rather than after it: the screen that
 * shows one observation's photos used to fetch the child's whole `OBSERVATION`
 * set and filter in the browser, which page one of twenty-five silently breaks.
 */
export const listMediaQuerySchema = paginationQuerySchema.extend({
  purpose: mediaPurposeSchema.optional(),
  observationId: uuidSchema.optional(),
  category: mediaCategorySchema.optional(),
  age: z.coerce.number().int().min(2).max(5).optional(),
  attribution: mediaAttributionSchema.optional(),
});
export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;

/**
 * Album metadata — RFP §4.4.
 *
 * Every field is `.optional()` (leave alone) and separately `.nullable()`
 * (clear). A PATCH that sends only `caption` must not erase the date the
 * photograph was taken.
 */
export const updateMediaSchema = z
  .object({
    caption: z.string().max(255).nullable().optional(),
    takenAt: z.coerce
      .date()
      .refine((d) => d <= new Date(), { message: "Зураг авсан огноо ирээдүйд байж болохгүй" })
      .nullable()
      .optional(),
    age: z.number().int().min(2).max(5).nullable().optional(),
    category: mediaCategorySchema.nullable().optional(),
    attribution: mediaAttributionSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Өөрчлөх талбар алга",
  });
export type UpdateMediaDto = z.infer<typeof updateMediaSchema>;

/** Metadata a client may attach at upload time. */
export const uploadMetadataSchema = z.object({
  caption: z.string().max(255).nullable().optional(),
  takenAt: z.coerce.date().nullable().optional(),
  age: z.coerce.number().int().min(2).max(5).nullable().optional(),
  category: mediaCategorySchema.nullable().optional(),
  attribution: mediaAttributionSchema.nullable().optional(),
});
export type UploadMetadataDto = z.infer<typeof uploadMetadataSchema>;
