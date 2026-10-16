import ExcelJS from "exceljs";

/**
 * Reading an uploaded spreadsheet, whatever a kindergarten saved it as —
 * 2026-10-16, the client: "Эксэл оруулахад олон төрлөөс таньж оруулж болдог
 * болгоод өг".
 *
 * ★ The format is read from the **content**, never the extension
 * (CLAUDE.md §1.6):
 *
 *  - a ZIP is an `.xlsx`, and ExcelJS proves it is a workbook;
 *  - text is a CSV — or Excel's "Unicode text", which is UTF-16 with tabs.
 *    A Windows Excel in Mongolia saves CSV in windows-1251 with `;` between
 *    fields, so the encoding and the separator are both worked out here;
 *  - the legacy `.xls` (a COM compound document) and a web page saved with an
 *    `.xls` name are refused with a message that says how to re-save, rather
 *    than the bare "only .xlsx" that left people stuck.
 *
 * Both importers (`child-import.ts`, `menu-import.ts`) read the ExcelJS
 * workbook this returns, so a CSV goes through exactly the column and date
 * rules an `.xlsx` does.
 */

export type SpreadsheetSniff =
  { kind: "xlsx" } | { kind: "csv"; text: string } | { kind: "refused"; reason: string };

/** OLE2 compound document — the legacy `.xls`, and a password-protected `.xlsx`. */
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const RESAVE_HINT =
  "Excel-ээр нээгээд «Save As» → «Excel Workbook (.xlsx)» эсвэл «CSV» болгож хадгалаад дахин оруулна уу.";

export function sniffSpreadsheet(input: Buffer): SpreadsheetSniff {
  if (input.length >= 4 && input.subarray(0, 4).toString("latin1") === "PK\x03\x04") {
    return { kind: "xlsx" };
  }

  if (input.length >= 8 && input.subarray(0, 8).equals(OLE_MAGIC)) {
    return {
      kind: "refused",
      reason: `Хуучин .xls хэлбэрийн эсвэл нууц үгтэй файл байна. ${RESAVE_HINT}`,
    };
  }

  const text = decodeText(input);
  if (text === null) {
    return { kind: "refused", reason: "Зөвхөн Excel (.xlsx) эсвэл CSV файл оруулах боломжтой" };
  }

  // A government export is often an HTML table (or Excel 2003 XML) named `.xls`.
  if (/^\s*</.test(text) && /<(?:!doctype|html|table|\?xml)/i.test(text.slice(0, 2048))) {
    return {
      kind: "refused",
      reason: `Энэ файл Excel биш, вэб хуудас (HTML/XML) хэлбэртэй байна. ${RESAVE_HINT}`,
    };
  }

  return { kind: "csv", text };
}

/**
 * The workbook in the file, or `null` when it cannot be read — the importers
 * turn `null` into a row problem rather than a 500.
 */
export async function loadSpreadsheet(input: Buffer): Promise<ExcelJS.Workbook | null> {
  const sniffed = sniffSpreadsheet(input);
  const book = new ExcelJS.Workbook();

  if (sniffed.kind === "xlsx") {
    try {
      await book.xlsx.load(input as unknown as ArrayBuffer);
      return book;
    } catch {
      return null;
    }
  }
  if (sniffed.kind === "refused") return null;

  /*
   * ★ Every CSV cell stays a string. ExcelJS's own CSV reader turns anything
   * date-shaped into a `Date` by its own rules, and "05.04.2021" would come
   * back as the fifth of April or the fourth of May depending on the reader;
   * the importers already read the text forms people type, in the Mongolian
   * order.
   */
  const sheet = book.addWorksheet("CSV");
  for (const row of parseCsv(sniffed.text)) sheet.addRow(row);
  return book;
}

/**
 * Text, if the bytes are text. A BOM decides; otherwise strict UTF-8, and
 * failing that windows-1251 — what Excel on a Mongolian Windows writes for
 * "CSV". Control characters other than tab and line breaks mean binary.
 */
function decodeText(input: Buffer): string | null {
  let text: string;
  try {
    if (input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input.subarray(3));
    } else if (input[0] === 0xff && input[1] === 0xfe) {
      text = new TextDecoder("utf-16le", { fatal: true }).decode(input.subarray(2));
    } else if (input[0] === 0xfe && input[1] === 0xff) {
      text = new TextDecoder("utf-16be", { fatal: true }).decode(input.subarray(2));
    } else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(input);
      } catch {
        /*
         * windows-1251 has no Ө or Ү. The Mongolian fonts of the ANSI era put
         * them where Ukrainian's Є and Ї stand, which never occur in a
         * Mongolian roster — so those four are read back as Ө, ө, Ү, ү.
         */
        text = new TextDecoder("windows-1251")
          .decode(input)
          .replace(/[ЄєЇї]/g, (ch) => ({ Є: "Ө", є: "ө", Ї: "Ү", ї: "ү" })[ch]!);
      }
    }
  } catch {
    return null;
  }

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
  return text;
}

/**
 * RFC 4180 rows, with the separator guessed: `;`, `,` or tab, whichever
 * splits the busiest of the first lines most — a title line above the
 * headings has none, so the first line alone cannot decide.
 */
export function parseCsv(text: string): string[][] {
  const separator = guessSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === separator) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((cells) => cells.map((cell) => cell.trim()));
}

function guessSeparator(text: string): string {
  const lines = text.split(/\r\n|\n|\r/, 10);
  let best = ",";
  let bestCount = 0;
  for (const candidate of ["\t", ";", ","]) {
    const count = Math.max(0, ...lines.map((line) => line.split(candidate).length - 1));
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** A cell as trimmed text — a formula's result, rich text, a date as `YYYY-MM-DD`. */
export function cellText(cell: ExcelJS.Cell | undefined): string {
  const value = cell?.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    // A formula cell, or rich text — both carry the displayed value separately.
    if ("result" in value) {
      const result = (value as { result?: unknown }).result;
      if (result instanceof Date) return result.toISOString().slice(0, 10);
      return String(result ?? "").trim();
    }
    if ("richText" in value) {
      return (value as { richText: { text: string }[] }).richText
        .map((part) => part.text)
        .join("")
        .trim();
    }
    if ("text" in value) return String((value as { text?: unknown }).text ?? "").trim();
  }
  return String(value).trim();
}

/**
 * A heading or a label, comparable: lower case, punctuation and markers such
 * as «*» and «№» read as spaces, so «Овог:», «Нэр *» and «Төрсөн огноо
 * (он-сар-өдөр)» meet their aliases.
 */
export function normalizeHeading(raw: string): string {
  // The hyphen stays last in the class, where it is a literal. Moving it into
  // the middle would turn it into a range and silently change what matches.
  return raw
    .normalize("NFC")
    .toLowerCase()
    .replace(/[().,:;/\\_*№#"'«»-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
