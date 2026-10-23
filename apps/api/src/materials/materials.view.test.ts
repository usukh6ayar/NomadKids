import { describe, expect, it } from "vitest";
import { chargedPrice, platformMaterialView, publicMaterialView } from "./materials.view";
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
      discountPrice: null,
      discountEndsOn: null,
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

describe("«Хямдрал» (№6)", () => {
  const row = (discountEndsOn: string | null) =>
    ({
      id: "22222222-2222-4222-8222-222222222222",
      title: "Өнгө",
      description: null,
      area: "Математик",
      level: null,
      fileType: "PDF",
      price: 10_000,
      discountPrice: 7_500,
      discountEndsOn: discountEndsOn ? new Date(`${discountEndsOn}T00:00:00.000Z`) : null,
      contents: [],
      pages: null,
      published: true,
      previewStatus: "MANUAL",
      originalName: "ongo.pdf",
      previews: [],
    }) as MaterialRow;

  it("charges the discount through its last day, inclusive, and the price after", () => {
    expect(chargedPrice(row("2026-10-31"), "2026-10-31")).toBe(7_500);
    expect(chargedPrice(row("2026-10-31"), "2026-11-01")).toBe(10_000);
    expect(chargedPrice(row(null), "2030-01-01")).toBe(7_500);
  });

  it("shows the operator the stored list price, never the discounted one", () => {
    expect(platformMaterialView(row("2099-12-31"))).toMatchObject({
      price: 10_000,
      discountPrice: 7_500,
      discountEndsOn: "2099-12-31",
    });
  });
});
