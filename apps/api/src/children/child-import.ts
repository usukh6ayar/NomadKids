import type ExcelJS from "exceljs";
import { cellText, loadSpreadsheet, normalizeHeading } from "../common/spreadsheet";

/**
 * Parsing a roster workbook — RFP §3.4's "Excel файлаас хүүхдийн мэдээлэл
 * импортлох".
 *
 * ★ Pure: takes bytes, returns rows and complaints. No Prisma, no actor, no
 * writes. The service decides what to do with what comes back, which is what
 * makes the dry run and the commit share one parser instead of two that can
 * drift.
 *
 * ★★ There is deliberately no "kindergarten" column, and there never should be.
 *
 * A convenience column naming the tenant is the single most dangerous line an
 * import feature can have: it lets whoever edits the spreadsheet decide which
 * kindergarten a child lands in. The tenant comes from the actor, always.
 */

/** What a parsed row can become. */
export interface ParsedChildRow {
  /** 1-based row number in the sheet, so an error can name where it is. */
  rowNumber: number;
  lastName: string;
  firstName: string;
  sex: "MALE" | "FEMALE";
  dateOfBirth: string;
  nationalId: string | null;
  groupName: string | null;
  healthNotes: string | null;
}

export interface RowProblem {
  rowNumber: number;
  /** Mongolian — this is read by the person who made the spreadsheet. */
  message: string;
}

export interface ParseResult {
  rows: ParsedChildRow[];
  problems: RowProblem[];
}

/** A column the importer reads: a field of the row, or the combined name. */
type Field = keyof ParsedChildRow | "fullName";

/**
 * The column headings the importer understands.
 *
 * ★ Matched after `normalizeHeading` against several spellings each.
 *
 * The person filling this in is a kindergarten administrator working from
 * whatever the ministry or their previous system gave them. Insisting on one
 * exact string means the first upload fails on "Овог " with a trailing space,
 * or «Төрсөн огноо (он-сар-өдөр)», and the feature gets abandoned before it
 * works once. Both Mongolian and English are accepted because exported files
 * from other systems use either.
 *
 * ★★ Within a field the aliases are in order of preference: when two columns
 * match one field, the one matching the earlier alias wins, not the one further
 * left. «Овог» beats «Эцэг эхийн нэр» wherever they stand, so a guardian
 * column cannot become the child's surname by being first.
 */
const COLUMNS: { field: Field; aliases: string[] }[] = [
  {
    field: "lastName",
    aliases: [
      "овог",
      "хүүхдийн овог",
      "эцгийн нэр",
      "эцэг эхийн нэр",
      "lastname",
      "last name",
      "surname",
    ],
  },
  {
    field: "firstName",
    aliases: ["нэр", "өөрийн нэр", "хүүхдийн нэр", "firstname", "first name", "given name"],
  },
  /*
   * One column holding both, «Батын Тэмүүлэн» — what many rosters have. Split
   * at the first space (`splitFullName`). Read only when the file has no
   * separate surname and given name.
   */
  {
    field: "fullName",
    aliases: [
      "овог нэр",
      "хүүхдийн овог нэр",
      "овог нэр хүүхдийн",
      "овог болон нэр",
      "бүтэн нэр",
      "full name",
      "name",
    ],
  },
  { field: "sex", aliases: ["хүйс", "хүйс эр эм", "sex", "gender"] },
  {
    field: "dateOfBirth",
    aliases: [
      "төрсөн огноо",
      "төрсөн өдөр",
      "төрсөн он сар өдөр",
      "төрсөн огноо он сар өдөр",
      "төрсөн огноо он сар",
      "dateofbirth",
      "date of birth",
      "birthdate",
      "birth date",
      "birthday",
      "dob",
    ],
  },
  {
    field: "nationalId",
    aliases: [
      "регистр",
      "регистрийн дугаар",
      "регистрийн",
      "регистр дугаар",
      "рд",
      "nationalid",
      "national id",
      "register",
    ],
  },
  {
    field: "groupName",
    aliases: ["бүлэг", "бүлгийн нэр", "анги", "group", "group name"],
  },
  {
    field: "healthNotes",
    aliases: ["эрүүл мэнд", "эрүүл мэндийн тэмдэглэл", "тэмдэглэл", "healthnotes", "notes"],
  },
];

/** How far down each sheet the heading row is looked for — below a title or two. */
const HEADER_SEARCH_ROWS = 20;

