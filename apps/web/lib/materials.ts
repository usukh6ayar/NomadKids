import { z } from "zod";
import { paginated } from "@kinder/contracts";

/**
 * Сургалтын хэрэглэгдэхүүн — ready-made lesson presentations NomadKids makes
 * and sells to teachers, one by one, through QPay — 2026-10-09, the client:
 *
 *   1. QPay may charge for this too — the 2026-09-01 rule that QPay charges
 *      only the portal access fee is widened by the client, in writing;
 *   2. bought one at a time;
 *   3. PDF and PowerPoint;
 *   4. teachers only — not a director, not a family;
 *   5. no e-receipt.
 *
 * ★ The contract the backend is asked for — nothing answers it yet. Kept in
 * the web app until it lands in `@kinder/contracts`, as `lib/feedback.ts` was:
 *
 *   GET  /materials?area=&level=&page=&pageSize= → materialListSchema   (TEACHER)
 *   GET  /me/materials                           → materialSchema[]     (TEACHER — what they own)
 *   POST /materials/:id/qpay                     → qpayInvoiceAttemptSchema (TEACHER)
 *   GET  /materials/:id/qpay                     → the latest attempt, polled while PENDING
 *   GET  /materials/:id/download                 → 302 to a 5-minute presigned URL
 *
 * The platform operator keeps the catalog (`/platform/materials`, super-admin):
 *
 *   GET    /platform/materials                → platformMaterialSchema[]
 *   POST   /platform/materials                ← multipart: file (PDF/PPT/PPTX),
 *                                               previews (0–6 images, repeated part),
 *                                               contents (one line each), title,
 *                                               description?, area, level?, price,
 *                                               published
 *   PUT    /platform/materials/:id            ← the same; a file part only to replace it
 *   DELETE /platform/materials/:id            — hides it from the shop; whoever
 *                                               bought it keeps it (a soft delete)
 *
 * ★ Phase 2 — sample pages made by the server, 2026-10-09: when the operator
 * asks for it (`autoPreview=true` on the upload) the server renders the first
 * `AUTO_PREVIEW_PAGES` pages of the file to reduced, watermarked pictures on
 * a BullMQ job (CLAUDE.md §6 — a PowerPoint goes through PDF first, with
 * LibreOffice on the worker). Until it finishes, `previewStatus` says so:
 *
 *   POST /platform/materials/:id/previews/regenerate   → 202, status back to PENDING
 *
 * ★★ Security, as for every file (CLAUDE.md §1.4, §1.7): the bucket is
 * private; `download` checks ownership first and answers 404 to anyone who
 * has not bought it — the same 404 as for a material that does not exist.
 * A purchase belongs to the teacher's user, not their kindergarten, so it
 * follows them if they move. The fee is the platform's revenue: no `Payment`
 * row in any kindergarten's ledger, as with the access fee.
 */

export const MATERIAL_LEVELS = ["I", "II", "III", "IV"] as const;
export type MaterialLevel = (typeof MATERIAL_LEVELS)[number];

export const MATERIAL_FILE_TYPES = ["PDF", "PPT"] as const;

export const materialSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  /** One of the seven learning areas, by its standard name. */
  area: z.string(),
  level: z.enum(MATERIAL_LEVELS).nullish(),
  fileType: z.enum(MATERIAL_FILE_TYPES),
  /** Whole tugrik. */
  price: z.number().int().nonnegative(),
  /** A preview picture, served through `/media/:id` like every image. */
  previewUrl: z.string().nullish(),
  /**
   * ★ Sample pages to look at before buying — 2026-10-09, the client: "багш
   * авах зүйлээ ямархуу гэдгийг ерөнхий харж болно". Reduced pictures the
   * operator uploads, never the file itself: a whole PDF shown "view only"
   * is a PDF anyone can save. The first is the card's cover when there is no
   * `previewUrl`. Watermarking them is the server's job.
   */
  previewUrls: z.array(z.string()).default([]),
  /** «Агуулга» — what is inside, a line each. */
  contents: z.array(z.string()).default([]),
  pages: z.number().int().nullish(),
  /** Whether the reader already bought it. */
  owned: z.boolean().default(false),
});
export type Material = z.infer<typeof materialSchema>;

