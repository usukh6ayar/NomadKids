import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledFontDir } from "./font-check";

/**
 * Shared pieces of every report template.
 *
 * Extracted so that the portfolio and the term report cannot drift apart on
 * escaping. `esc` in particular is a security control, not a formatting helper:
 * a child's name, a parent's note and a teacher's comment all reach the PDF
 * through it, and one template with its own copy is one template that will
 * eventually forget a case.
 */

let cachedFonts: { regular: string; bold: string } | null = null;

/**
 * The base64 font payloads, read once.
 *
 * ★ Embedded as base64 **as well as** installed system-wide. The system install
 * is what makes Chromium render text at all (`PDF_SPIKE.md` §4); the
 * `@font-face` is what makes it render in *this* typeface rather than whatever
 * fontconfig picks. Both are needed, and they solve different problems.
 */
export function fonts(): { regular: string; bold: string } {
  if (cachedFonts) return cachedFonts;
  const dir = bundledFontDir();
  cachedFonts = {
    regular: readFileSync(join(dir, "NotoSans-Regular.ttf")).toString("base64"),
    bold: readFileSync(join(dir, "NotoSans-Bold.ttf")).toString("base64"),
  };
  return cachedFonts;
}

/** Escapes text for HTML. Every user-supplied string passes through this. */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Renders paragraphs, preserving the line breaks a teacher typed. */
export function paragraphs(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${esc(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** The `@font-face` block shared by every template. */
export function fontFaceCss(): string {
  const { regular, bold } = fonts();
  return `
  @font-face {
    font-family: "Noto Sans";
    font-weight: 400;
    src: url(data:font/ttf;base64,${regular}) format("truetype");
  }
  @font-face {
    font-family: "Noto Sans";
    font-weight: 700;
    src: url(data:font/ttf;base64,${bold}) format("truetype");
  }`;
}

/** Typography and table styles shared by both reports. */
export function baseCss(): string {
  return `${fontFaceCss()}

  * { box-sizing: border-box; }
  body {
    font-family: "Noto Sans", sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #1f2937;
    margin: 0;
  }
  h1 { font-size: 24pt; margin: 0 0 4mm; }
  h2 { font-size: 14pt; margin: 0 0 3mm; border-bottom: 2px solid #e5e7eb; padding-bottom: 2mm; }
  h3 { font-size: 11.5pt; margin: 0 0 2mm; }
  h4 { font-size: 10.5pt; margin: 0 0 1mm; }
  p  { margin: 0 0 3mm; text-align: justify; }
  .meta { color: #6b7280; font-size: 9pt; }

  /* Each major section starts on a fresh page. */
  .page-break { break-before: page; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
  th, td { border: 1px solid #d1d5db; padding: 2.5mm 3mm; text-align: left; font-size: 9.5pt; }
  thead th { background: #f9fafb; }
  .level { padding: 1mm 2.5mm; border-radius: 2mm; font-weight: 700; font-size: 9pt; }

  dl { display: grid; grid-template-columns: 45mm 1fr; gap: 1.5mm 4mm; margin: 0 0 4mm; }
  dt { font-weight: 700; }
  dd { margin: 0; }

  .empty { color: #9ca3af; font-style: italic; }`;
}

/**
 * Running header and footer.
 *
 * ★ They carry their own `@font-face`. Puppeteer renders header and footer
 * templates in a **separate document** that does not inherit the page's styles,
 * so without this they fall back to a system serif — confirmed with `pdffonts`
 * during the spike, which showed Times-Roman embedded alongside Noto Sans.
 */
export function reportChrome(title: string, subtitle: string) {
  const { regular } = fonts();
  const face = `<style>@font-face{font-family:"Noto Sans";src:url(data:font/ttf;base64,${regular}) format("truetype")}</style>`;

  return {
    headerTemplate: `${face}
      <div style="font-size:8px;color:#6b7280;width:100%;padding:0 16mm;font-family:'Noto Sans';display:flex;justify-content:space-between;">
        <span>${esc(title)}</span>
        <span>${esc(subtitle)}</span>
      </div>`,
    footerTemplate: `${face}
      <div style="font-size:8px;color:#6b7280;width:100%;text-align:center;font-family:'Noto Sans';">
        <span class="pageNumber"></span> / <span class="totalPages"></span>
      </div>`,
  };
}
