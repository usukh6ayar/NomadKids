import { localDate, type Material, type PlatformMaterial } from "@kinder/contracts";
import type { MaterialRow } from "./materials.repository";

/**
 * The route a sample page is read through — an API path, never a bucket URL
 * (CLAUDE.md §1.4). The web prefixes it with the API origin.
 */
export function previewPath(materialId: string, order: number): string {
  return `/materials/${materialId}/previews/${order}`;
}

/**
 * A shared link is deliberately readable without a session. Keep its preview
 * URLs on the equally public route; pointing it at `previewPath` would make
 * every image on `/m/:id` answer 401 for a signed-out visitor.
 */
export function publicPreviewPath(materialId: string, order: number): string {
  return `/public/materials/${materialId}/previews/${order}`;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Whether the discount runs on `today` (Ulaanbaatar's day, `YYYY-MM-DD`) —
 * through `discountEndsOn` inclusive, or for good with no end.
 */
export function discountRuns(
  row: Pick<MaterialRow, "discountPrice" | "discountEndsOn">,
  today: string = localDate(),
): boolean {
  if (row.discountPrice === null) return false;
  return row.discountEndsOn === null || today <= isoDay(row.discountEndsOn);
}

/**
 * ★ What one purchase is charged today — the one rule the shop's figure, the
 * purchase's amount and the QR all read (№6), so a teacher is never shown
 * one price and charged another.
 */
export function chargedPrice(
  row: Pick<MaterialRow, "price" | "discountPrice" | "discountEndsOn">,
  today: string = localDate(),
): number {
  return discountRuns(row, today) ? row.discountPrice! : row.price;
}

function shared(row: MaterialRow, pathForPreview = previewPath) {
  const previewUrls = row.previews.map((p) => pathForPreview(row.id, p.order));
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    area: row.area,
    level: row.level,
    fileType: row.fileType,
    price: row.price,
    previewUrl: previewUrls[0] ?? null,
    previewUrls,
    contents: row.contents,
    pages: row.pages,
  };
}

/** The shop's price: what is charged today, and the price before it while a discount runs. */
function onSale(row: MaterialRow) {
  const runs = discountRuns(row);
  return {
    price: chargedPrice(row),
    regularPrice: runs ? row.price : null,
    discountEndsOn: runs && row.discountEndsOn ? isoDay(row.discountEndsOn) : null,
  };
}

export function materialView(row: MaterialRow, owned: boolean): Material {
  return { ...shared(row), ...onSale(row), owned };
}

/** The on-sale fields exposed by `GET /public/materials/:id`. */
export function publicMaterialView(row: MaterialRow) {
  return { ...shared(row, publicPreviewPath), ...onSale(row) };
}

/**
 * ★ The operator's row: the STORED list price and discount, never what is
 * charged today — the edit form saves `price` back, and a discounted figure
 * there would cut the list price for good.
 */
export function platformMaterialView(
  row: MaterialRow,
  figures: { sales: number; revenue: number } = { sales: 0, revenue: 0 },
): PlatformMaterial {
  return {
    ...shared(row),
    discountPrice: row.discountPrice,
    discountEndsOn: row.discountEndsOn ? isoDay(row.discountEndsOn) : null,
    published: row.published,
    sales: figures.sales,
    revenue: figures.revenue,
    fileName: row.originalName,
    previewStatus: row.previewStatus,
  };
}
