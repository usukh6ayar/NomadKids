import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseMenuWorkbook } from "../src/meals/menu-import";

async function workbook(rows: unknown[][], sheetName = "Цэс") {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(sheetName);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe("menu spreadsheet import", () => {
  it("finds reordered columns below a title and reads year, month, day and calories", async () => {
    const input = await workbook([
      ["2026 оны 9 сарын хоолны цэс"],
      [],
      ["Хоолны төрөл", "Илчлэг (ккал)", "Сар", "Хоолны нэр", "Өдөр", "Он"],
      ["Өглөөний цай", "125 ккал", 9, "Каш", 19, 2026],
      ["Өдрийн хоол", 320, 9, "Шөл", 19, 2026],
    ]);
    const result = await parseMenuWorkbook(input);
    expect(result.problems).toEqual([]);
    expect(result.days).toEqual([
      {
        date: "2026-09-19",
        dishes: [
          expect.objectContaining({ name: "Каш", kind: "BREAKFAST", calories: 125 }),
          expect.objectContaining({ name: "Шөл", kind: "LUNCH", calories: 320 }),
        ],
      },
    ]);
  });

  it("reads a later sheet and fills down dates for subsequent dishes", async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet("Тайлбар").addRow(["Тайлбар"]);
    const sheet = book.addWorksheet("Хоолны цэс");
    sheet.addRow(["Date", "Dish", "Meal type", "Calories"]);
    sheet.addRow(["19.09.2026", "Тараг", "Өглөөний цай", 100]);
    sheet.addRow(["", "Шөл", "Өдрийн хоол", 300]);
    const result = await parseMenuWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(result.days).toHaveLength(1);
    expect(result.days[0]?.dishes).toHaveLength(2);
  });

  it("does not treat unrecognized sheets as empty days", async () => {
    const result = await parseMenuWorkbook(
      await workbook([["Тайлбар"], ["Хоол", "Илчлэг"], ["Шөл", 300]]),
    );
    expect(result.days).toEqual([]);
    expect(result.problems).toHaveLength(1);
  });

  it("imports a weekly matrix with dates across the top", async () => {
    const input = await workbook(
      [
        ["2026-2027 ОНЫ ХООЛНЫ ТӨЛӨВЛӨГӨӨ"],
        ["I долоо хоног"],
        ["ГАРИГ", new Date("2026-09-21T00:00:00Z"), new Date("2026-09-22T00:00:00Z")],
        ["Өглөөний хоол", "Сүүтэй будаа", "Шар будаатай шөл"],
        ["Бага үдийн цай", "Жимс", "Тараг"],
        ["Үндсэн хоол", "Ногоотой шөл", "Будаатай хуурга"],
        ["Их үдийн цай", "Аарц", "Сүү"],
        ["", "Тэжээллэг боов", "Талх"],
      ],
      "Хоолны төлөвлөгөө",
    );

    const result = await parseMenuWorkbook(input);
    expect(result.problems).toEqual([]);
    expect(result.days).toEqual([
      expect.objectContaining({
        date: "2026-09-21",
        dishes: expect.arrayContaining([
          expect.objectContaining({ name: "Сүүтэй будаа", kind: "BREAKFAST" }),
          expect.objectContaining({ name: "Тэжээллэг боов", kind: "AFTERNOON_SNACK" }),
        ]),
      }),
      expect.objectContaining({
        date: "2026-09-22",
        dishes: expect.arrayContaining([
          expect.objectContaining({ name: "Будаатай хуурга", kind: "LUNCH" }),
        ]),
      }),
    ]);
  });
});
