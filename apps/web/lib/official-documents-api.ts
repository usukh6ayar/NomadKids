"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { MAX_PAGE_SIZE, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { mediaUrl } from "@/lib/api/client";
import {
  OFFICIAL_DOCUMENTS,
  actionLabelFor,
  coverFor,
  type OfficialDocument,
} from "@/lib/official-documents";

/**
 * The official register through the API — built ahead of it, 2026-10-20, the
 * user: "супер админ ... засаж устгаж шинээр нэмж".
 *
 * ★ Built in #274 (2026-10-24): `GET /official-documents` (any
 * kindergarten's staff and the operator), `POST`, `PATCH /:id`, `DELETE /:id`
 * (operator only, soft delete, audited), seeded with the 37 entries of
 * `lib/official-documents.ts`. That list stays only as the fallback while the
 * read loads or fails — the shelf looks the same either way.
 */

export const OFFICIAL_SOURCE_LEVELS = [
  { value: "official_pdf", label: "PDF файл" },
  { value: "official_full_text", label: "Албан бүрэн эх (legalinfo гэх мэт)" },
  { value: "official_repository_page", label: "Албан сангийн хуудас" },
  { value: "official_notice_only", label: "Зөвхөн мэдээ" },
  { value: "official_index_only", label: "Зөвхөн бүртгэл" },
] as const;

export const OFFICIAL_AUDIENCES = ["Эрхлэгч", "Арга зүйч", "Багш"] as const;

const officialDocumentRowSchema = z.object({
  id: z.string(),
  /** The register's own code — «SOB-007» — which keeps a shipped cover matched. */
  code: z.string().nullish(),
  category: z.string(),
  title: z.string(),
  year: z.number().int(),
  number: z.string().nullish(),
  url: z.string().url(),
  sourceLevel: z.enum([
    "official_pdf",
    "official_full_text",
    "official_repository_page",
    "official_notice_only",
    "official_index_only",
  ]),
  reviewRequired: z.boolean().default(false),
  audience: z.array(z.enum(OFFICIAL_AUDIENCES)).min(1),
  notes: z.string().nullish(),
  coverMediaFileId: z.string().nullish(),
  checkedOn: z.string().nullish(),
  featured: z.boolean().default(false),
});

const listSchema = paginated(officialDocumentRowSchema);

/** What the form sends — `POST /official-documents`, `PATCH /official-documents/:id`. */
export type OfficialDocumentInput = {
  category: string;
  title: string;
  year: number;
  number: string | null;
  url: string;
  sourceLevel: OfficialDocument["sourceLevel"];
  reviewRequired: boolean;
  audience: OfficialDocument["audience"];
  notes: string | null;
  featured: boolean;
};

export const OFFICIAL_DOCUMENTS_KEY = ["official-documents"] as const;

/**
 * The register, and where it came from. `source: "code"` is the built-in
 * list — the API is not there yet — and is what the operator's controls key on.
 */
export function useOfficialDocuments(): {
  documents: OfficialDocument[];
  source: "api" | "code";
} {
  const query = useQuery({
    queryKey: OFFICIAL_DOCUMENTS_KEY,
    queryFn: () => get(`/official-documents?page=1&pageSize=${MAX_PAGE_SIZE}`, listSchema),
    retry: false,
    // A register that changes a few times a year: one read an hour is plenty.
    staleTime: 60 * 60_000,
  });

  if (query.data) {
    return {
      source: "api",
      documents: query.data.items.map((row) => ({
        id: row.id,
        category: row.category,
        title: row.title,
        year: row.year,
        number: row.number ?? null,
        url: row.url,
        sourceLevel: row.sourceLevel,
        reviewRequired: row.reviewRequired,
        audience: row.audience,
        notes: row.notes ?? "",
        checkedOn: row.checkedOn ?? "",
        actionLabel: actionLabelFor(row.sourceLevel),
        featured: row.featured,
        cover: row.coverMediaFileId ? mediaUrl(row.coverMediaFileId) : coverFor(row.code ?? row.id),
      })),
    };
  }

  // While it loads, on 404 (not built yet) and on any other failure: the
  // shipped list. A teacher's shelf never goes empty or flickers on its account.
  return { source: "code", documents: OFFICIAL_DOCUMENTS };
}
