import ExcelJS from "exceljs";
/*
 * ★ Labels from `@kinder/contracts`, shared with the web app — the reason
 * `funding/register-workbook.ts` gives for the same import: a spreadsheet is
 * opened by somebody who never sees this product, so the header row has to
 * read on its own, and a second copy of those six words is how "Хагас өдөр"
 * becomes "Хагас хоног" on one surface.
 */
import { ATTENDANCE_STATUS_LABEL } from "@kinder/contracts";
import { summariseDays, type SubmissionFact } from "./daily-summary";

export interface JournalCell {
  status: string;
  note: string | null;
  /**
   * Provenance, for the day sheet's "Үүссэн" and "Үүсгэсэн хэрэглэгч" columns.
   *
   * Optional because the grid and summary sheets never read them, and the two
   * callers that build a `JournalCell` for those sheets should not have to
   * invent values they do not use.
   */
  createdAt?: Date;
  recordedBy?: { lastName: string | null; firstName: string } | null;
}

export interface JournalRow {
  child: { lastName: string | null; firstName: string };
  group: { name: string };
  schoolYear?: { name: string } | null;
  days: (JournalCell | null)[];
  counts: Record<string, number>;
}

/** One class's figures over the whole range — the export's "Ангийн дүн" sheet. */
export interface JournalGroupTotals {
  group: string;
  children: number;
  counts: Record<string, number>;
  recorded: number;
}

export interface JournalWorkbookInput {
  kindergartenName: string;
  from: string;
  to: string;
  days: string[];
  rows: JournalRow[];
  totals: Record<string, number>;
  /**
   * Per-class totals, as the screen shows them under the grid.
   *
   * ★ Optional so the two other callers of this builder need not invent them;
   * when absent the sheet is simply not written, rather than written empty.
   */
  groups?: JournalGroupTotals[];
  /** What has already been submitted — the "Илгээсэн" column on the day sheet. */
  submissions?: SubmissionFact[];
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
  groupSheet(book, input);
  daySheet(book, input);

  return (await book.xlsx.writeBuffer()) as unknown as Buffer;
}

/**
 * The four a register tallies, and what each counts.
 *
 * ★ Exact statuses, not merged — the same four the teacher's grid draws down
 * its own foot. "Ирсэн" here therefore means `PRESENT` and nothing else;
 * `HALF_DAY` and `OTHER` are in "Нийт" and in the "Дүн" sheet's own columns,
 * where they have a column each. Merging a half day into Ирсэн is a policy
 * call that moves a funding figure, and the sheet that mirrors a screen is not
 * the place to make it — `TOTAL_COLUMNS` on the director's journal records the
 * same reasoning for the same reason.
 */
