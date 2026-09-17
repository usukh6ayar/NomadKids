import ExcelJS from "exceljs";
import { INVOICE_LINE_TYPE_LABEL, INVOICE_STATUS_LABEL } from "@kinder/contracts";

/**
 * The accountant's invoice register as a spreadsheet — `нэмэлт.md` §7, and the
 * client's 2026-09-17 design, which puts "Экспорт" over the table.
 *
 * ★ Built from the same rows the screen lists.
 *
 * `InvoicesService.list` is what produces them, filters and all, so a file
 * downloaded from this screen holds exactly the invoices the screen was
 * showing — the rule `menu-workbook.ts` states for its own export, and the
 * reason neither re-queries.
 *
 * ★★ Money goes in as a **number**, not a formatted string. An accountant
 * sums this column; `"150 000₮"` is text and sums to nothing. The currency
 * lives in the cell's number format instead, which is what a spreadsheet is
 * for.
 */
export interface RegisterRow {
  number: string | null;
  child: { lastName: string | null; firstName: string; group: { name: string } | null };
  baseAmount: string;
  mealAmount: string;
  extraAmount: string;
  discountAmount: string;
  totalDue: string;
  paidAmount: string;
  balance: string;
  status: string;
  dueDate: Date | string;
  createdAt: Date | string;
}

function chargeLabel(row: RegisterRow): string {
  const parts: string[] = [];
  if (Number(row.baseAmount) > 0) parts.push(INVOICE_LINE_TYPE_LABEL.TUITION);
  if (Number(row.mealAmount) > 0) parts.push(INVOICE_LINE_TYPE_LABEL.MEAL);
  if (Number(row.extraAmount) > 0) parts.push("Нэмэлт");
  return parts.join(", ");
}

function asDate(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export async function buildInvoiceRegisterWorkbook(
  rows: RegisterRow[],
  kindergartenName: string,
  rangeLabel: string,
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "NomadKids";
  book.created = new Date();

  const sheet = book.addWorksheet("Нэхэмжлэл");
  sheet.columns = [
    { header: "Нэхэмжлэх №", key: "number", width: 16 },
    { header: "Хүүхэд", key: "child", width: 26 },
    { header: "Бүлэг", key: "group", width: 16 },
    { header: "Төлбөрийн төрөл", key: "charges", width: 26 },
    { header: "Дүн", key: "totalDue", width: 14 },
    { header: "Хөнгөлөлт", key: "discount", width: 12 },
    { header: "Төлсөн", key: "paid", width: 14 },
    { header: "Үлдэгдэл", key: "balance", width: 14 },
    { header: "Төлөв", key: "status", width: 16 },
    { header: "Төлөх хугацаа", key: "dueDate", width: 14 },
    { header: "Үүсгэсэн", key: "createdAt", width: 14 },
  ];

  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow({
      number: row.number ?? "",
      child: `${row.child.lastName ? `${row.child.lastName} ` : ""}${row.child.firstName}`,
      group: row.child.group?.name ?? "",
      charges: chargeLabel(row),
      totalDue: Number(row.totalDue),
      discount: Number(row.discountAmount),
      paid: Number(row.paidAmount),
      balance: Number(row.balance),
      status: INVOICE_STATUS_LABEL[row.status as keyof typeof INVOICE_STATUS_LABEL] ?? row.status,
      dueDate: asDate(row.dueDate),
      createdAt: asDate(row.createdAt),
    });
  }

  for (const key of ["totalDue", "discount", "paid", "balance"]) {
    sheet.getColumn(key).numFmt = "#,##0";
  }

  /*
    The totals row an accountant would otherwise add by hand, as real formulas
    so it survives a filtered re-sort in Excel.
  */
  if (rows.length > 0) {
    const last = rows.length + 1;
    const totals = sheet.addRow({
      number: "Нийт",
      totalDue: { formula: `SUM(E2:E${last})` },
      discount: { formula: `SUM(F2:F${last})` },
      paid: { formula: `SUM(G2:G${last})` },
      balance: { formula: `SUM(H2:H${last})` },
    });
    totals.font = { bold: true };
  }

  const header = sheet.insertRow(1, [`${kindergartenName} — нэхэмжлэлийн бүртгэл, ${rangeLabel}`]);
  header.font = { bold: true, size: 12 };
  sheet.mergeCells(1, 1, 1, sheet.columns.length);

  return (await book.xlsx.writeBuffer()) as unknown as Buffer;
}
