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

/**
 * The sitting names the export writes, and what a person is likely to type.
 *
 * ★ The names the client chose on 2026-09-16 are here, and so are the ones
 * they replaced. A kindergarten's own spreadsheets are the reason: a cook who
 * downloaded a week last month and uploads it edited is sending a file full of
 * "Өдрийн хоол", and dropping that spelling would reject their work with
 * "Хоолны цаг танигдсангүй" for a word this product itself wrote. An alias
 * costs a line; a rejected import costs a morning.
 *
 * "бага үдийн цай" and "үдийн цай" are deliberately distinct: the first is
 * the mid-morning sitting, the second the afternoon one, and the match is
 * exact so neither can swallow the other.
 */
const KIND_ALIASES: Record<string, string> = {
  "өглөөний хоол": "BREAKFAST",
  "өглөөний цай": "BREAKFAST",
  өглөө: "BREAKFAST",
  breakfast: "BREAKFAST",
  "бага үдийн цай": "MID_MORNING_SNACK",
  жүүс: "MID_MORNING_SNACK",
  "өглөөний зууш": "MID_MORNING_SNACK",
  "үдээс өмнөх зууш": "MID_MORNING_SNACK",
  шөл: "SNACK",
  зууш: "SNACK",
  "үндсэн хоол": "LUNCH",
  "өдрийн хоол": "LUNCH",
  үдийн: "LUNCH",
  "үдийн хоол": "LUNCH",
  lunch: "LUNCH",
  "их үдийн цай": "AFTERNOON_SNACK",
  "үдийн цай": "AFTERNOON_SNACK",
  "үдээс хойших зууш": "AFTERNOON_SNACK",
  "уух зүйл": "EXTRA",
  ундаа: "EXTRA",
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
  {
    field: "kind",
    aliases: ["хоолны цаг", "хоолны төрөл", "төрөл", "хооллох цаг", "meal", "meal type"],
  },
  {
    field: "name",
    aliases: ["хоолны нэр", "хоолны нэршил", "хоол", "нэр", "name", "dish", "menu"],
  },
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
  const readDate = dateReader(dateContext(book));

  const candidates = book.worksheets.flatMap((worksheet) => {
    const found: { rowNumber: number; index: Map<Field, number> }[] = [];
    for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 20); rowNumber++) {
      const index = new Map<Field, number>();
      worksheet.getRow(rowNumber).eachCell((cell, column) => {
        const heading = normalize(text(cell));
        for (const spec of COLUMNS) {
          if (
            !index.has(spec.field) &&
            spec.aliases.some((alias) => normalize(alias) === heading)
          ) {
            index.set(spec.field, column);
          }
        }
      });
      if (
        index.has("name") &&
        (index.has("date") || (index.has("year") && index.has("month") && index.has("day")))
      ) {
        found.push({ rowNumber, index });
      }
    }
    return found.map((found) => ({ sheet: worksheet, ...found }));
  });
  candidates.sort((a, b) => b.index.size - a.index.size || a.rowNumber - b.rowNumber);
  const selected = candidates[0];
  if (!selected) {
    /*
      ★ Both matrix orientations — 2026-09-30, the client: "хөндлөнгөөр,
      босоогоор … олон хувилбараар таньдаг байх". Dates across with meal
      times down the side, or the same grid rotated.
    */
    const matrix = book.worksheets
      .flatMap((sheet) => [
        parseMenuMatrix(sheet, readDate),
        parseMenuMatrixRotated(sheet, readDate),
      ])
      .find((result) => result.days.length > 0);
    return (
      matrix ?? {
        days: [],
        problems: [
          {
            rowNumber: 0,
            message: "Огноо, хоолны нэртэй хүснэгт олдсонгүй. Багануудыг шалгана уу.",
          },
        ],
      }
    );
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
    const rawDate = index.has("date")
      ? cell("date")
      : dateParts.some(Boolean)
        ? dateParts.join("-")
        : "";
    const name = cell("name");

    // A wholly blank row is how Excel pads a sheet somebody deleted rows from.
    if (!name && !rawDate) return;

    const date = readDate(rawDate) ?? (!rawDate && name ? previousDate : null);
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
function parseMenuMatrix(
  sheet: ExcelJS.Worksheet,
  isoDate: (raw: string) => string | null,
): MenuParseResult {
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

/**
 * The same weekly grid rotated: meal times across a header row, one date per
 * row down column A ("Даваа", "09.14", "2026-09-14" …).
 */
function parseMenuMatrixRotated(
  sheet: ExcelJS.Worksheet,
  isoDate: (raw: string) => string | null,
): MenuParseResult {
  const byDate = new Map<string, ParsedMenuDish[]>();

  for (let headerRow = 1; headerRow <= Math.min(sheet.rowCount, 30); headerRow++) {
    const kinds = new Map<number, string>();
    for (let column = 2; column <= sheet.columnCount; column++) {
      const kind = KIND_ALIASES[normalize(text(sheet.getRow(headerRow).getCell(column)))];
      if (kind) kinds.set(column, kind);
    }
    // Two meal times in one row is the header; one could be a stray word.
    if (kinds.size < 2) continue;

    for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const date = isoDate(text(row.getCell(1)));
      if (!date) continue;
      for (const [column, kind] of kinds) {
        const name = text(row.getCell(column));
        if (!name) continue;
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date)!.push({
          name,
          kind,
          portions: null,
          calories: null,
          allergenTags: [],
          note: null,
        });
      }
    }
    break;
  }

  return {
    days: [...byDate.entries()]
      .map(([date, dishes]) => ({ date, dishes }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    problems: [],
  };
}

/** What a date with parts missing is read against. */
interface DateContext {
  /** The year for "09.14" / "9 сарын 14". */
  year: number;
  /** Monday of the week that "Даваа", "Мягмар" … name. */
  monday: Date;
}

const WEEKDAY_INDEX: Record<string, number> = {
  даваа: 0,
  да: 0,
  мягмар: 1,
  мя: 1,
  лхагва: 2,
  лх: 2,
  пүрэв: 3,
  пү: 3,
  баасан: 4,
  ба: 4,
  бямба: 5,
  бя: 5,
  ням: 6,
  ня: 6,
};

/**
 * The first complete date anywhere in the workbook anchors the others — a
 * weekly plan usually carries one ("2026.09.14-ний долоо хоног") even when
 * its columns say only "Даваа". Without one, the current week and year.
 */
function dateContext(book: ExcelJS.Workbook): DateContext {
  let anchor: Date | null = null;
  outer: for (const sheet of book.worksheets) {
    for (let r = 1; r <= Math.min(sheet.rowCount, 40); r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= Math.min(sheet.columnCount, 20); c++) {
        const raw = text(row.getCell(c));
        const found =
          fullDate(raw) ?? fullDate(raw.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/)?.[0] ?? "");
        if (found) {
          anchor = new Date(`${found}T00:00:00Z`);
          break outer;
        }
      }
    }
  }
  const base = anchor ?? new Date();
  const monday = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return { year: base.getUTCFullYear(), monday };
}

