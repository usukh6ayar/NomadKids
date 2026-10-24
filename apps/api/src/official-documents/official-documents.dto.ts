import { paginationQuerySchema } from "@kinder/contracts";
import { z } from "zod";

export const OFFICIAL_SOURCE_LEVELS = [
  "official_pdf",
  "official_full_text",
  "official_repository_page",
  "official_notice_only",
  "official_index_only",
] as const;

export const OFFICIAL_AUDIENCES = ["Эрхлэгч", "Арга зүйч", "Багш"] as const;

/** What the operator's form sends — `official-documents-admin.tsx` (`OfficialDocumentInput`). */
export const officialDocumentInputSchema = z
  .object({
    category: z.string().trim().min(1).max(60),
    title: z.string().trim().min(1).max(300),
    year: z.number().int().min(1990).max(2100),
    number: z.string().trim().max(40).nullable().default(null),
    url: z
      .string()
      .trim()
      .url("Холбоос буруу байна")
      .max(1000)
      .refine((u) => u.startsWith("https://"), "Холбоос https://-ээр эхэлнэ"),
    sourceLevel: z.enum(OFFICIAL_SOURCE_LEVELS),
    reviewRequired: z.boolean().default(false),
    audience: z.array(z.enum(OFFICIAL_AUDIENCES)).min(1, "Хэнд зориулсныг сонгоно уу").max(3),
    notes: z.string().trim().max(2000).nullable().default(null),
    featured: z.boolean().default(false),
  })
  .strict();
export type OfficialDocumentInput = z.infer<typeof officialDocumentInputSchema>;

/** A PATCH changes what it names and keeps the rest. */
export const officialDocumentPatchSchema = officialDocumentInputSchema.partial().strict();
export type OfficialDocumentPatch = z.infer<typeof officialDocumentPatchSchema>;

export const listOfficialDocumentsQuerySchema = paginationQuerySchema;
export type ListOfficialDocumentsQuery = z.infer<typeof listOfficialDocumentsQuerySchema>;
