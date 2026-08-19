import sharp from "sharp";

/**
 * The image budget for a generated report.
 *
 * ★ This file exists because of an arithmetic problem the PDF spike did not
 * measure. `PDF_SPIKE.md` established a 512 MB floor and a 384 MB failure — on
 * a **text-only** template. Photographs change the sum completely:
 *
 *   20 observations × 3 photos × 2 MB, inlined as base64, is ~160 MB of string
 *   held in Node, copied into Chromium over the DevTools protocol, and then
 *   decoded to raw bitmaps on the other side. Base64 adds a third; a 4000×3000
 *   JPEG decodes to ~48 MB of RGBA regardless of how well it compressed.
 *
 * The failure mode is an OOM kill of the renderer, which surfaces as
 * `Target closed` — indistinguishable from a random Chromium crash, and it only
 * happens for children with a full year of photos. That is the worst possible
 * distribution: it works in every test and fails for the families who have used
 * the system most.
 *
 * Three bounds, all of them necessary:
 *
 *  1. **Downscale before embedding.** A photo printed 70 mm tall at 150 dpi
 *     needs ~1000 px. Anything beyond that is decoded and thrown away.
 *  2. **Cap the number of images.** Downscaling bounds each one; only a count
 *     bounds the total.
 *  3. **Cap the total bytes.** The backstop for the case the first two miss.
 */

/** Print width in pixels: 170 mm of usable page at ~150 dpi. */
const MAX_IMAGE_WIDTH = 1000;

/** JPEG quality. 72 is indistinguishable at print size and roughly halves the size of 85. */
const JPEG_QUALITY = 72;

/** Photographs embedded in one report, across all observations. */
export const MAX_IMAGES_PER_REPORT = 40;

/** Total embedded image bytes, measured before base64 expansion. */
export const MAX_IMAGE_BYTES_PER_REPORT = 24 * 1024 * 1024;

/**
 * Accumulates images for one report, refusing to exceed the budget.
 *
 * Stateful and single-use: one instance per generated report. Once a limit is
 * reached every further request returns `null` and the template simply omits
 * the photo — a report missing its last few pictures is a far better outcome
 * than a worker killed halfway through.
 */
export class ImageBudget {
  private count = 0;
  private bytes = 0;
  private droppedCount = 0;

  constructor(
    private readonly maxImages: number = MAX_IMAGES_PER_REPORT,
    private readonly maxBytes: number = MAX_IMAGE_BYTES_PER_REPORT,
  ) {}

  get exhausted(): boolean {
    return this.count >= this.maxImages || this.bytes >= this.maxBytes;
  }

  /** How many photos were left out, for the note printed at the end of the report. */
  get dropped(): number {
    return this.droppedCount;
  }

  get used(): { images: number; bytes: number } {
    return { images: this.count, bytes: this.bytes };
  }

  /**
   * Downscales one image and returns it as a data URI, or `null` if the budget
   * is spent or the source is unreadable.
   *
   * A decode failure is deliberately not an error. A single corrupt object must
   * not fail a whole portfolio, and the alternative — a job that reports FAILED
   * because one photo from 2024 is truncated — is not recoverable by anyone the
   * user can reach.
   */
  async add(source: Buffer): Promise<string | null> {
    if (this.exhausted) {
      this.droppedCount += 1;
      return null;
    }

    let encoded: Buffer;
    try {
      encoded = await sharp(source)
        // `withoutEnlargement` keeps a small photo small rather than
        // upscaling it into a blurry, larger file.
        .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
        // Re-encoding also drops any metadata that survived upload. sharp does
        // not copy EXIF unless asked, so this is a second line of defence on
        // the GPS coordinates stripped at upload time.
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
    } catch {
      this.droppedCount += 1;
      return null;
    }

    if (this.bytes + encoded.byteLength > this.maxBytes) {
      this.droppedCount += 1;
      return null;
    }

    this.count += 1;
    this.bytes += encoded.byteLength;

    return `data:image/jpeg;base64,${encoded.toString("base64")}`;
  }
}
