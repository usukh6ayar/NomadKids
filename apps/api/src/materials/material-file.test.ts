import { describe, expect, it } from "vitest";
import { UploadRejected } from "../media/upload-validation";
import { validateMaterialFile } from "./material-file";

/** A teaching material is judged by its bytes, never its name (CLAUDE.md §1.6). */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const zipWith = (part: string) =>
  Buffer.concat([ZIP, Buffer.alloc(26), Buffer.from(part, "latin1"), Buffer.alloc(64)]);
const ole2With = (stream: string) =>
  Buffer.concat([OLE2, Buffer.alloc(504), Buffer.from(stream, "utf16le"), Buffer.alloc(64)]);

describe("validateMaterialFile", () => {
  it("accepts a PDF, a PPTX and a PPT by content", () => {
    expect(validateMaterialFile(Buffer.from("%PDF-1.7\n...")).fileType).toBe("PDF");
    expect(validateMaterialFile(zipWith("ppt/presentation.xml"))).toMatchObject({
      fileType: "PPT",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    expect(validateMaterialFile(ole2With("PowerPoint Document"))).toMatchObject({
      fileType: "PPT",
      mimeType: "application/vnd.ms-powerpoint",
    });
  });

  it("refuses a picture named .pdf", () => {
    expect(() => validateMaterialFile(PNG)).toThrow(UploadRejected);
  });

  it("refuses a ZIP that is not a presentation — a .docx renamed .pptx", () => {
    expect(() => validateMaterialFile(zipWith("word/document.xml"))).toThrow(UploadRejected);
  });

  it("refuses an OLE2 file that is not a presentation — a .doc renamed .ppt", () => {
    expect(() => validateMaterialFile(ole2With("WordDocument"))).toThrow(UploadRejected);
  });

  it("refuses junk before the PDF signature, and an empty file", () => {
    expect(() => validateMaterialFile(Buffer.from("xx%PDF-1.7"))).toThrow(UploadRejected);
    expect(() => validateMaterialFile(Buffer.alloc(0))).toThrow(UploadRejected);
  });
});
