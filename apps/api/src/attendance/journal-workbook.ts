import ExcelJS from "exceljs";
/*
 * ★ Labels from `@kinder/contracts`, shared with the web app — the reason
 * `funding/register-workbook.ts` gives for the same import: a spreadsheet is
 * opened by somebody who never sees this product, so the header row has to
 * read on its own, and a second copy of those six words is how "Хагас өдөр"
 * becomes "Хагас хоног" on one surface.
 */
import { ATTENDANCE_STATUS_LABEL } from "@kinder/contracts";

export interface JournalCell {
  status: string;
  note: string | null;
}

export interface JournalRow {
  child: { lastName: string | null; firstName: string };
  group: { name: string };
  days: (JournalCell | null)[];
  counts: Record<string, number>;
}

export interface JournalWorkbookInput {
  kindergartenName: string;
  from: string;
  to: string;
  days: string[];
  rows: JournalRow[];
  totals: Record<string, number>;
}

/** The six the column can hold. Order is the one the screen uses. */
const STATUS_ORDER = ["PRESENT", "HALF_DAY", "EXCUSED", "SICK", "ABSENT", "OTHER"] as const;

/**
 * The attendance journal as a spreadsheet — a child per row, a day per column.
 *
 * ★ **Not the same file as `funding/register-workbook.ts`**, whose first sheet
 * is also called "Ирцийн дэлгэрэнгүй". That one summarises a month: how many
 * days each child was present, sick, away. This one is the grid those totals
 * are counted from — one cell per child per day — and it takes a date range
 * rather than a month.
 *
 * An accountant asked "why is this child's figure 18" needs this file; an
 * accountant filing the claim needs that one. Producing the second from the
 * first is arithmetic, and producing the first from the second is impossible.
 *
 * ★★ Two sheets. The grid is unreadable as a summary and the summary is
 * useless for checking a day, and a sheet can be sent on alone.
 */
export async function buildJournalWorkbook(input: JournalWorkbookInput): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "NomadKids";
  book.created = new Date();

  gridSheet(book, input);
  summarySheet(book, input);

  return (await book.xlsx.writeBuffer()) as unknown as Buffer;
}

function gridSheet(book: ExcelJS.Workbook, input: JournalWorkbookInput): void {
  const sheet = book.addWorksheet("Өдөр тутмын ирц");

  sheet.columns = [
    { header: "Хүүхэд", key: "child", width: 26 },
    { header: "Бүлэг", key: "group", width: 16 },
    // Day-of-month headers; the full range is on the title row above.
    ...input.days.map((day) => ({
      header: day.slice(8, 10),
      key: day,
      width: 5,
    })),
  ];

  sheet.spliceRows(1, 0, [`${input.kindergartenName} — ирцийн дэлгэрэнгүй`]);
  sheet.spliceRows(2, 0, [`${input.from} – ${input.to}`]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.getRow(3).font = { bold: true };
  // The name column stays put while the days scroll, same as on screen.
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 3 }];

  for (const row of input.rows) {
    const cells: Record<string, string> = {
      child: `${row.child.lastName ?? ""} ${row.child.firstName}`.trim(),
      group: row.group.name,
    };
    row.days.forEach((cell, index) => {
      /*
       * ★ An empty cell for a day nobody marked, never a dash and never
       * "Тасалсан".
       *
       * A reader can tell blank from absent at a glance, and — the reason that
       * matters — `COUNTIF` can too. A dash would make every unmarked day a
       * value to be filtered around in the file this claim is checked from.
       */
      cells[input.days[index]!] = cell ? (ATTENDANCE_STATUS_LABEL[cell.status] ?? cell.status) : "";
    });
    sheet.addRow(cells);
  }
}

function summarySheet(book: ExcelJS.Workbook, input: JournalWorkbookInput): void {
  const sheet = book.addWorksheet("Дүн");

  sheet.columns = [
    { header: "Хүүхэд", key: "child", width: 26 },
    { header: "Бүлэг", key: "group", width: 16 },
    ...STATUS_ORDER.map((status) => ({
      header: ATTENDANCE_STATUS_LABEL[status] ?? status,
      key: status,
      width: 12,
    })),
    { header: "Бүртгэсэн хоног", key: "recorded", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of input.rows) {
    sheet.addRow({
      child: `${row.child.lastName ?? ""} ${row.child.firstName}`.trim(),
      group: row.group.name,
      // ★ Numbers, not strings — an accountant sums this column, and a
      // right-aligned string that looks like a number does not add up.
      ...Object.fromEntries(STATUS_ORDER.map((s) => [s, row.counts[s] ?? 0])),
      recorded: Object.values(row.counts).reduce((sum, n) => sum + n, 0),
    });
  }

  const total = sheet.addRow({
    child: "Нийт",
    ...Object.fromEntries(STATUS_ORDER.map((s) => [s, input.totals[s] ?? 0])),
    recorded: Object.values(input.totals).reduce((sum, n) => sum + n, 0),
  });
  total.font = { bold: true };
}
