import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Chat video — the user, 2026-10-09: "video upload hiihed jijigruuldeg …
 * tegeed automataar ustah", fitted to the VPS disk.
 *
 * ★ The browser uploads what the phone recorded; the `reports-worker` container
 * turns it into something a phone can play over mobile data, and the nightly
 * cleanup removes it after `CHAT_MEDIA_RETENTION_DAYS`. Transcoding is never
 * done inside the request (CLAUDE.md §6): a minute of 1080p takes longer to
 * encode than any request should be held open.
 */

/** The longer edge of the stored video: 720p, sharp on a phone, ~1.5 Mbit/s. */
export const CHAT_VIDEO_EDGE = 1280;

/** How long the transcoder may run on one file before it is given up on. */
export const CHAT_VIDEO_TRANSCODE_TIMEOUT_MS = 10 * 60_000;

export type RawVideoType = "video/mp4" | "video/quicktime" | "video/webm" | "video/3gpp";

/**
 * Brands an ISO-BMFF file carries that are **images**, not video — HEIC and
 * AVIF share the `ftyp` box with MP4, so `ftyp` alone is not "a video".
 */
const IMAGE_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "heim",
  "heis",
  "mif1",
  "msf1",
  "avif",
  "avis",
]);

/**
 * The real container type, from the first bytes of the file — §1.6.
 *
 * Hand-written for the same reason `detectImageType` is: four signatures, and
 * owning them keeps a dependency off the security-critical path. This is the
 * first gate only; `probeVideo` in the worker is the second, and a file that
 * sniffs as MP4 but holds no video stream fails there.
 */
export function detectVideoType(header: Buffer): RawVideoType | null {
  if (header.length < 12) return null;

  // Matroska / WebM: the EBML magic.
  if (header.readUInt32BE(0) === 0x1a45dfa3) return "video/webm";

  // ISO base media (MP4, QuickTime, 3GP): a size, then `ftyp`, then the brand.
  if (header.toString("latin1", 4, 8) === "ftyp") {
    const brand = header.toString("latin1", 8, 12).toLowerCase();
    if (IMAGE_BRANDS.has(brand)) return null;
    if (brand === "qt  ") return "video/quicktime";
    if (brand.startsWith("3g")) return "video/3gpp";
    return "video/mp4";
  }

  return null;
}

/** Reads just enough of a file on disk to sniff it. */
export async function readHeader(path: string, bytes = 64): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export interface VideoProbe {
  durationSec: number;
  width: number;
  height: number;
}

/**
 * What ffprobe makes of the file — the second gate. Returns null for anything
 * with no video stream, which is how a renamed document that happened to start
 * with `ftyp` is refused.
 */
export async function probeVideo(path: string): Promise<VideoProbe | null> {
  try {
    const { stdout } = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height:format=duration",
        "-of",
        "json",
        path,
      ],
      { timeout: 60_000 },
    );
    const parsed = JSON.parse(stdout) as {
      streams?: { width?: number; height?: number }[];
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    const duration = Number(parsed.format?.duration);
    if (!stream?.width || !stream.height || !Number.isFinite(duration)) return null;
    // Rounded, not ceiled: AAC priming makes a one-second clip 1.02 s long.
    return {
      durationSec: Math.max(1, Math.round(duration)),
      width: stream.width,
      height: stream.height,
    };
  } catch {
    return null;
  }
}

/**
 * The ffmpeg arguments, separate so the choices are readable in one place.
 *
 * - **H.264 + AAC in MP4, always** — even when the phone already sent MP4. An
 *   iPhone records HEVC, which Chrome on Android and Windows will not play.
 * - **≤720p, ≤30 fps, CRF 28 capped at 1.5 Mbit/s** — about 11 MB a minute at
 *   worst, which is what makes a week of video fit the VPS disk.
 * - **`-map_metadata -1`, and only the first video and audio streams** — the
 *   video counterpart of the EXIF strip (§1.6). A phone's `.mov` carries the
 *   GPS of where it was recorded, here the kindergarten's.
 * - **`+faststart`** — the index goes first, so playback starts before the
 *   whole file has arrived.
 * - **two threads** — the worker shares four cores with the API and Postgres.
 */
export function transcodeArgs(input: string, output: string): string[] {
  const scale =
    `scale='if(gte(iw,ih),min(${CHAT_VIDEO_EDGE},iw),-2)':` +
    `'if(gte(iw,ih),-2,min(${CHAT_VIDEO_EDGE},ih))'`;
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-sn",
    "-dn",
    "-vf",
    scale,
    // An output option rather than an `fps` filter expression: it needs only
    // ffmpeg 4.4, and the image's Debian ships 5.1.
    "-fpsmax",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-maxrate",
    "1500k",
    "-bufsize",
    "3000k",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-threads",
    "2",
    output,
  ];
}

export async function transcodeVideo(input: string, output: string): Promise<void> {
  await run("ffmpeg", transcodeArgs(input, output), {
    timeout: CHAT_VIDEO_TRANSCODE_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
}
