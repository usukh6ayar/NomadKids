import sharp from "sharp";
import { validateImageUpload } from "../media/upload-validation";

/** A sample page is looked at, not printed: small and light. */
const PREVIEW_EDGE = 1200;
const PREVIEW_QUALITY = 80;
const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

/**
 * One sample page, made safe to show to a teacher who has not bought it.
 *
 * ★ Through `validateImageUpload` first — the magic-byte sniff, the size cap,
 * and the re-encode that strips EXIF — and then **watermarked**, which the
 * contract makes the server's job (client, 2026-10-09: sample pages, "never
 * the file itself"). A diagonal «NomadKids · Жишээ» across the page keeps a
 * screenshot of the sample from passing as the material.
 */
export async function preparePreview(
  input: Buffer,
): Promise<{ buffer: Buffer; mimeType: "image/jpeg" }> {
  const image = await validateImageUpload(input, {
    maxBytes: PREVIEW_MAX_BYTES,
    maxEdge: PREVIEW_EDGE,
    quality: PREVIEW_QUALITY,
  });
  const width = image.width ?? PREVIEW_EDGE;
  const height = image.height ?? PREVIEW_EDGE;

  const buffer = await sharp(image.buffer)
    // A transparent PNG flattened onto white, so the mark and the page read.
    .flatten({ background: "#ffffff" })
    .composite([{ input: watermarkSvg(width, height), top: 0, left: 0 }])
    .jpeg({ quality: PREVIEW_QUALITY })
    .toBuffer();

  return { buffer, mimeType: "image/jpeg" };
}

/** Rows of faint diagonal text the size of the page. */
function watermarkSvg(width: number, height: number): Buffer {
  const size = Math.max(16, Math.round(Math.min(width, height) / 14));
  const step = size * 5;
  const rows: string[] = [];
  for (let y = -height; y < height * 2; y += step) {
    rows.push(
      `<text x="${-width}" y="${y}" font-size="${size}">` +
        "NomadKids · Жишээ   ".repeat(Math.ceil((width * 3) / (size * 8))) +
        "</text>",
    );
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<g transform="rotate(-30 ${width / 2} ${height / 2})" fill="#64748b" fill-opacity="0.28" ` +
      `font-family="sans-serif" font-weight="700">${rows.join("")}</g></svg>`,
  );
}
