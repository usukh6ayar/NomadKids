import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageBudget } from "./report-images";

/**
 * The image budget.
 *
 * These are the bounds that keep a report from OOM-killing the worker for
 * exactly the families who have used the system most — see the header of
 * `report-images.ts`.
 */

async function jpeg(width: number, height = width): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } },
  })
    .jpeg()
    .toBuffer();
}

describe("ImageBudget", () => {
  it("returns a jpeg data URI", async () => {
    const budget = new ImageBudget();
    const uri = await budget.add(await jpeg(400));

    expect(uri).toMatch(/^data:image\/jpeg;base64,/);
    expect(budget.used.images).toBe(1);
    expect(budget.dropped).toBe(0);
  });

  it("downscales a large photo well below its original size", async () => {
    const source = await jpeg(4000, 3000);
    const budget = new ImageBudget();

    const uri = await budget.add(source);
    expect(uri).not.toBeNull();

    // The point is the *decoded* size in Chromium, which tracks pixel count.
    // Encoded bytes are the observable proxy: a 4000px photo must not reach the
    // page at 4000px.
    expect(budget.used.bytes).toBeLessThan(source.byteLength);

    const decoded = Buffer.from(uri!.split(",")[1]!, "base64");
    const meta = await sharp(decoded).metadata();
    expect(meta.width).toBe(1000);
  });

  it("does not upscale a photo smaller than the print width", async () => {
    const budget = new ImageBudget();
    const uri = await budget.add(await jpeg(300, 200));

    const decoded = Buffer.from(uri!.split(",")[1]!, "base64");
    const meta = await sharp(decoded).metadata();
    expect(meta.width).toBe(300);
  });

  it("stops at the image count limit and counts what it dropped", async () => {
    const budget = new ImageBudget(2, 100 * 1024 * 1024);
    const photo = await jpeg(200);

    expect(await budget.add(photo)).not.toBeNull();
    expect(await budget.add(photo)).not.toBeNull();
    expect(await budget.add(photo)).toBeNull();
    expect(await budget.add(photo)).toBeNull();

    expect(budget.used.images).toBe(2);
    expect(budget.dropped).toBe(2);
  });

  it("stops at the byte limit", async () => {
    // Small enough that one photo fits and two do not.
    const budget = new ImageBudget(100, 2000);
    const photo = await jpeg(600);

    let accepted = 0;
    for (let i = 0; i < 10; i += 1) {
      if (await budget.add(photo)) accepted += 1;
    }

    expect(accepted).toBeGreaterThan(0);
    expect(budget.used.bytes).toBeLessThanOrEqual(2000);
    expect(budget.dropped).toBe(10 - accepted);
  });

  /**
   * ★ One corrupt object must not fail a whole portfolio.
   *
   * The alternative is a job that reports FAILED because a photo uploaded in
   * 2024 is truncated — a state no user in the building can recover from.
   */
  it("skips an unreadable image instead of throwing", async () => {
    const budget = new ImageBudget();
    const uri = await budget.add(Buffer.from("this is not an image"));

    expect(uri).toBeNull();
    expect(budget.dropped).toBe(1);
    expect(budget.used.images).toBe(0);
  });

  it("re-encodes, so EXIF from the source does not reach the PDF", async () => {
    const withExif = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .withExif({ IFD0: { Copyright: "test", Software: "test-suite" } })
      .jpeg()
      .toBuffer();

    const budget = new ImageBudget();
    const uri = await budget.add(withExif);
    const decoded = Buffer.from(uri!.split(",")[1]!, "base64");

    expect((await sharp(decoded).metadata()).exif).toBeUndefined();
  });
});
