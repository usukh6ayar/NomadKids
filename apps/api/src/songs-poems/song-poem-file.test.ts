import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { UploadRejected } from "../media/upload-validation";
import { validateAttachment, validateCover } from "./song-poem-file";

/** A song's attachment is judged by its bytes, never its name (CLAUDE.md §1.6). */

const ascii = (s: string) => Buffer.from(s, "latin1");
const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc(64)]);

describe("validateAttachment", () => {
  it("recognises audio by content", async () => {
    expect((await validateAttachment(pad(ascii("ID3\x04\x00")))).mimeType).toBe("audio/mpeg");
    expect((await validateAttachment(pad(Buffer.from([0xff, 0xfb, 0x90])))).mimeType).toBe(
      "audio/mpeg",
    );
    expect((await validateAttachment(pad(ascii("\x00\x00\x00\x20ftypM4A ")))).mimeType).toBe(
      "audio/mp4",
    );
    expect((await validateAttachment(pad(ascii("RIFF\x00\x00\x00\x00WAVE")))).mimeType).toBe(
      "audio/wav",
    );
    expect((await validateAttachment(pad(ascii("OggS")))).mimeType).toBe("audio/ogg");
  });

  it("recognises a PDF and a Word document, and re-encodes a picture", async () => {
    expect((await validateAttachment(ascii("%PDF-1.7\n"))).mimeType).toBe("application/pdf");
    const docx = Buffer.concat([ascii("PK\x03\x04"), Buffer.alloc(26), ascii("word/document.xml")]);
    expect((await validateAttachment(docx)).mimeType).toContain("wordprocessingml");

    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#f00" } })
      .png()
      .toBuffer();
    expect((await validateAttachment(png)).mimeType).toBe("image/png");
  });

  it("refuses a video in an MP4 box, a spreadsheet in a ZIP, and an executable", async () => {
    const video = pad(ascii("\x00\x00\x00\x20ftypisom"));
    const xlsx = Buffer.concat([ascii("PK\x03\x04"), Buffer.alloc(26), ascii("xl/workbook.xml")]);
    const elf = pad(ascii("\x7fELF"));
    for (const file of [video, xlsx, elf]) {
      await expect(validateAttachment(file)).rejects.toThrow(UploadRejected);
    }
  });

  it("refuses an empty file", async () => {
    await expect(validateAttachment(Buffer.alloc(0))).rejects.toThrow(UploadRejected);
  });
});

describe("validateCover", () => {
  it("takes only a picture", async () => {
    await expect(validateCover(ascii("%PDF-1.7"))).rejects.toThrow(UploadRejected);
  });
});
