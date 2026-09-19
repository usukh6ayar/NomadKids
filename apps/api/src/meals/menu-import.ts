import ExcelJS from "exceljs";

/**
 * Reading a week's menu back out of a spreadsheet — the client's 2026-09-11
 * request: "хоолны цэсийг тогооч ба багш дээр хүснэгтээр экселээр оруулах хэсэг
 * нэм."
 *
 * ★ It reads exactly what `buildMenuWorkbook` writes, so the loop is
 * export → edit in Excel → import. A kitchen plans next week by downloading
 * this week and changing the names, which is the workflow a separate template
 * would break the first time a column moved.
 *
 * ★★ Every refusal is a *row*, not a thrown error.
 *
 * One mistyped sitting on line 40 must not discard the other thirty-nine. The
 * caller decides what to do with a partial result — the import endpoint offers
 * a dry run, the same shape `child-import.ts` uses — and a file the parser
 * cannot open at all is reported the same way rather than as a 500.
 */

/** The sitting names the export writes, and what a person is likely to type. */
const KIND_ALIASES: Record<string, string> = {
  "өглөөний цай": "BREAKFAST",
  өглөө: "BREAKFAST",
  breakfast: "BREAKFAST",
  жүүс: "MID_MORNING_SNACK",
  "өглөөний зууш": "MID_MORNING_SNACK",
  "үдээс өмнөх зууш": "MID_MORNING_SNACK",
  "өдрийн хоол": "LUNCH",
  үдийн: "LUNCH",
  "үдийн хоол": "LUNCH",
  lunch: "LUNCH",
  "их үдийн цай": "AFTERNOON_SNACK",
  "үдийн цай": "AFTERNOON_SNACK",
  "үдээс хойших зууш": "AFTERNOON_SNACK",
  "оройн хоол": "EXTRA",
  орой: "EXTRA",
  dinner: "EXTRA",
};

/** Common headings in both exported and independently prepared menus. */
const COLUMNS = [
  { field: "date", aliases: ["огноо", "он сар өдөр", "хоолны огноо", "date"] },
  { field: "year", aliases: ["он", "жил", "year"] },
  { field: "month", aliases: ["сар", "month"] },
  { field: "day", aliases: ["өдөр", "өдрийн тоо", "day"] },
  { field: "kind", aliases: ["хоолны цаг", "хоолны төрөл", "төрөл", "хооллох цаг", "meal", "meal type"] },
  { field: "name", aliases: ["хоолны нэр", "хоолны нэршил", "хоол", "нэр", "name", "dish", "menu"] },
  { field: "portions", aliases: ["порц", "порцын хэмжээ", "portions"] },
  { field: "calories", aliases: ["ккал", "илчлэг", "илчлэг ккал", "калори", "calories", "kcal"] },
  { field: "allergenTags", aliases: ["харшлын шошго", "харшил", "allergens"] },
  { field: "note", aliases: ["тэмдэглэл", "note"] },
] as const;

type Field = (typeof COLUMNS)[number]["field"];

export interface ParsedMenuDish {
  name: string;
  kind: string | null;
  portions: number | null;
  calories: number | null;
  allergenTags: string[];
  note: string | null;
}

export interface ParsedMenuDay {
  /** "YYYY-MM-DD". */
  date: string;
  dishes: ParsedMenuDish[];
}

export interface MenuParseResult {
  days: ParsedMenuDay[];
  problems: { rowNumber: number; message: string }[];
}

/** The placeholder `buildMenuWorkbook` writes for a day with nothing planned. */
const EMPTY_DAY_MARKER = "цэс төлөвлөгдөөгүй";

