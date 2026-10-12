import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { makePdf } from "./support/pdf-fixture";
import { AUTO_PREVIEW_PAGES, renderFirstPages } from "../src/materials/material-render";

/*
 * ★ poppler's `pdftoppm` must be installed — the API image and CI both
 * install it. A PowerPoint goes through LibreOffice first; that path is
 * verified inside the built image, where `soffice` exists (see the PR).
 */
describe("renderFirstPages", () => {
  it("draws only the first pages, in order, with what is on them", async () => {
    const pages = await renderFirstPages(makePdf(5), ".pdf");
    expect(pages).toHaveLength(AUTO_PREVIEW_PAGES);

    for (const page of pages) {
      const { width, height } = await sharp(page).metadata();
      expect(Math.max(width!, height!)).toBe(1600);
      // The fixture's black block is drawn — a blank render fails here.
      const { channels } = await sharp(page).stats();
      expect(channels[0]!.min).toBe(0);
      expect(channels[0]!.max).toBe(255);
    }
  });

  it("draws a short document whole", async () => {
    expect(await renderFirstPages(makePdf(2), ".pdf")).toHaveLength(2);
  });

  it("kills a run that outlasts its timeout", async () => {
    await expect(
      renderFirstPages(makePdf(3), ".pdf", 3, { convertMs: 1_000, renderMs: 1 }),
    ).rejects.toThrow(/timed out/);
  });

  it("rejects a file it cannot draw", async () => {
    const broken = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
    await expect(renderFirstPages(broken, ".pdf")).rejects.toThrow();
  });
});