/** How many data rows one upload may carry. */
const MAX_ROWS = 500;

/**
 * How a child is recognised when they have no national id — RFP §3.4.
 *
 * ★ Exported so the parser and the service share one definition.
 *
 * The parser uses it to catch duplicates *within* a file; the service uses it
 * to catch a row that matches a child already registered. Two definitions would
 * drift, and the failure would be silent: an import that skipped a duplicate in
 * one direction and created it in the other.
 *
 * ★★ A national id is the better key and is used when present. This is the
 * fallback, and it has to exist: §3.4's actual case is a file from the ministry
 * or a previous system, where a register column is often empty. Without it,
 * exporting a roster and uploading it back **duplicates every register-less
 * child** — which is what the export/import pair is for.
 *
 * Twins are not a counterexample: the key includes the given name, and twins do
 * not share one. The residual collision — same surname, same given name, same
 * birth date, genuinely different children — costs one manual entry, because a
 * match **skips** rather than overwrites. That asymmetry is what makes the
 * fallback safe to have.
 *
 * `NFC` because Cyrillic typed on different keyboards can arrive decomposed and
 * compare unequal while looking identical; `JSON.stringify` so a name
 * containing the separator cannot collide with another key.
 */
export function childKey(lastName: string, firstName: string, isoDate: string): string {
  return JSON.stringify([normalise(lastName), normalise(firstName), isoDate]);
}

