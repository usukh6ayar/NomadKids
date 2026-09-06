/**
 * The first page of a PDF, as a PNG.
 *
 * ★ Rendered in the browser at upload time — 2026-09-06, at the client's
 * request: "ирсэн pdf-ийн cover-ийг харуулах… pdf-ийн эхний хуудсыг cover
 * болгож нэмэх, яг л номын сан шиг".
 *
 * ★★ Client-side, and that is the whole design decision.
 *
 * `Document.coverMediaFileId` and the `cover` multipart field have existed
 * since the library shipped — the API takes a cover image, validates it by
 * content like every other upload, and stores it in the private bucket. What
 * was missing was anybody producing one. Doing it on the server would mean
 * rasterising a PDF in Node: a native canvas binding, or the report worker's
 * Chromium pressed into a job it is not for, on a deployment that already
 * needs ≥1GB and Cyrillic fonts (CLAUDE.md §6). The publisher's own browser
 * already has a PDF engine and already has the bytes in memory.
 *
 * ★★★ It is best-effort, and the caller must treat it that way.
 *
 * A password-protected, corrupt, or unusually large PDF can fail to render,
 * and a failed thumbnail must never stop a document being published — the
 * library's job is to hold the file. Every failure resolves to `null` and the
 * card falls back to a typographic cover.
 */

/** Roughly the card's own width at 2×, so a cover is sharp without being large. */
const TARGET_WIDTH = 480;

export async function renderPdfCover(file: File): Promise<Blob | null> {
  try {
    /*
      Imported dynamically so `pdfjs-dist` — which is megabytes and pulls in a
      worker — is fetched only when somebody actually publishes a document,
      rather than by every page that imports this module's siblings.
    */
    const pdfjs = await import("pdfjs-dist");

    /*
      ★ The worker is resolved from the package rather than from a CDN.

      pdf.js runs its parser off the main thread and needs a URL for that
      script. A CDN URL would send nothing anywhere — the worker is fetched, not
      the document — but it would still make publishing a document depend on a
      third-party host being up. `new URL(..., import.meta.url)` lets the
      bundler emit the worker as an asset of this app.
    */
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();

    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const page = await pdf.getPage(1);

    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);

    const context = canvas.getContext("2d");
    if (!context) return null;

    // White, not transparent: a PDF page is paper, and a transparent PNG would
    // show whatever the card sits on through the letterforms.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: context, viewport }).promise;

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((blob) => resolve(blob), "image/png"),
    );
  } catch {
    // Deliberately silent: see the docblock. A cover is a convenience and its
    // absence is already a rendered state.
    return null;
  }
}
