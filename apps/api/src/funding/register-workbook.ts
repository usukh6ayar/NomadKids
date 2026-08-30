import ExcelJS from "exceljs";
/*
 * ★ The labels come from `@kinder/contracts`, shared with the web app.
 *
 * The API names things in codes everywhere except here: a spreadsheet is
 * opened in Excel by somebody who never sees this product, so its header row
 * has to read on its own. That is a reason to translate, not a reason to keep
 * a second copy of the words the screen already uses.
 */
import {
  ATTENDANCE_STATUS_LABEL,
  FUNDING_SOURCE_LABEL,
  REGISTER_STATE_LABEL,
  type FundingSource,
  type RegisterState,
} from "@kinder/contracts";

/**
 * The monthly register as a spreadsheet — нэмэлт.md §16.
 *
 * ★ Two sheets, because the screen has two tabs.
 *
 * "Ирцийн дэлгэрэнгүй" and "Санхүүгийн тооцоо" answer to different readers: a
 * director checking who was away, and an accountant reconciling a claim. One
 * twenty-column sheet would serve neither — the accountant would scroll past
 * six attendance columns to reach a figure, and the director past six money
 * columns they may not be entitled to discuss. Splitting them also means a
 * sheet can be sent on alone.
 *
 * ★★ A third sheet records the rules the figures were produced under.
 *
 * A month's numbers are only defensible beside the tariff that produced them,
 * and that tariff can change next month. Without it the file says "₮22,500" and
 * cannot say why; with it, the same file answers an auditor a year later.
 */

export interface WorkbookRow {
  child: { lastName: string; firstName: string };
  group: { name: string } | null;
  counts: Record<string, number>;
  mealDays: number;
  undocumentedDays: number;
  funding: {
    source: string;
    daysFed: number;
    dailyRate: string | null;
    grossAmount: string;
    deductionAmount: string;
    netAmount: string;
    approvedAmount: string | null;
    receivedAmount: string | null;
  } | null;
  state: string;
}

export interface WorkbookInput {
  month: string;
  kindergartenName: string;
  workingDays: number;
  rows: WorkbookRow[];
  totals: {
    children: number;
    counts: Record<string, number>;
    mealDays: number;
    grossAmount: string;
    deductionAmount: string;
    netAmount: string;
    approvedAmount: string;
    receivedAmount: string;
  };
  rules: {
    name: string;
    source: string;
    dailyRate: string | null;
    monthlyRate: string | null;
    dependsOnAttendance: boolean;
    dependsOnMeals: boolean;
    effectiveFrom: string;
    effectiveTo: string | null;
    note: string | null;
  }[];
}

/** Tögrög, as a number Excel can sum — never a pre-formatted string. */
const MONEY = "#,##0 ₮";

function money(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function buildRegisterWorkbook(input: WorkbookInput): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "NomadKids";
  book.created = new Date();

  attendanceSheet(book, input);
  fundingSheet(book, input);
  rulesSheet(book, input);

  return (await book.xlsx.writeBuffer()) as unknown as Buffer;
}

function attendanceSheet(book: ExcelJS.Workbook, input: WorkbookInput): void {
  const sheet = book.addWorksheet("Ирцийн дэлгэрэнгүй");

  sheet.columns = [
    { header: "Хүүхэд", key: "child", width: 26 },
    { header: "Бүлэг", key: "group", width: 16 },
    { header: ATTENDANCE_STATUS_LABEL.PRESENT, key: "PRESENT", width: 10 },
    { header: ATTENDANCE_STATUS_LABEL.HALF_DAY, key: "HALF_DAY", width: 12 },
    { header: ATTENDANCE_STATUS_LABEL.SICK, key: "SICK", width: 10 },
    { header: ATTENDANCE_STATUS_LABEL.EXCUSED, key: "EXCUSED", width: 10 },
    { header: ATTENDANCE_STATUS_LABEL.ABSENT, key: "ABSENT", width: 11 },
    { header: ATTENDANCE_STATUS_LABEL.OTHER, key: "OTHER", width: 10 },
    { header: "Хоолны хоног", key: "mealDays", width: 14 },
    { header: "Актгүй хоног", key: "undocumentedDays", width: 14 },
    { header: "Төлөв", key: "state", width: 18 },
  ];

  titleRows(sheet, input, "Ирцийн дэлгэрэнгүй");

  for (const row of input.rows) {
    sheet.addRow({
      child: `${row.child.lastName} ${row.child.firstName}`,
      group: row.group?.name ?? "—",
      ...row.counts,
      mealDays: row.mealDays,
      undocumentedDays: row.undocumentedDays,
      state: REGISTER_STATE_LABEL[row.state as RegisterState] ?? row.state,
    });
  }

  const total = sheet.addRow({
    child: "Нийт дүн",
    group: `${input.totals.children} хүүхэд`,
    ...input.totals.counts,
    mealDays: input.totals.mealDays,
    undocumentedDays: input.rows.reduce((sum, row) => sum + row.undocumentedDays, 0),
  });
  total.font = { bold: true };
}