export async function parseMenuWorkbook(input: Buffer): Promise<MenuParseResult> {
  const book = new ExcelJS.Workbook();

  try {
    await book.xlsx.load(input as unknown as ArrayBuffer);
  } catch {
    // The ZIP header check passed but this is not a workbook. A problem rather
    // than a throw, so the caller answers with the shape it uses for every
    // other refusal.
    return { days: [], problems: [{ rowNumber: 0, message: "Файлыг уншиж чадсангүй" }] };
  }

  /*
    The first sheet, by name when the export's name is there.

    A round-tripped file has "Хоолны цэс" first and "Харшлын анхаарал" second;
    reading sheet zero blindly would work today and read the warnings sheet the
    day somebody reorders the tabs in Excel.
  */
  const candidates = book.worksheets.flatMap((worksheet) => {
    const found: { rowNumber: number; index: Map<Field, number> }[] = [];
    for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 20); rowNumber++) {
      const index = new Map<Field, number>();
      worksheet.getRow(rowNumber).eachCell((cell, column) => {
        const heading = normalize(text(cell));
        for (const spec of COLUMNS) {
          if (!index.has(spec.field) && spec.aliases.some((alias) => normalize(alias) === heading)) {
            index.set(spec.field, column);
          }
        }
      });
      if (index.has("name") && (index.has("date") || (index.has("year") && index.has("month") && index.has("day")))) {
        found.push({ rowNumber, index });
      }
    }
    return found.map((found) => ({ sheet: worksheet, ...found }));
  });
  candidates.sort((a, b) => b.index.size - a.index.size || a.rowNumber - b.rowNumber);
  const selected = candidates[0];
  if (!selected) {
    const matrix = book.worksheets.map(parseMenuMatrix).find((result) => result.days.length > 0);
    return matrix ?? {
      days: [],
      problems: [{ rowNumber: 0, message: "Огноо, хоолны нэртэй хүснэгт олдсонгүй. Багануудыг шалгана уу." }],
    };
  }
  const { sheet, index, rowNumber: headerRow } = selected;

  const problems: MenuParseResult["problems"] = [];
  const byDate = new Map<string, ParsedMenuDish[]>();

  let previousDate: string | null = null;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;

    const cell = (field: Field) => {
      const column = index.get(field);
      return column ? text(row.getCell(column)) : "";
    };

    const dateParts = [cell("year"), cell("month"), cell("day")];
    const rawDate = index.has("date") ? cell("date") : dateParts.some(Boolean) ? dateParts.join("-") : "";
    const name = cell("name");

    // A wholly blank row is how Excel pads a sheet somebody deleted rows from.
    if (!name && !rawDate) return;

    const date = isoDate(rawDate) ?? (!rawDate && name ? previousDate : null);
    if (!date) {
      problems.push({ rowNumber, message: `Огноо танигдсангүй: "${rawDate}"` });
      return;
    }
    previousDate = date;

    /*
      ★ A day named with no dish still registers, as an empty day.

      That is what clears a week: a cook deletes the dish names, imports, and
      those days are emptied. Without this the import could only ever add, and
      "I removed Wednesday's lunch" would silently do nothing.
    */
    // Only an explicit empty day from our export may clear an existing day.
    if (!name || normalize(name) === EMPTY_DAY_MARKER) {
      if (index.has("date") && rawDate && !byDate.has(date)) byDate.set(date, []);
      return;
    }

    const rawKind = cell("kind");
    const kind = rawKind ? (KIND_ALIASES[normalize(rawKind)] ?? null) : null;
    if (rawKind && !kind) {
      problems.push({ rowNumber, message: `Хоолны цаг танигдсангүй: "${rawKind}"` });
      return;
    }

    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push({
      name,
      kind,
      portions: number(cell("portions")),
      calories: integer(cell("calories")),
      allergenTags: cell("allergenTags")
        .split(/[,;]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      note: cell("note") || null,
    });
  });

  const days = [...byDate.entries()]
    .map(([date, dishes]) => ({ date, dishes }))
    .sort((x, y) => x.date.localeCompare(y.date));

  return { days, problems };
}

/**
 * Many kindergartens receive a weekly plan with days as columns and meal
 * sittings as rows. The supplied 2026-09-19 example has no "Огноо" heading:
 * row four contains dates B:F and column A contains "Өглөөний хоол", etc.
 */
function parseMenuMatrix(sheet: ExcelJS.Worksheet): MenuParseResult {
  const byDate = new Map<string, ParsedMenuDish[]>();
  const problems: MenuParseResult["problems"] = [];

  for (let headerRow = 1; headerRow <= sheet.rowCount; headerRow++) {
    const dates = new Map<number, string>();
    for (let column = 2; column <= sheet.columnCount; column++) {
      const date = isoDate(text(sheet.getRow(headerRow).getCell(column)));
      if (date) dates.set(column, date);
    }
    // One date can occur in an ordinary table. Two or more dates in the same
    // row identifies the horizontal weekly-plan layout without guessing.
    if (dates.size < 2) continue;

    let previousKind: string | null = null;
    for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      // A following week starts another matrix, rather than being a food row.
      const rowDates = [...dates.keys()].filter((column) => isoDate(text(row.getCell(column))));
      if (rowDates.length >= 2) break;

      const label = text(row.getCell(1));
      const recognizedKind = label ? (KIND_ALIASES[normalize(label)] ?? null) : null;
      if (recognizedKind) previousKind = recognizedKind;
      if (label && !recognizedKind) {
        // A title, note, or an unfamiliar row is not a dish row. Do not turn
        // it into an accidental menu item or erase an existing day.
        continue;
      }
      if (!previousKind) continue;

      for (const [column, date] of dates) {
        const name = text(row.getCell(column));
        if (!name) continue;
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date)!.push({
          name,
          kind: previousKind,
          portions: null,
          calories: null,
          allergenTags: [],
          note: null,
        });
      }
    }
  }

  return {
    days: [...byDate.entries()]
      .map(([date, dishes]) => ({ date, dishes }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    problems,
  };
}

function text(cell: ExcelJS.Cell | undefined): string {
  const value = cell?.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    // A formula cell, or rich text — both carry the displayed value separately.
    if ("result" in value) return String((value as { result?: unknown }).result ?? "").trim();
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
 * `YYYY-MM-DD`, however Excel handed it over.
 *
 * ★ A real date cell arrives as a `Date` and is already ISO by the time it
 * reaches here; a text cell can be `2026-09-11`, `2026/9/11` or `11.09.2026`,
 * and a kitchen typing a menu will produce all three.
 */
function isoDate(raw: string): string | null {
  const value = raw.trim().replace(/\s*(?:оны|он)\s*/g, "-").replace(/\s*(?:сарын|сар)\s*/g, "-").replace(/\s*(?:өдөр)\s*/g, "").replace(/\s+/g, "");
  if (!value) return null;

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (iso) return pad(iso[1]!, iso[2]!, iso[3]!);

  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
  if (dmy) return pad(dmy[3]!, dmy[2]!, dmy[1]!);

  return null;
}

function pad(year: string, month: string, day: string): string | null {
  const m = Number(month);
  const d = Number(day);
  const y = Number(year);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function number(raw: string): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(/\s*(?:ккал|kcal|калори|cal)\s*$/i, "").replace(",", ".").trim());
  return Number.isFinite(value) ? value : null;
}

function normalize(raw: string): string {
  return raw.toLowerCase().replace(/[().,:/_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

function integer(raw: string): number | null {
  const value = number(raw);
  return value === null ? null : Math.round(value);
}
