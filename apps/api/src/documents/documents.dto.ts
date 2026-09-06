import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "@kinder/contracts";

export const createDocumentSchema = z
  .object({
    title: z.string().trim().min(1, "Нэрийг оруулна уу").max(200),
    category: z.string().trim().max(80).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    version: z.string().trim().max(40).nullable().optional(),
    /*
      ★ Which group's teachers this is for — 2026-09-06.

      Null (and omitted) is all staff, the same convention `Survey.groupId`
      uses. Optional so every existing caller keeps compiling and keeps meaning
      what it meant: a document filed before the column existed is a document
      for everybody, which is what all of them were.
    */
    groupId: uuidSchema.nullable().optional(),
  })
  .strict();
export type CreateDocumentDto = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = createDocumentSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdateDocumentDto = z.infer<typeof updateDocumentSchema>;

/** RFP §9 — "Ангиллаар шүүх", "Нэрээр хайх", "Bookmark хийх". */
export const listDocumentsQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(100).optional(),
  category: z.string().max(80).optional(),
  bookmarkedOnly: z.coerce.boolean().optional(),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
