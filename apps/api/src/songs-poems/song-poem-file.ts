import { UploadRejected, detectImageType, validateImageUpload } from "../media/upload-validation";

/** The web's own limits (`songs-poems-library.tsx`): a 5 MB cover, a 10 MB file. */
export const MAX_COVER_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface StoredBytes {
  buffer: Buffer;
  mimeType: string;
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const DOCX_PART = Buffer.from("word/document.xml", "latin1");
const DOC_STREAM = Buffer.from("WordDocument", "utf16le");

/** A cover picture: sniffed, bounded, re-encoded — EXIF gone (CLAUDE.md §1.6). */
export async function validateCover(input: Buffer): Promise<StoredBytes> {
  const image = await validateImageUpload(input, { maxBytes: MAX_COVER_BYTES, maxEdge: 1600 });
  return { buffer: image.buffer, mimeType: image.mimeType };
}

/**
 * The attachment — what the web offers: audio, a picture, a PDF or a Word
 * document. Each **by content**, never by name (§1.6).
 *
 * ★ A picture is re-encoded like any other (EXIF and the GPS it may carry go).
 * Audio, PDF and Word are stored as they came — re-writing them needs a
 * decoder over untrusted input — and are safe for the same reason a document
 * in the library is: a private bucket, and a download that sets its own
 * `Content-Type` after the check.
 *
 * ★★ A container is not a format: a ZIP must hold `word/document.xml` to be a
 * .docx, an OLE2 file the «WordDocument» stream to be a .doc, and an MP4
 * container the M4A brand to be audio rather than a video.
 */
export async function validateAttachment(input: Buffer): Promise<StoredBytes> {
  if (input.length === 0) throw new UploadRejected("Файл хоосон байна");
  if (input.length > MAX_ATTACHMENT_BYTES) {
    throw new UploadRejected(
      `Файл хэт том байна. Дээд хэмжээ ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`,
    );
  }

  if (detectImageType(input)) {
    const image = await validateImageUpload(input, { maxBytes: MAX_ATTACHMENT_BYTES });
    return { buffer: image.buffer, mimeType: image.mimeType };
  }

  const mimeType = detectDocumentOrAudio(input);
  if (!mimeType) {
    throw new UploadRejected("Зөвхөн аудио, зураг, PDF эсвэл Word файл оруулна уу");
  }
  return { buffer: input, mimeType };
}

function detectDocumentOrAudio(input: Buffer): string | null {
  const ascii = (from: number, to: number) => input.subarray(from, to).toString("latin1");

  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (ascii(0, 3) === "ID3") return "audio/mpeg";
  // An MPEG audio frame with no ID3 tag: eleven set sync bits.
  if (input[0] === 0xff && ((input[1] ?? 0) & 0xe0) === 0xe0) return "audio/mpeg";
  if (ascii(4, 8) === "ftyp" && ["M4A ", "M4B "].includes(ascii(8, 12))) return "audio/mp4";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (input.subarray(0, 4).equals(ZIP_MAGIC) && input.includes(DOCX_PART)) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (input.subarray(0, 8).equals(OLE2_MAGIC) && input.includes(DOC_STREAM)) {
    return "application/msword";
  }
  return null;
}