export const materialListSchema = paginated(materialSchema);
export const ownedMaterialsSchema = z.array(materialSchema);

export const MATERIALS_NOT_READY =
  "Сургалтын хэрэглэгдэхүүний дэлгүүр удахгүй нээгдэнэ. Одоохондоо худалдан авах боломжгүй.";

/** «12,000₮». */
export function materialPrice(price: number): string {
  return price === 0 ? "Үнэгүй" : `${price.toLocaleString("en-US")}₮`;
}

/** Sample catalog, shown under a banner while the endpoint is missing. */
export const DEMO_MATERIALS: Material[] = [
  {
    id: "demo-m1",
    title: "Тоо 1–5: тоолж, харьцуулъя",
    description: "Тоо тоолох, их бага харьцуулах 12 слайд, дасгалын хуудастай.",
    area: "Математик",
    level: "II",
    fileType: "PPT",
    price: 12_000,
    pages: 12,
    previewUrls: [],
    contents: ["1–5 хүртэл тоолох", "Их, бага харьцуулах", "Дасгалын хуудас"],
    owned: false,
  },
  {
    id: "demo-m2",
    title: "Миний гэр бүл — ярилцлагын зурагт карт",
    description: "Тойргийн цагт ашиглах 20 зурагт карт, асуултын санаатай.",
    area: "Хэл яриа",
    level: "III",
    fileType: "PDF",
    price: 8_000,
    pages: 20,
    previewUrls: [],
    contents: ["Гэр бүлийн гишүүдийн карт", "Тойргийн цагийн асуултууд"],
    owned: false,
  },
  {
    id: "demo-m3",
    title: "Улирлын өөрчлөлт: намар",
    description: "Байгалийн ажиглалтын үзүүлэн, гадаа хийх даалгавартай.",
    area: "Байгаль, нийгмийн орчин",
    level: "IV",
    fileType: "PPT",
    price: 15_000,
    pages: 16,
    previewUrls: [],
    contents: ["Намрын шинж", "Гадаа ажиглалтын даалгавар", "Зурж тэмдэглэх хуудас"],
    owned: false,
  },
  {
    id: "demo-m4",
    title: "Хэмнэл мэдэрье — хөгжмийн тоглоомууд",
    description: "Алга таших, хөдөлгөөнт хэмнэлийн 10 тоглоом.",
    area: "Хөгжим",
    level: "I",
    fileType: "PDF",
    price: 6_000,
    pages: 10,
    previewUrls: [],
    contents: ["Алга ташилтын тоглоомууд", "Хөдөлгөөнт хэмнэл"],
    owned: false,
  },
];

/** How many pages the server renders as samples. */
export const AUTO_PREVIEW_PAGES = 3;

export const PREVIEW_STATUSES = ["MANUAL", "PENDING", "READY", "FAILED"] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];
export const PREVIEW_STATUS_LABEL: Record<PreviewStatus, string> = {
  MANUAL: "Гараар",
  PENDING: "Үүсгэж байна…",
  READY: "Бэлэн",
  FAILED: "Амжилтгүй",
};

/** The operator's view of one material: whether it is on sale, and how it sold. */
export const platformMaterialSchema = materialSchema.omit({ owned: true }).extend({
  published: z.boolean(),
  sales: z.number().int().default(0),
  fileName: z.string().nullish(),
  /** Whose sample pages these are — uploaded by hand, or the server's job. */
  previewStatus: z.enum(PREVIEW_STATUSES).default("MANUAL"),
});
export type PlatformMaterial = z.infer<typeof platformMaterialSchema>;
export const platformMaterialsSchema = z.array(platformMaterialSchema);

/** PDF or PowerPoint, by the file's name — the server decides by its content. */
export function fileTypeOf(name: string): "PDF" | "PPT" | null {
  if (/\.pdf$/i.test(name)) return "PDF";
  if (/\.pptx?$/i.test(name)) return "PPT";
  return null;
}