function fundingSheet(book: ExcelJS.Workbook, input: WorkbookInput): void {
  const sheet = book.addWorksheet("Санхүүгийн тооцоо");

  sheet.columns = [
    { header: "Хүүхэд", key: "child", width: 26 },
    { header: "Бүлэг", key: "group", width: 16 },
    { header: "Эх үүсвэр", key: "source", width: 20 },
    { header: "Хоолны хоног", key: "daysFed", width: 14 },
    { header: "Өдрийн тариф", key: "dailyRate", width: 14, style: { numFmt: MONEY } },
    { header: "Нийт төлбөр", key: "grossAmount", width: 15, style: { numFmt: MONEY } },
    { header: "Суутгал", key: "deductionAmount", width: 14, style: { numFmt: MONEY } },
    { header: "Эцсийн төлбөр", key: "netAmount", width: 15, style: { numFmt: MONEY } },
    { header: "Баталгаажсан", key: "approvedAmount", width: 15, style: { numFmt: MONEY } },
    { header: "Хүлээн авсан", key: "receivedAmount", width: 15, style: { numFmt: MONEY } },
    { header: "Төлөв", key: "state", width: 18 },
  ];

  titleRows(sheet, input, "Санхүүгийн тооцоо");

  for (const row of input.rows) {
    sheet.addRow({
      child: `${row.child.lastName} ${row.child.firstName}`,
      group: row.group?.name ?? "—",
      source: row.funding
        ? (FUNDING_SOURCE_LABEL[row.funding.source as FundingSource] ?? row.funding.source)
        : "—",
      daysFed: row.funding?.daysFed ?? null,
      dailyRate: money(row.funding?.dailyRate),
      grossAmount: money(row.funding?.grossAmount),
      deductionAmount: money(row.funding?.deductionAmount),
      netAmount: money(row.funding?.netAmount),
      approvedAmount: money(row.funding?.approvedAmount),
      receivedAmount: money(row.funding?.receivedAmount),
      state: REGISTER_STATE_LABEL[row.state as RegisterState] ?? row.state,
    });
  }

  const total = sheet.addRow({
    child: "Нийт дүн",
    group: `${input.totals.children} хүүхэд`,
    grossAmount: money(input.totals.grossAmount),
    deductionAmount: money(input.totals.deductionAmount),
    netAmount: money(input.totals.netAmount),
    approvedAmount: money(input.totals.approvedAmount),
    receivedAmount: money(input.totals.receivedAmount),
  });
  total.font = { bold: true };
}

function rulesSheet(book: ExcelJS.Workbook, input: WorkbookInput): void {
  const sheet = book.addWorksheet("Тооцооллын дүрэм");

  sheet.columns = [
    { header: "Дүрэм", key: "name", width: 30 },
    { header: "Эх үүсвэр", key: "source", width: 20 },
    { header: "Өдрийн тариф", key: "dailyRate", width: 14, style: { numFmt: MONEY } },
    { header: "Сарын тариф", key: "monthlyRate", width: 14, style: { numFmt: MONEY } },
    { header: "Юунаас хамаарах", key: "dependsOn", width: 24 },
    { header: "Хүчинтэй", key: "effective", width: 24 },
    { header: "Тайлбар", key: "note", width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const rule of input.rules) {
    sheet.addRow({
      name: rule.name,
      source: FUNDING_SOURCE_LABEL[rule.source as FundingSource] ?? rule.source,
      dailyRate: money(rule.dailyRate),
      monthlyRate: money(rule.monthlyRate),
      dependsOn: dependsLabel(rule),
      effective: `${rule.effectiveFrom} — ${rule.effectiveTo ?? "одоог хүртэл"}`,
      note: rule.note ?? "",
    });
  }
}

/** §5's two flags, in the words the rule card on screen uses. */
function dependsLabel(rule: { dependsOnAttendance: boolean; dependsOnMeals: boolean }): string {
  if (rule.dependsOnAttendance && rule.dependsOnMeals) return "Ирц ба хоол";
  if (rule.dependsOnMeals) return "Хооллосон өдөр";
  if (rule.dependsOnAttendance) return "Ирсэн өдөр";
  return "Ирцээс үл хамаарна";
}

/**
 * The two lines above every sheet's header row.
 *
 * ★ The working-day count travels with the file.
 *
 * "Суутгал" is measured against a full month, and a full month here is however
 * many days the kindergarten actually opened — not a number anyone can recover
 * from the columns. A file that omitted it would be arithmetic nobody can
 * check.
 */
function titleRows(sheet: ExcelJS.Worksheet, input: WorkbookInput, tab: string): void {
  sheet.spliceRows(1, 0, [], [], []);
  sheet.getCell("A1").value = `${input.kindergartenName} — ${tab}`;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A2").value = `${input.month} сар · ажлын ${input.workingDays} өдөр`;
  sheet.getRow(4).font = { bold: true };
}
