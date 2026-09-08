import ExcelJS from "exceljs";
import type { KitchenReportsQuery } from "./kitchen.dto";

/**
 * The kitchen's three reports as spreadsheets — same reasoning as
 * `menu-workbook.ts`: built from the exact rows the screen already fetched
 * (`KitchenService.consumptionReport`/`nutritionReport`/`purchaseReport`), so
 * a downloaded file can never disagree with what a cook sees on `/kitchen/reports`.
 * One small builder per shape rather than one generic table — the three
 * reports do not share a row shape, and forcing them to would cost more than
 * three short functions do.
 */

function rangeLabel(query: KitchenReportsQuery): string {
  return query.from === query.to ? query.from : `${query.from} — ${query.to}`;
}

function styledHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF4FF" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

export async function buildConsumptionWorkbook(
  rows: { ingredient: { name: string; unit: string }; quantity: string }[],
  query: KitchenReportsQuery,
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "NomadKids";
  book.created = new Date();

  const sheet = book.addWorksheet(`Хэрэглээ ${rangeLabel(query)}`.slice(0, 31));
  sheet.columns = [
    { header: "Орц", key: "name", width: 28 },
    { header: "Нэгж", key: "unit", width: 10 },
    { header: "Хэрэглэсэн хэмжээ", key: "quantity", width: 18 },
  ];
  styledHeader(sheet);

  for (const row of rows) {
    sheet.addRow({ name: row.ingredient.name, unit: row.ingredient.unit, quantity: row.quantity });
  }

  return (await book.xlsx.writeBuffer()) as unknown as Buffer;
}

export async function buildNutritionWorkbook(
  rows: {
    date: Date;
    totalPortions: number;
    perPortion: {
      calories: number | null;
      protein: number | null;
      fat: number | null;
      carbs: number | null;
    };
  }[],
  query: KitchenReportsQuery,
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "NomadKids";
  book.created = new Date();

  const sheet = book.addWorksheet(`Шим тэжээл ${rangeLabel(query)}`.slice(0, 31));
  sheet.columns = [
    { header: "Огноо", key: "date", width: 12 },
    { header: "Порцын тоо", key: "totalPortions", width: 12 },
    { header: "Ккал / порц", key: "calories", width: 12 },
    { header: "Уураг / порц", key: "protein", width: 12 },
    { header: "Өөх тос / порц", key: "fat", width: 14 },
    { header: "Нүүрс ус / порц", key: "carbs", width: 14 },
  ];
  styledHeader(sheet);

  for (const row of rows) {
    sheet.addRow({
      date: row.date.toISOString().slice(0, 10),
      totalPortions: row.totalPortions,
      calories: row.perPortion.calories ?? "",
      protein: row.perPortion.protein ?? "",
      fat: row.perPortion.fat ?? "",
      carbs: row.perPortion.carbs ?? "",
    });
  }

  return (await book.xlsx.writeBuffer()) as unknown as Buffer;
}

export async function buildPurchasesWorkbook(
  rows: { supplier: { name: string }; orderCount: number; totalAmount: string }[],
  query: KitchenReportsQuery,
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "NomadKids";
  book.created = new Date();

  const sheet = book.addWorksheet(`Худалдан авалт ${rangeLabel(query)}`.slice(0, 31));
  sheet.columns = [
    { header: "Нийлүүлэгч", key: "supplier", width: 28 },
    { header: "Захиалгын тоо", key: "orderCount", width: 14 },
    { header: "Нийт дүн", key: "totalAmount", width: 16 },
  ];
  styledHeader(sheet);

  for (const row of rows) {
    sheet.addRow({
      supplier: row.supplier.name,
      orderCount: row.orderCount,
      totalAmount: row.totalAmount,
    });
  }

  return (await book.xlsx.writeBuffer()) as unknown as Buffer;
}
