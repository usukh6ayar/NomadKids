import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

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
 * ★ `execFile`, never a shell, and every argument is a path this function
 * made — nothing from the upload reaches a command line. Each run gets its own
 * temporary directory **and its own LibreOffice profile**: two conversions
 * sharing `~/.config/libreoffice` block each other, and a profile a crashed
 * run left half-written breaks every later one. A timeout kills the process
 * with SIGKILL, so a file built to hang the converter cannot hold the worker.
 *
 * Returns the raw pages; `preparePreview` validates, reduces and watermarks
 * each, exactly as it does the operator's own pictures.
 */
export async function renderFirstPages(
  input: Buffer,
  extension: ".pdf" | ".ppt" | ".pptx",
  pages = AUTO_PREVIEW_PAGES,
): Promise<Buffer[]> {
  const dir = await mkdtemp(join(tmpdir(), "material-render-"));
  try {
    const source = join(dir, `source${extension}`);
    await writeFile(source, input);

    let pdf = source;
    if (extension !== ".pdf") {
      await run(
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
        { timeout: CONVERT_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 },
      );
      pdf = join(dir, "source.pdf");
    }

    await run(
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
      { timeout: RENDER_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 },
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