function normalise(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

export async function parseChildWorkbook(input: Buffer): Promise<ParseResult> {
  // An `.xlsx` or a CSV (`common/spreadsheet.ts`). A file that is neither is
  // reported as a problem rather than thrown, so the caller answers with the
  // same shape it uses for every other refusal.
  const book = await loadSpreadsheet(input);
  if (!book) return { rows: [], problems: [{ rowNumber: 0, message: "Файлыг уншиж чадсангүй" }] };
  if (book.worksheets.length === 0) {
    return { rows: [], problems: [{ rowNumber: 0, message: "Хуудас олдсонгүй" }] };
  }

  /*
   * ★ The heading row is looked for, not assumed to be row 1 of sheet 1.
   *
   * A ministry or school roster has a title — «2026-2027 оны хичээлийн жилийн
   * хүүхдийн бүртгэл» — and often a blank line above its headings, and the
   * roster is not always the first tab. Every sheet's first rows are tried;
   * the row naming the most known columns wins, the top-most on a tie.
   */
  const found = findHeader(book);
  if (!found) {
    const best = bestEffortHeader(book);
    const missing = [
      ...(best.has("lastName") || best.has("fullName") ? [] : ["овог"]),
      ...(best.has("firstName") || best.has("fullName") ? [] : ["нэр"]),
      ...(best.has("sex") ? [] : ["хүйс"]),
      ...(best.has("dateOfBirth") ? [] : ["төрсөн огноо"]),
    ];
    return {
      rows: [],
      problems: [{ rowNumber: 1, message: `Дараах багана дутуу байна: ${missing.join(", ")}` }],
    };
  }
  const { sheet, headerRow, columnIndex } = found;
  const splitName = !columnIndex.has("lastName") || !columnIndex.has("firstName");

  const rows: ParsedChildRow[] = [];
  const problems: RowProblem[] = [];
  const seenNationalIds = new Map<string, number>();
  const seenNameAndDate = new Map<string, number>();

  const lastRow = Math.min(sheet.rowCount, headerRow + MAX_ROWS);

  for (let rowNumber = headerRow + 1; rowNumber <= lastRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const read = (field: Field) => {
      const index = columnIndex.get(field);
      if (index === undefined) return "";

      return cellText(row.getCell(index));
    };

    const [lastName, firstName] = splitName
      ? splitFullName(read("fullName"))
      : [read("lastName"), read("firstName")];

    // A wholly blank row is the trailing emptiness every spreadsheet has, not a
    // mistake worth reporting. Skipped silently.
    if (!lastName && !firstName && !read("dateOfBirth") && !read("nationalId")) continue;

    const problem = (message: string) => problems.push({ rowNumber, message });

    if (!lastName) problem("Овог хоосон байна");
    if (!firstName) problem("Нэр хоосон байна");

    const sex = parseSex(read("sex"));
    if (sex === null) problem("Хүйс 'Эрэгтэй/Эмэгтэй' эсвэл 'Хүү/Охин' байна");

    const dateOfBirth = parseDate(row, columnIndex.get("dateOfBirth"));
    if (dateOfBirth === null) problem("Төрсөн огноо буруу байна");

    const nationalIdRaw = read("nationalId");
    const nationalId = nationalIdRaw ? nationalIdRaw.toUpperCase() : null;

    if (nationalId !== null && !/^[А-ЯӨҮЁ]{2}\d{8}$/u.test(nationalId)) {
      problem("Регистрийн дугаар УБ12345678 хэлбэртэй байна");
    }

    /*
     * A duplicate inside the file itself.
     *
     * ★ Caught here rather than left to the database.
     *
     * The unique index is partial (`WHERE "deletedAt" IS NULL`), so the second
     * row would either fail mid-transaction — taking the whole import with it
     * — or, worse, succeed against a soft-deleted row and quietly resurrect a
     * child nobody meant to restore. Naming both row numbers is what lets the
     * administrator fix their spreadsheet instead of guessing.
     */
    if (nationalId !== null) {
      const firstSeen = seenNationalIds.get(nationalId);
      if (firstSeen !== undefined) {
        problem(`Регистрийн дугаар ${firstSeen}-р мөртэй давхардаж байна`);
      } else {
        seenNationalIds.set(nationalId, rowNumber);
      }
    }

    /*
     * The same register-less child twice in one file.
     *
     * ★ Checked here as well as against the database, because they are
     * different failures. The service compares each row against what is already
     * stored; nothing there sees two rows of one upload matching each other,
     * and both would be created inside a single transaction.
     */
    if (nationalId === null && lastName && firstName && dateOfBirth !== null) {
      const key = childKey(lastName, firstName, dateOfBirth);
      const firstSeen = seenNameAndDate.get(key);

      if (firstSeen !== undefined) {
        problem(`Ижил нэр, төрсөн огноотой мөр ${firstSeen}-р мөрөнд бий`);
      } else {
        seenNameAndDate.set(key, rowNumber);
      }
    }

    if (problems.some((p) => p.rowNumber === rowNumber)) continue;

    rows.push({
      rowNumber,
      lastName,
      firstName,
      sex: sex!,
      dateOfBirth: dateOfBirth!,
      nationalId,
      groupName: read("groupName") || null,
      healthNotes: read("healthNotes") || null,
    });
  }

  if (sheet.rowCount > headerRow + MAX_ROWS) {
    problems.push({
      rowNumber: headerRow + MAX_ROWS + 1,
      message: `Нэг удаад ${MAX_ROWS} хүртэл мөр оруулна. Үлдсэнийг тусад нь оруулна уу.`,
    });
  }

  return { rows, problems };
}

/** The heading row of the roster: the sheet, the row, and where each column is. */
interface FoundHeader {
  sheet: ExcelJS.Worksheet;
  headerRow: number;
  columnIndex: Map<Field, number>;
}

/** Which known columns one row names — each field at its most preferred alias. */
function headingsOf(row: ExcelJS.Row): Map<Field, number> {
  const best = new Map<Field, { column: number; rank: number }>();
  row.eachCell((cell, column) => {
    const heading = normalizeHeading(cellText(cell));
    if (!heading) return;
    for (const spec of COLUMNS) {
      const rank = spec.aliases.indexOf(heading);
      if (rank === -1) continue;
      const current = best.get(spec.field);
      if (!current || rank < current.rank) best.set(spec.field, { column, rank });
    }
  });
  return new Map([...best].map(([field, { column }]) => [field, column]));
}

/** A row carries a roster when it names a child, their sex and their birth date. */
function isComplete(index: Map<Field, number>): boolean {
  const named = (index.has("lastName") && index.has("firstName")) || index.has("fullName");
  return named && index.has("sex") && index.has("dateOfBirth");
}

function findHeader(book: ExcelJS.Workbook): FoundHeader | null {
  let found: FoundHeader | null = null;
  for (const sheet of book.worksheets) {
    for (let r = 1; r <= Math.min(sheet.rowCount, HEADER_SEARCH_ROWS); r++) {
      const columnIndex = headingsOf(sheet.getRow(r));
      if (!isComplete(columnIndex)) continue;
      if (!found || columnIndex.size > found.columnIndex.size) {
        found = { sheet, headerRow: r, columnIndex };
      }
    }
  }
  return found;
}

/** The nearest miss, so the refusal names only the columns really absent. */
function bestEffortHeader(book: ExcelJS.Workbook): Map<Field, number> {
  let best = new Map<Field, number>();
  for (const sheet of book.worksheets) {
    for (let r = 1; r <= Math.min(sheet.rowCount, HEADER_SEARCH_ROWS); r++) {
      const index = headingsOf(sheet.getRow(r));
      if (index.size > best.size) best = index;
    }
  }
  return best;
}

/**
 * «Батын Тэмүүлэн» → surname «Батын», given name «Тэмүүлэн»; «Б.Тэмүүлэн» →
 * «Б», «Тэмүүлэн». A single word cannot be split and comes back as a given
 * name alone, which the row's own check reports as a missing surname.
 */
function splitFullName(raw: string): [string, string] {
  const value = raw.replace(/\s+/g, " ").trim();
  const space = value.indexOf(" ");
  if (space > 0) return [value.slice(0, space).replace(/\.$/, ""), value.slice(space + 1)];
  const dot = value.indexOf(".");
  if (dot > 0 && dot < value.length - 1) return [value.slice(0, dot), value.slice(dot + 1)];
  return ["", value];
}

function parseSex(raw: string): "MALE" | "FEMALE" | null {
  const value = normalizeHeading(raw);

  if (["эрэгтэй", "хүү", "эр", "эрэгтэй хүүхэд", "male", "m", "boy", "б"].includes(value)) {
    return "MALE";
  }
  if (["эмэгтэй", "охин", "эм", "эмэгтэй хүүхэд", "female", "f", "girl", "х"].includes(value)) {
    return "FEMALE";
  }

  return null;
}

/**
 * A birth date, from either a real date cell or a typed string.
 *
 * ★ Excel date cells arrive as `Date` objects already shifted into the reading
 * machine's timezone, so taking `toISOString()` of one entered as 2021-04-15 in
 * Ulaanbaatar can yield 2021-04-14. The date is read from its **UTC** parts,
 * which is how exceljs stores what the cell displayed.
 *
 * Two-digit years are refused rather than guessed: "15/04/21" is April 2021 to
 * one reader and 1921 to another, and a wrong birth year silently misplaces a
 * child by an age band.
 */
function parseDate(row: ExcelJS.Row, index: number | undefined): string | null {
  if (index === undefined) return null;

  const raw = row.getCell(index).value;
  // A formula cell's displayed value is its result.
  const value =
    raw !== null && typeof raw === "object" && !(raw instanceof Date) && "result" in raw
      ? raw.result
      : raw;

  if (value instanceof Date) {
    const iso = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
    return withinLivingMemory(iso) ? iso : null;
  }

  /*
   * ★ An Excel serial number — a date column somebody formatted as "General",
   * or values pasted from another sheet: 44301 is 2021-04-15. Only the span a
   * kindergarten child's birth can fall in (2000 → today) is read this way.
   */
  const serialText = typeof value === "number" ? String(value) : cellText(row.getCell(index));
  if (/^\d{5}$/.test(serialText)) {
    const serial = Number(serialText);
    if (serial >= 36526) {
      const iso = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
      return withinLivingMemory(iso) ? iso : null;
    }
  }

  // «2021 оны 4 сарын 15», «2021.04.15 0:00:00» — words and a time part dropped.
  const text = cellText(row.getCell(index))
    .replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?$/i, "")
    .replace(/\s*(?:оны|он)\s*/g, "-")
    .replace(/\s*(?:сарын|сар)\s*/g, "-")
    .replace(/\s*(?:өдөр|-ний|-нд)\s*$/g, "")
    .replace(/\s+/g, "")
    .replace(/[-/.]$/, "");
  if (!text) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    const candidate = `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
    return withinLivingMemory(candidate) ? candidate : null;
  }

  // DD/MM/YYYY — the order written in Mongolia. Four-digit year required.
  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    const candidate = `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
    return withinLivingMemory(candidate) ? candidate : null;
  }

  return null;
}

/** Rejects a date that is not a plausible birth date for a kindergarten child. */
function withinLivingMemory(iso: string): boolean {
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;

  // Round-trips: catches 2021-02-30, which `Date` would silently roll forward
  // into March.
  if (date.toISOString().slice(0, 10) !== iso) return false;

  const year = date.getUTCFullYear();
  return year >= 2000 && date.getTime() <= Date.now();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
