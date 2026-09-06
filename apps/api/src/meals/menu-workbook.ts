import ExcelJS from "exceljs";
import type { MenuDishLike } from "./dish-json";

/**
 * The weekly menu as a spreadsheet — client request, 2026-09-05: "хоолны цэс
 * иг өдрөөр, 7 хоногоор, сараар нь Excel хэлбэрээр татаж авах". One workbook
 * shape covers all three; the range is just how wide `days` is.
 *
 * ★ Same source, same audience as `/menu/with-warnings`.
 *
 * This is built from `MealsService.listWithAllergenWarnings`'s own output, so
 * a file downloaded here can never show a dish, a calorie figure or an allergy
 * warning the screen it was downloaded from did not already show.
 */

const MEAL_KIND_LABEL: Record<string, string> = {
  BREAKFAST: "Өглөөний цай",
  MID_MORNING_SNACK: "Жүүс",
  LUNCH: "Өдрийн хоол",
  AFTERNOON_SNACK: "Их үдийн цай",
  EXTRA: "Оройн хоол",
};

const MEAL_KIND_ORDER = ["BREAKFAST", "MID_MORNING_SNACK", "LUNCH", "AFTERNOON_SNACK", "EXTRA"];

const WEEKDAY_LABEL = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"];

export interface ExportMenuDay {
  date: Date;
  dishes: MenuDishLike[];
  warnings: { childName: string; allergen: string; dishName: string | null }[];
}

export async function buildMenuWorkbook(
  days: ExportMenuDay[],
  kindergartenName: string,
  rangeLabel: string,
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "NomadKids";
  book.created = new Date();

  const sheet = book.addWorksheet("Хоолны цэс");
  sheet.columns = [
    { header: "Огноо", key: "date", width: 12 },
    { header: "Гараг", key: "weekday", width: 10 },
    { header: "Хоолны цаг", key: "kind", width: 16 },
    { header: "Хоолны нэр", key: "name", width: 30 },
    { header: "Порц", key: "portions", width: 8 },
    { header: "Ккал", key: "calories", width: 8 },
    { header: "Харшлын шошго", key: "allergenTags", width: 24 },
    { header: "Тэмдэглэл", key: "note", width: 28 },
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF4FF" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const day of days) {
    const dateLabel = day.date.toISOString().slice(0, 10);
    const weekday = WEEKDAY_LABEL[day.date.getUTCDay()];

    if (day.dishes.length === 0) {
      sheet.addRow({
        date: dateLabel,
        weekday,
        kind: "",
        name: "Цэс төлөвлөгдөөгүй",
        portions: "",
        calories: "",
        allergenTags: "",
        note: "",
      });
      continue;
    }

    // Undated (`kind` absent) dishes sort last rather than dropping off —
    // legacy rows written before every dish carried a sitting.
    const sorted = [...day.dishes].sort((x, y) => {
      const xi = MEAL_KIND_ORDER.indexOf(x.kind ?? "");
      const yi = MEAL_KIND_ORDER.indexOf(y.kind ?? "");
      return (xi === -1 ? MEAL_KIND_ORDER.length : xi) - (yi === -1 ? MEAL_KIND_ORDER.length : yi);
    });

    for (const dish of sorted) {
      sheet.addRow({
        date: dateLabel,
        weekday,
        kind: dish.kind ? (MEAL_KIND_LABEL[dish.kind] ?? dish.kind) : "",
        name: dish.name,
        portions: dish.portions ?? "",
        calories: dish.calories ?? "",
        allergenTags: dish.allergenTags.join(", "),
        note: dish.note ?? "",
      });
    }
  }

  const warnings = days.flatMap((day) =>
    day.warnings.map((warning) => ({ date: day.date.toISOString().slice(0, 10), ...warning })),
  );

  // Omitted entirely when there is nothing to say, rather than an empty sheet
  // with just a header row — a kitchen with no allergic children this week
  // should not have to open a blank tab to confirm that.
  if (warnings.length > 0) {
    const warnSheet = book.addWorksheet("Харшлын анхаарал");
    warnSheet.columns = [
      { header: "Огноо", key: "date", width: 12 },
      { header: "Хүүхэд", key: "childName", width: 24 },
      { header: "Харшил", key: "allergen", width: 20 },
      { header: "Хоол", key: "dishName", width: 24 },
    ];
    const warnHeader = warnSheet.getRow(1);
    warnHeader.font = { bold: true };
    warnHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBE4D5" } };

    for (const warning of warnings) {
      warnSheet.addRow({
        date: warning.date,
        childName: warning.childName,
        allergen: warning.allergen,
        dishName: warning.dishName ?? "",
      });
    }
  }

  const about = book.addWorksheet("Тайлбар");
  about.columns = [{ width: 24 }, { width: 44 }];
  about.addRow(["Цэцэрлэг", kindergartenName]).getCell(1).font = { bold: true };
  about.addRow(["Хугацаа", rangeLabel]).getCell(1).font = { bold: true };
  about.addRow(["Татсан огноо", new Date().toLocaleDateString("mn-MN")]).getCell(1).font = {
    bold: true,
  };

  return (await book.xlsx.writeBuffer()) as unknown as Buffer;
}
