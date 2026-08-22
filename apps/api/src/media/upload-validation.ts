import sharp from "sharp";

/**
 * Upload validation.
 *
 * ★ The MIME type is detected from the file's **content**, never from its
 * extension or the `Content-Type` header the client sent. A `.jpg` can be an
 * executable, and a browser asked to render it may do something other than
 * display a picture. CLAUDE.md §1.6.
 */

/** Images only. The MVP portfolio has no use for anything else. */
export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** 10 MB — a modern phone photo with room to spare. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface ValidatedUpload {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export class UploadRejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "UploadRejected";
  }
}

/**
 * Detects the real image type from magic bytes.
 *
 * Hand-written rather than pulled from `file-type`, which is ESM-only and does
 * not resolve from this CommonJS build. Three formats is a small, stable
 * surface — these signatures have not changed in decades — and owning it
 * removes both a dependency and an interop workaround from the security-
 * critical path.
 *
 * Returns null for anything unrecognised, which the caller treats as a
 * rejection. It never consults the file extension or the client's declared
 * Content-Type; only these bytes decide.
 */
export function detectImageType(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";

  // PNG: 89 "PNG" CR LF SUB LF
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // WebP: "RIFF" <4-byte size> "WEBP". The size field between the two markers
  // is why both have to be checked rather than matching a single prefix.
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Whether these bytes are an ISO-BMFF image — HEIC, HEIF or AVIF.
 *
 * ★ Not a supported format. This exists only so the rejection can say which
 * format it was and what to do about it.
 *
 * `sharp` here is built without HEVC (its prebuilt binary reports
 * `heif.input.fileSuffix: ['.avif']` — libheif is present, the patent-
 * encumbered HEVC decoder is not), so a `.heic` cannot be decoded server-side.
 * Adding a WASM decoder for it is roughly two megabytes and a new parser on the
 * upload path, which is a poor trade for how rarely it arrives: iOS converts
 * HEIC to JPEG on its own when a photo is chosen through `<input type="file">`,
 * so these bytes reach us essentially only when someone drags a `.heic` off a
 * Mac.
 *
 * That person can fix it in ten seconds if they are told how, and cannot guess
 * if they are told "Зөвхөн JPEG, PNG, WebP". The whole feature is the sentence.
 *
 * Layout: bytes 4-8 are "ftyp", then a brand. `heic`/`heix`/`hevc`/`hevx` are
 * HEVC-coded, `mif1`/`msf1` are the generic HEIF brands Apple also emits, and
 * `avif` is the one sharp could actually read — but accepting AVIF while
 * rejecting its siblings would be a distinction nobody could predict, and no
 * camera in a kindergarten produces it.
 */
export function isUnsupportedHeifFamily(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.subarray(4, 8).toString("ascii") !== "ftyp") return false;

  const brand = buffer.subarray(8, 12).toString("ascii");
  return ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "avif"].includes(brand);
}

/**
 * The longest edge a stored photograph may have.
 *
 * A phone photograph arrives at 4032×3024 and was stored at that size, which
 * nothing in this product can use: the PDF places photographs a few centimetres
 * wide, where 2000px is still past 300dpi, and the gallery renders them smaller
 * than that again. The cost of keeping the original was paid three times over —
 * in the bucket, in the report worker's memory, and on a parent's mobile data
 * every time they opened the gallery.
 *
 * `withoutEnlargement` matters: a scanned drawing at 900px must not be blown up
 * to 2000 and stored as a blurrier, larger file than it arrived as.
 */
export const MAX_IMAGE_EDGE = 2000;

/**
 * Validates and normalises an uploaded image.
 *
 * The order matters: size first (cheapest, and bounds everything after it),
 * then real content type, then re-encode.
 *
 * ★ It takes no filename. Once detection moved to magic bytes the name became
 * genuinely irrelevant, and not receiving it is a stronger guarantee than
 * remembering not to echo it in an error — there is nothing to leak.
 *
 * ★ The re-encode through sharp is the EXIF strip. A classroom photograph
 * otherwise carries the GPS coordinates of the kindergarten and the time it was
 * taken — metadata about a child that nobody asked to publish. Re-encoding
 * rather than editing metadata in place also neutralises anything hiding in the
 * container that the type sniff did not object to.
 */