const TALLY = [
  { label: "Ирсэн", status: "PRESENT" },
  { label: "Өвчтэй", status: "SICK" },
  { label: "Чөлөөтэй", status: "EXCUSED" },
  { label: "Тасалсан", status: "ABSENT" },
] as const;

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
    /*
     * ★ The screen's own trailing columns and footer rows — 2026-09-12, at the
     * client's report that "татаж авахаар нийт бодолтууд ерөөсөө орохгүй байна".
     *
     * They were right about this sheet: it was the grid and only the grid, so
     * the file a teacher downloaded to check a month dropped every figure the
     * screen had computed under and beside it. The totals existed on the other
     * sheets, which is no help to somebody reading the one that looks like what
     * they were just looking at. A sheet that mirrors a screen mirrors all of
     * it.
     */
    ...TALLY.map((column) => ({ header: column.label, key: `t_${column.status}`, width: 10 })),
    { header: "Нийт", key: "t_total", width: 10 },
  ];

  sheet.spliceRows(1, 0, [`${input.kindergartenName} — ирцийн дэлгэрэнгүй`]);
  sheet.spliceRows(2, 0, [`${input.from} – ${input.to}`]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.getRow(3).font = { bold: true };
  // The name column stays put while the days scroll, same as on screen.
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 3 }];

  /** Counted per day for the footer, in one pass over the same cells. */
  const perDay = new Map<string, Record<string, number>>(input.days.map((day) => [day, {}]));

  for (const row of input.rows) {
    const cells: Record<string, string | number> = {
      child: `${row.child.lastName ?? ""} ${row.child.firstName}`.trim(),
      group: row.group.name,
    };
    row.days.forEach((cell, index) => {
      if (cell) {
        const counts = perDay.get(input.days[index]!)!;
        counts[cell.status] = (counts[cell.status] ?? 0) + 1;
      }
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

    // ★ Numbers, not strings — an accountant sums these columns.
    for (const column of TALLY) cells[`t_${column.status}`] = row.counts[column.status] ?? 0;
    cells.t_total = Object.values(row.counts).reduce((sum, count) => sum + count, 0);

    sheet.addRow(cells);
  }

  // A blank line between the register and the figures counted from it.
  sheet.addRow({});

  for (const column of TALLY) {
    const cells: Record<string, string | number> = { child: column.label };
    let total = 0;
    for (const day of input.days) {
      const count = perDay.get(day)![column.status] ?? 0;
      cells[day] = count;
      total += count;
    }
    cells[`t_${column.status}`] = total;
    sheet.addRow(cells);
  }

  const totalRow: Record<string, string | number> = { child: "Нийт" };
  let recorded = 0;
  for (const day of input.days) {
    const marks = Object.values(perDay.get(day)!).reduce((sum, count) => sum + count, 0);
    totalRow[day] = marks;
    recorded += marks;
  }
  totalRow.t_total = recorded;
  sheet.addRow(totalRow).font = { bold: true };
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

/**
 * "Ангийн дүн" — a row per class, over the whole range.
 *
 * ★ 2026-09-12, at the client's instruction that the screen's class totals come
 * down with the file ("татахад энэ мэдээлэл бүхлээрээ татагддаг байна,
 * бодолтууд бүгд орно").
 *
 * The figures are the service's, not this file's: `buildRegister` counts them
 * once over every matching child and hands the same array to the screen and to
 * here. A sheet that summed the rows again would be a second definition of
 * "recorded", and the only way anybody would find out is an inspection.
 */
function groupSheet(book: ExcelJS.Workbook, input: JournalWorkbookInput): void {
  const groups = input.groups ?? [];
  if (groups.length === 0) return;

  const sheet = book.addWorksheet("Ангийн дүн");

  sheet.columns = [
    { header: "Анги", key: "group", width: 20 },
    { header: "Хүүхэд", key: "children", width: 10 },
    ...STATUS_ORDER.map((status) => ({
      header: ATTENDANCE_STATUS_LABEL[status] ?? status,
      key: status,
      width: 12,
    })),
    { header: "Бүртгэсэн хоног", key: "recorded", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const group of groups) {
    sheet.addRow({
      group: group.group,
      children: group.children,
      ...Object.fromEntries(STATUS_ORDER.map((s) => [s, group.counts[s] ?? 0])),
      recorded: group.recorded,
    });
  }

  const total = sheet.addRow({
    group: "Нийт",
    children: groups.reduce((sum, g) => sum + g.children, 0),
    ...Object.fromEntries(STATUS_ORDER.map((s) => [s, input.totals[s] ?? 0])),
    recorded: groups.reduce((sum, g) => sum + g.recorded, 0),
  });
  total.font = { bold: true };
}

/**
 * "Өдрийн дүн" — a row per group per day.
 *
 * ★ The arithmetic is `summariseDays`, not a second copy of it.
 *
 * The same rows are drawn on `/attendance/daily`, and a "Ирц бүрэн" that
 * counted the roster on the screen and the recorded rows in the file would be
 * a disagreement nobody notices until an inspection. This function is layout
 * only: it decides column widths and how a missing value is written.
 *
 * ★★ **`Илгээсэн` is always an em dash, and that is not an oversight.**
 *
 * `summariseDays` returns `sentAt: null` for every row because this system
 * cannot send anything to ESIS yet — `docs/ESIS_API_READINESS.md` §1
 * records that access is a contract with the ministry rather than a signup.
 * The column is present so the file's shape matches the register it is compared
 * against, and empty rather than invented: a "Тийм" here would be a claim about
 * a submission that never happened.
 */
function daySheet(book: ExcelJS.Workbook, input: JournalWorkbookInput): void {
  const sheet = book.addWorksheet("Өдрийн дүн");

  sheet.columns = [
    { header: "Хичээлийн жил", key: "schoolYear", width: 16 },
    { header: "Сургууль, цэцэрлэг", key: "kindergarten", width: 24 },
    { header: "Анги", key: "group", width: 16 },
    { header: "Огноо", key: "date", width: 12 },
    { header: "Ирц бүртгээгүй", key: "unrecorded", width: 15 },
    { header: "Ирц бүрэн", key: "complete", width: 11 },
    { header: "Сурагчийн тоо", key: "expected", width: 14 },
    { header: "Ирсэн", key: "present", width: 9 },
    { header: "Чөлөөтэй", key: "excused", width: 11 },
    { header: "Өвчтэй", key: "sick", width: 10 },
    { header: "Тасалсан", key: "absent", width: 11 },
    { header: "Илгээсэн", key: "sent", width: 11 },
    { header: "Үүссэн", key: "createdAt", width: 18 },
    { header: "Үүсгэсэн хэрэглэгч (Web)", key: "createdBy", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of summariseDays(input.rows, input.days, input.submissions ?? [])) {
    sheet.addRow({
      schoolYear: row.schoolYear,
      kindergarten: input.kindergartenName,
      group: row.group,
      date: row.date,
      unrecorded: row.unrecorded,
      complete: row.complete ? "Тийм" : "Үгүй",
      expected: row.expected,
      present: row.present,
      excused: row.excused,
      sick: row.sick,
      absent: row.absent,
      sent: row.sentAt ? formatStamp(new Date(row.sentAt)) : EM_DASH,
      createdAt: row.createdAt ? formatStamp(new Date(row.createdAt)) : EM_DASH,
      createdBy: row.createdBy.length > 0 ? row.createdBy.join(", ") : EM_DASH,
    });
  }
}

/** What an absent value reads as. A blank cell reads as "not applicable". */
const EM_DASH = "—";

/**
 * `YYYY-MM-DD HH:mm`, in UTC.
 *
 * ★ Not the server's local zone. The file is read next to a register whose
 * dates are UTC day keys throughout this module, and a stamp an hour off from
 * the day it sits beside is worse than a coarse one.
 */
function formatStamp(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}
