import { describe, expect, it } from "vitest";
import { publicMaterialView } from "./materials.view";
import type { MaterialRow } from "./materials.repository";

describe("public teaching-material view", () => {
  it("uses public sample-image routes and includes the visible price", () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Тоо 1–5",
      description: null,
      area: "Математик",
      level: "II",
      fileType: "PDF",
      price: 12_000,
      contents: [],
      pages: 8,
      published: true,
      previewStatus: "READY",
      originalName: "too.pdf",
      previews: [{ order: 0 }],
    } as MaterialRow;

    expect(publicMaterialView(row)).toMatchObject({
      price: 12_000,
      previewUrl: "/public/materials/11111111-1111-4111-8111-111111111111/previews/0",
      previewUrls: ["/public/materials/11111111-1111-4111-8111-111111111111/previews/0"],
    });
  });
});
