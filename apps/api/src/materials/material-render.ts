import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** How many pages the server draws — the web's `AUTO_PREVIEW_PAGES`. */
export const AUTO_PREVIEW_PAGES = 3;

/** The long edge pdftoppm draws at; `preparePreview` reduces to its own size. */
const RENDER_EDGE = 1600;

/** A PowerPoint's first start builds LibreOffice's profile — give it room. */
const CONVERT_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 60_000;

/**
 * Draws the first pages of a material as PNGs (2026-10-12, the contract's
 * "Phase 2" in `apps/web/lib/materials.ts`).
 *
 * A PowerPoint goes to PDF through LibreOffice first; the PDF's pages are
 * drawn by poppler's `pdftoppm`. Both are installed in the API image
 * (`apps/api/Dockerfile`) and run only in `reports-worker` (CLAUDE.md §6).
 *
 * ★ No shell, and every argument is a path this function made — nothing from
 * the upload reaches a command line. Each run gets its own temporary directory
 * **and its own LibreOffice profile**: two conversions sharing
 * `~/.config/libreoffice` block each other, and a profile a crashed run left
 * half-written breaks every later one. A timeout SIGKILLs the whole process
 * group (`runKillable`), so a file built to hang the converter cannot hold
 * the worker.
 *
 * Returns the raw pages; `preparePreview` validates, reduces and watermarks
 * each, exactly as it does the operator's own pictures.
 */
export async function renderFirstPages(
  input: Buffer,
  extension: ".pdf" | ".ppt" | ".pptx",
  pages = AUTO_PREVIEW_PAGES,
  timeouts = { convertMs: CONVERT_TIMEOUT_MS, renderMs: RENDER_TIMEOUT_MS },
): Promise<Buffer[]> {
  const dir = await mkdtemp(join(tmpdir(), "material-render-"));
  try {
    const source = join(dir, `source${extension}`);
    await writeFile(source, input);

    let pdf = source;
    if (extension !== ".pdf") {
      await runKillable(
        "soffice",
        [
          `-env:UserInstallation=${pathToFileURL(join(dir, "profile")).href}`,
          "--headless",
          "--norestore",
          "--convert-to",
          "pdf",
          "--outdir",
          dir,
          source,
        ],
        timeouts.convertMs,
      );
      pdf = join(dir, "source.pdf");
    }

    await runKillable(
      "pdftoppm",
      [
        "-f",
        "1",
        "-l",
        String(pages),
        "-png",
        "-scale-to",
        String(RENDER_EDGE),
        pdf,
        join(dir, "page"),
      ],
      timeouts.renderMs,
    );

    // `page-1.png`, or `page-01.png` when the document has ten pages or more.
    const files = (await readdir(dir))
      .map((name) => ({ name, n: /^page-(\d+)\.png$/.exec(name)?.[1] }))
      .filter((f): f is { name: string; n: string } => f.n !== undefined)
      .sort((a, b) => Number(a.n) - Number(b.n));
    return await Promise.all(files.map((f) => readFile(join(dir, f.name))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Runs a command in a process group of its own and, on timeout, SIGKILLs the
 * **group**.
 *
 * ★ `execFile`'s timeout kills only its direct child, and `soffice` is a shell
 * script that starts `soffice.bin` beneath it — a hung converter would outlive
 * the kill, holding memory in the container that also renders parents' PDFs.
 * The worker container runs with `init: true` so what is killed is reaped.
 */
function runKillable(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString();
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`${command} timed out after ${timeoutMs} ms`));
      else if (code !== 0) reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
      else resolve();
    });
  });
}