export async function validateImageUpload(input: Buffer): Promise<ValidatedUpload> {
  if (input.length === 0) throw new UploadRejected("Файл хоосон байна");

  if (input.length > MAX_UPLOAD_BYTES) {
    throw new UploadRejected(
      `Файл хэт том байна. Дээд хэмжээ ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
    );
  }

  const detected = detectImageType(input);
  if (!detected) {
    // The one exception to the rule below. Naming HEIC confirms nothing an
    // attacker could not determine from the bytes they just sent, and it is
    // the difference between a teacher fixing their camera setting and
    // giving up on the photo.
    if (isUnsupportedHeifFamily(input)) {
      throw new UploadRejected(
        "HEIC зургийг дэмжихгүй байна. iPhone дээрээ Тохиргоо → Камер → " +
          "Формат → «Хамгийн нийцтэй» болгоод дахин авна уу.",
      );
    }

    // Deliberately does not echo the declared name or the detected type: a
    // rejection message is not the place to confirm what an attacker's probe
    // was recognised as.
    throw new UploadRejected("Зөвхөн JPEG, PNG, WebP зураг оруулах боломжтой");
  }

  try {
    const pipeline = sharp(input, { failOn: "error" });
    const meta = await pipeline.metadata();

    // A "decompression bomb": small compressed, enormous decoded. Rejected on
    // dimensions because the byte-size check cannot see it.
    if ((meta.width ?? 0) * (meta.height ?? 0) > 50_000_000) {
      throw new UploadRejected("Зургийн хэмжээ хэт том байна");
    }

    // PNG stays PNG (transparency); JPEG and WebP normalise to JPEG. One
    // output format per input class keeps the stored set predictable.
    const keepPng = detected === "image/png";

    const output = await pipeline
      .rotate() // applies EXIF orientation before the metadata is discarded
      // After `rotate`, so a portrait photograph is bounded on the edge it
      // actually has rather than the one EXIF claimed.
      .resize({
        width: MAX_IMAGE_EDGE,
        height: MAX_IMAGE_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toFormat(keepPng ? "png" : "jpeg", { quality: 88 })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: output.data,
      mimeType: keepPng ? "image/png" : "image/jpeg",
      sizeBytes: output.data.length,
      width: output.info.width,
      height: output.info.height,
    };
  } catch (error) {
    if (error instanceof UploadRejected) throw error;
    // A file that sniffed as an image but will not decode is not an image.
    throw new UploadRejected("Зургийг уншиж чадсангүй");
  }
}

/**
 * A filename safe to store for display.
 *
 * Kept only in `originalName`, shown to users, and **never** used to build a
 * storage key or a path. Stripped of directory separators and control
 * characters so it cannot escape a filename context if some future code path
 * does concatenate it.
 */
export function sanitiseFilename(name: string): string {
  const cleaned = decodeMultipartFilename(name)
    .replace(/[/\\]/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  return (cleaned || "зураг").slice(0, 200);
}

/**
 * Repairs a filename mangled by multipart parsing.
 *
 * ★ Busboy — and therefore multer and every Express upload — decodes the
 * `filename` parameter as latin1, because RFC 7578 never settled on an
 * encoding. A browser sends UTF-8, so `зураг.jpg` arrives as `Ð·ÑÑÐ°Ð³.jpg`.
 *
 * In an English-language product this is invisible. Here it means **every
 * Mongolian filename is corrupted on upload** — caught by a test asserting a
 * Cyrillic name survives the round trip, not by reading the code.
 *
 * The repair is conditional: re-decoding a name that was already correct UTF-8
 * would corrupt it in the other direction, so the result is kept only when it
 * round-trips cleanly and actually changed something.
 */
function decodeMultipartFilename(name: string): string {
  // Characters in the latin1 supplement are the signature of the mis-decode;
  // a genuinely latin1 filename ("café.jpg") also contains them, which is why
  // the round-trip check below decides rather than this test alone.
  if (!/[À-ÿ]/.test(name)) return name;

  try {
    const repaired = Buffer.from(name, "latin1").toString("utf8");
    // A failed decode yields U+FFFD; keep the original in that case.
    if (repaired.includes("�")) return name;
    // And only accept the repair if it survives the inverse.
    return Buffer.from(repaired, "utf8").toString("latin1") === name ? repaired : name;
  } catch {
    return name;
  }
}
