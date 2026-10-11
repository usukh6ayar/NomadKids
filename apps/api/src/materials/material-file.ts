import { UploadRejected } from "../media/upload-validation";

/**
 * A lesson presentation runs larger than a document: slides carry pictures.
 * Fifty megabytes is a long deck; the interceptor refuses anything above it
 * before it is held in memory.
 */
export const MAX_MATERIAL_BYTES = 50 * 1024 * 1024;

export interface ValidatedMaterialFile {
  fileType: "PDF" | "PPT";
  mimeType: string;
  buffer: Buffer;
  sizeBytes: number;
}

const PDF_MIME = "application/pdf";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PPT_MIME = "application/vnd.ms-powerpoint";

/** ZIP's local-file-header signature, at offset zero. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** OLE2 compound file — the container of every pre-2007 Office format. */
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** Every PowerPoint package has this part; a .docx or .xlsx does not. */
const PPTX_PART = Buffer.from("ppt/presentation.xml", "latin1");
/** The stream every .ppt carries, named in UTF-16LE in the OLE2 directory. */
const PPT_STREAM = Buffer.from("PowerPoint Document", "utf16le");

/**
 * A teaching material **by content**, never by its name (CLAUDE.md §1.6).
 *
 * ★ The container alone is not enough. A ZIP is also a .docx, a .jar or an
 * archive of anything; an OLE2 file is also a .doc or an .xls. So a PPTX must
 * contain the `ppt/presentation.xml` part and a PPT the «PowerPoint Document»
 * stream — what makes it a presentation rather than merely a container.
 *
 * ★★ Like a PDF in the document library, the bytes are stored as they came:
 * re-writing a presentation needs a renderer, which over untrusted input is a
 * larger risk than the one it closes. What makes that safe is what happens
 * next: a private bucket, and a download that sets its own `Content-Type` and
 * an `attachment` disposition after checking the buyer.
 */
export function validateMaterialFile(input: Buffer): ValidatedMaterialFile {
  if (input.length === 0) throw new UploadRejected("Файл хоосон байна");
  if (input.length > MAX_MATERIAL_BYTES) {
    throw new UploadRejected(
      `Файл хэт том байна. Дээд хэмжээ ${MAX_MATERIAL_BYTES / 1024 / 1024} MB`,
    );
  }

  const sized = { buffer: input, sizeBytes: input.length };

  if (input.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { fileType: "PDF", mimeType: PDF_MIME, ...sized };
  }
  if (input.subarray(0, 4).equals(ZIP_MAGIC) && input.includes(PPTX_PART)) {
    return { fileType: "PPT", mimeType: PPTX_MIME, ...sized };
  }
  if (input.subarray(0, 8).equals(OLE2_MAGIC) && input.includes(PPT_STREAM)) {
    return { fileType: "PPT", mimeType: PPT_MIME, ...sized };
  }

  throw new UploadRejected("Зөвхөн PDF, PPT, PPTX файл оруулна уу");
}

/** The extension a download is saved under, from what the content proved to be. */
export function materialExtension(mimeType: string): string {
  if (mimeType === PDF_MIME) return ".pdf";
  if (mimeType === PPTX_MIME) return ".pptx";
  return ".ppt";
}
