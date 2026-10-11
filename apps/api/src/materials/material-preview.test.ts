import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { UploadRejected } from "../media/upload-validation";
import { preparePreview } from "./material-preview";

/** A sample page: re-encoded (EXIF gone), watermarked, and an image only. */
describe("preparePreview", () => {
  it("returns a watermarked JPEG that differs from a blank page", async () => {
    const blank = await sharp({
      create: { width: 600, height: 800, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();

    const out = await preparePreview(blank);
    expect(out.mimeType).toBe("image/jpeg");

    const { data, info } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(600);
    // The mark darkens part of an all-white page.
    const darker = data.some((value) => value < 230);
    expect(darker).toBe(true);
  });

  it("refuses something that is not an image", async () => {
    await expect(preparePreview(Buffer.from("%PDF-1.7"))).rejects.toThrow(UploadRejected);
  });
});
