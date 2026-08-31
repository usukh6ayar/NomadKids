import ExcelJS from "exceljs";
import type { ReportTable } from "./finance-reports";

/**
 * A financial report as a spreadsheet — `нэмэлт.md` §16.
 *
 * ★ One builder for all eight, driven by `ReportTable`'s columns. The register
 * workbook beside it is hand-built per sheet because its three sheets are
 * genuinely different documents; these eight share a shape — a title, a header
 * row, rows, a bold total — and eight near-identical builders would be eight
 * places to fix the same formatting bug.
 *
 * ★★ **Money is written as a number with a format, never as a pre-formatted
 * string.** `"1 200 000₮"` in a cell is text: it will not sum, will not sort,
 * and turns the first thing an accountant does with a spreadsheet — select a
 * column and read the total — into a manual re-entry. The same decision
 * `register-workbook.ts` documents.
 */

const MONEY_FORMAT = "#,##0 ₮";

/**
 * A decimal string as a number Excel can add up.
 *
 * ★ This is the one place in the finance module where an amount becomes a
 * JavaScript number, and it is unavoidable: the xlsx format stores numerics as
 * IEEE 754 doubles, so there is nothing else to write. It is safe *here* because
 * nothing is computed afterwards — the value is the last stop before the file.
 * Every total in the sheet was summed as a `Decimal` upstream.
 */
function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function buildReportWorkbook(input: {
  table: ReportTable;
  kindergartenName: string;
  /** `2026-02`, or a school year like `2025-2026`. */
  period: string;
}): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "NomadKids";
  book.created = new Date();

  // Excel refuses a sheet name over 31 characters, and several of §16's titles
  // are longer. Truncating here rather than at the call site keeps the full
  // title in the document header, where it is read.
  const sheet = book.addWorksheet(input.table.title.slice(0, 31));

  sheet.columns = input.table.columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? 16,
    ...(column.money ? { style: { numFmt: MONEY_FORMAT } } : {}),
  }));

  const noteRows = input.table.note ? 1 : 0;
  sheet.spliceRows(1, 0, ...Array.from({ length: 3 + noteRows }, () => []));

  sheet.getCell("A1").value = `${input.kindergartenName} — ${input.table.title}`;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A2").value = input.period;
  if (input.table.note) {
    sheet.getCell("A3").value = input.table.note;
    sheet.getCell("A3").font = { italic: true, size: 10 };
  }
  sheet.getRow(4 + noteRows).font = { bold: true };

  const moneyKeys = new Set(
    input.table.columns.filter((column) => column.money).map((column) => column.key),
  );

  for (const row of input.table.rows) {
    sheet.addRow(shape(row, moneyKeys));
  }

  if (input.table.totals) {
    const total = sheet.addRow(shape(input.table.totals, moneyKeys));
    total.font = { bold: true };
  }

  /*
   * ★ An empty report gets a sentence rather than a blank grid. "There are no
   * overdue invoices" and "the export is broken" look identical otherwise, and
   * the person who most needs to tell them apart is the one filing the report.
   */
  if (input.table.rows.length === 0) {
    sheet.addRow({ [input.table.columns[0]!.key]: "Энэ хугацаанд бичлэг алга." });
  }

  return (await book.xlsx.writeBuffer()) as unknown as Buffer;
}

/** Converts the money columns to numbers, leaving everything else alone. */
function shape(
  row: Record<string, string | number | null>,
  moneyKeys: Set<string>,
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};

  for (const [key, value] of Object.entries(row)) {
    out[key] = moneyKeys.has(key) ? toNumber(value) : value;
  }

  return out;
}
