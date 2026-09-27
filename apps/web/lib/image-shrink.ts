/**
 * Makes an oversized photograph fit, in the browser, instead of refusing it.
 *
 * ★ Why this exists. The ceiling was 10 MB and every upload control in the
 * product answered a larger file with "Файл хэт том байна" and nothing else —
 * which, to a teacher holding a phone that shoots 12 MB frames, is the product
 * refusing to do the one thing it was opened for. The client, 2026-09-20:
 * raise it to 20 MB, and **shrink anything past that** rather than refuse.
 *
 * ★★ Re-encoded to JPEG, always, once a shrink is needed. A 24 MB PNG
 * screenshot re-encoded as PNG is still enormous, because PNG is lossless and
 * the size is the pixels; the only lever that reliably works on a photograph
 * is JPEG quality. Transparency is lost, and for the camera images this
 * handles there is none — a PNG small enough to keep is never touched.
 *
 * ★★★ It never enlarges and it never runs on a file that already fits. A
 * 2 MB photo reaches the server byte for byte, so nothing that works today
 * starts going through a lossy round trip.
 *
 * ★★★★ Failure returns the **original**. `createImageBitmap` cannot decode
 * HEIC in most browsers, and an iPhone's default format is HEIC — so the
 * realistic failure here is common rather than exotic. Returning the original
 * lets the server answer with its own message about the format, which is the
 * true reason it was refused; throwing would report a resize problem for a
 * file that was never going to be accepted.
 */

/** The long edge a shrunk photograph is capped at. */
const MAX_EDGE = 2560;

/** Tried in order until one fits. Below 0.5 a photograph starts to look it. */
const QUALITY_STEPS = [0.85, 0.75, 0.6, 0.5];

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

function renamedToJpeg(name: string): string {
  return `${name.replace(/\.[^./\\]+$/, "")}.jpg`;
}

async function toBitmap(file: File): Promise<ImageBitmap> {
  // `from-image` applies the EXIF orientation, so a portrait photo taken on a
  // phone does not arrive on its side. The server strips EXIF afterwards, so
  // the rotation has to be baked into the pixels here or it is lost.
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

function draw(bitmap: ImageBitmap, scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Returns a file at or under `maxBytes` when that is achievable, and the
 * original otherwise — including for anything that is not an image.
 *
 * The caller still checks the size afterwards: this promises an attempt, not a
 * result, and a 60 MB panorama may not come down far enough.
 */
export async function shrinkIfTooLarge(file: File, maxBytes: number): Promise<File> {
  if (!isImage(file) || file.size <= maxBytes) return file;

  try {
    const bitmap = await toBitmap(file);
    try {
      // One scale, then quality: dimensions are what make a phone photograph
      // large, and 2560px is still more than any screen in this product shows.
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

      for (const quality of QUALITY_STEPS) {
        const blob = await encode(draw(bitmap, scale), quality);
        if (blob && blob.size <= maxBytes) {
          return new File([blob], renamedToJpeg(file.name), {
            type: "image/jpeg",
            lastModified: file.lastModified,
          });
        }
      }

      // Still too big at the lowest quality worth using. Half the edge once,
      // which quarters the pixels, and take whatever that gives.
      const blob = await encode(draw(bitmap, scale / 2), 0.7);
      if (blob) {
        return new File([blob], renamedToJpeg(file.name), {
          type: "image/jpeg",
          lastModified: file.lastModified,
        });
      }
    } finally {
      bitmap.close();
    }
  } catch {
    // See the fourth note above: the original, so the server explains why.
  }

  return file;
}
