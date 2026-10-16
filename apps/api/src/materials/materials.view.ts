import type { Material, PlatformMaterial } from "@kinder/contracts";
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

export function materialView(row: MaterialRow, owned: boolean): Material {
  return { ...shared(row), owned };
}

/** The on-sale fields exposed by `GET /public/materials/:id`. */
export function publicMaterialView(row: MaterialRow) {
  return shared(row, publicPreviewPath);
}

export function platformMaterialView(row: MaterialRow, sales: number): PlatformMaterial {
  return {
    ...shared(row),
    published: row.published,
    sales,
    fileName: row.originalName,
    previewStatus: row.previewStatus,
  };
}
