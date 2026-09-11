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

/** Header spellings accepted for each column. Lower-cased before matching. */
const COLUMNS = [
  { field: "date", aliases: ["огноо", "date"] },
  { field: "kind", aliases: ["хоолны цаг", "хоол", "цаг", "meal"] },
  { field: "name", aliases: ["хоолны нэр", "нэр", "name", "dish"] },
  { field: "portions", aliases: ["порц", "portions"] },
  { field: "calories", aliases: ["ккал", "илчлэг", "calories", "kcal"] },
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
  const sheet = book.getWorksheet("Хоолны цэс") ?? book.worksheets[0];
  if (!sheet) return { days: [], problems: [{ rowNumber: 0, message: "Хуудас олдсонгүй" }] };

  const index = new Map<Field, number>();
  sheet.getRow(1).eachCell((cell, column) => {
    const heading = text(cell).toLowerCase();
    for (const spec of COLUMNS) {
      if (!index.has(spec.field) && (spec.aliases as readonly string[]).includes(heading)) {
        index.set(spec.field, column);
      }
    }
  });

  for (const required of ["date", "name"] as const) {
    if (!index.has(required)) {
      return {
        days: [],
        problems: [
          {
            rowNumber: 1,
            message: `"${required === "date" ? "Огноо" : "Хоолны нэр"}" багана олдсонгүй`,
          },
        ],
      };
    }
  }

  const problems: MenuParseResult["problems"] = [];
  const byDate = new Map<string, ParsedMenuDish[]>();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const cell = (field: Field) => {
      const column = index.get(field);
      return column ? text(row.getCell(column)) : "";
    };

    const rawDate = cell("date");
    const name = cell("name");

    // A wholly blank row is how Excel pads a sheet somebody deleted rows from.
    if (!rawDate && !name) return;

    const date = isoDate(rawDate);
    if (!date) {
      problems.push({ rowNumber, message: `Огноо танигдсангүй: "${rawDate}"` });
      return;
    }

    /*
      ★ A day named with no dish still registers, as an empty day.

      That is what clears a week: a cook deletes the dish names, imports, and
      those days are emptied. Without this the import could only ever add, and
      "I removed Wednesday's lunch" would silently do nothing.
    */
    if (!byDate.has(date)) byDate.set(date, []);
    if (!name || name.toLowerCase() === EMPTY_DAY_MARKER) return;

    const rawKind = cell("kind");
    const kind = rawKind ? (KIND_ALIASES[rawKind.toLowerCase()] ?? null) : null;
    if (rawKind && !kind) {
      problems.push({ rowNumber, message: `Хоолны цаг танигдсангүй: "${rawKind}"` });
      return;
    }

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
  const value = raw.trim();
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
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function number(raw: string): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function integer(raw: string): number | null {
  const value = number(raw);
  return value === null ? null : Math.round(value);
}