function dateReader(ctx: DateContext) {
  return (raw: string) => isoDate(raw, ctx);
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
function isoDate(raw: string, ctx?: DateContext): string | null {
  const full = fullDate(raw);
  if (full || !ctx) return full;

  const value = raw.trim().toLocaleLowerCase("mn-MN");

  /*
   * ★ An Excel serial left as a number ("46279") — what a date cell becomes
   * when somebody pastes values. Bounded to 2020–2040 so a portion count or a
   * calorie figure is never read as a day.
   */
  if (/^\d{5}$/.test(value)) {
    const serial = Number(value);
    if (serial >= 43831 && serial <= 51136) {
      return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
    }
  }

  // "Даваа", "Даваа гараг", "Да" — a day of the anchored week.
  const weekday = WEEKDAY_INDEX[value.replace(/\s*гараг$/, "").replace(/[.,]$/, "")];
  if (weekday !== undefined) {
    const day = new Date(ctx.monday);
    day.setUTCDate(day.getUTCDate() + weekday);
    return day.toISOString().slice(0, 10);
  }

  // "9 сарын 14", "9-р сарын 14", "9 сар 14" — month then day, the Mongolian order.
  const worded = /^(\d{1,2})(?:-р)?\s*сар(?:ын)?\s*(\d{1,2})/.exec(value);
  if (worded) return pad(String(ctx.year), worded[1]!, worded[2]!);

  /*
   * "09.14", "9/14", "09-14" — month.day, the Mongolian order. A first part
   * over 12 can only be a day ("14.09"), so it is read the other way round.
   */
  const short = /^(\d{1,2})[-/.](\d{1,2})\.?$/.exec(value.replace(/\s+/g, ""));
  if (short) {
    const [a, b] = [Number(short[1]), Number(short[2])];
    return a > 12
      ? pad(String(ctx.year), short[2]!, short[1]!)
      : pad(String(ctx.year), String(a), String(b));
  }

  return null;
}

/** A date that names its own year — the formats read since 2026-09-11. */
function fullDate(raw: string): string | null {
  const value = raw
    .trim()
    .replace(/\s*(?:оны|он)\s*/g, "-")
    .replace(/\s*(?:сарын|сар)\s*/g, "-")
    .replace(/\s*(?:өдөр)\s*/g, "")
    .replace(/\s+/g, "");
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
  if (
    y < 1900 ||
    y > 2100 ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > new Date(Date.UTC(y, m, 0)).getUTCDate()
  )
    return null;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function number(raw: string): number | null {
  if (!raw) return null;
  const value = Number(
    raw
      .replace(/\s*(?:ккал|kcal|калори|cal)\s*$/i, "")
      .replace(",", ".")
      .trim(),
  );
  return Number.isFinite(value) ? value : null;
}

function normalize(raw: string): string {
  // The hyphen stays last in the class, where it is a literal. Moving it into
  // the middle would turn it into a range and silently change what matches.
  return raw
    .toLowerCase()
    .replace(/[().,:/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function integer(raw: string): number | null {
  const value = number(raw);
  return value === null ? null : Math.round(value);
}
