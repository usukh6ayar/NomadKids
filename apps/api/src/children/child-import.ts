import ExcelJS from "exceljs";

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

/**
 * The column headings the importer understands.
 *
 * ★ Matched case-insensitively against several spellings each.
 *
 * The person filling this in is a kindergarten administrator working from
 * whatever the ministry or their previous system gave them. Insisting on one
 * exact string means the first upload fails on "Овог " with a trailing space,
 * and the feature gets abandoned before it works once. Both Mongolian and
 * English are accepted because exported files from other systems use either.
 */
const COLUMNS: { field: keyof ParsedChildRow; aliases: string[]; required: boolean }[] = [
  { field: "lastName", aliases: ["овог", "эцгийн нэр", "lastname", "last name"], required: true },
  { field: "firstName", aliases: ["нэр", "өөрийн нэр", "firstname", "first name"], required: true },
  { field: "sex", aliases: ["хүйс", "sex", "gender"], required: true },
  {
    field: "dateOfBirth",
    aliases: ["төрсөн огноо", "төрсөн өдөр", "dateofbirth", "date of birth", "birthdate"],
    required: true,
  },
  {
    field: "nationalId",
    aliases: ["регистр", "регистрийн дугаар", "nationalid", "register"],
    required: false,
  },
  { field: "groupName", aliases: ["бүлэг", "group", "бүлгийн нэр"], required: false },
  {
    field: "healthNotes",
    aliases: ["эрүүл мэнд", "эрүүл мэндийн тэмдэглэл", "healthnotes", "notes"],
    required: false,
  },
];

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
  const book = new ExcelJS.Workbook();

  try {
    await book.xlsx.load(input as unknown as ArrayBuffer);
  } catch {
    // The ZIP header check passed but this is not a workbook. Reported as a
    // problem rather than thrown, so the caller answers with the same shape it
    // uses for every other refusal.
    return { rows: [], problems: [{ rowNumber: 0, message: "Файлыг уншиж чадсангүй" }] };
  }

  const sheet = book.worksheets[0];
  if (!sheet) return { rows: [], problems: [{ rowNumber: 0, message: "Хуудас олдсонгүй" }] };

  const headerRow = sheet.getRow(1);
  const columnIndex = new Map<keyof ParsedChildRow, number>();

  headerRow.eachCell((cell, index) => {
    const heading = String(cell.value ?? "")
      .trim()
      .toLowerCase();

    for (const column of COLUMNS) {
      if (!columnIndex.has(column.field) && column.aliases.includes(heading)) {
        columnIndex.set(column.field, index);
      }
    }
  });

  const missing = COLUMNS.filter((c) => c.required && !columnIndex.has(c.field));
  if (missing.length > 0) {
    return {
      rows: [],
      problems: [
        {
          rowNumber: 1,
          message: `Дараах багана дутуу байна: ${missing.map((c) => c.aliases[0]).join(", ")}`,
        },
      ],
    };
  }

  const rows: ParsedChildRow[] = [];
  const problems: RowProblem[] = [];
  const seenNationalIds = new Map<string, number>();
  const seenNameAndDate = new Map<string, number>();

  const lastRow = Math.min(sheet.rowCount, MAX_ROWS + 1);

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const read = (field: keyof ParsedChildRow) => {
      const index = columnIndex.get(field);
      if (index === undefined) return "";

      return cellText(row.getCell(index));
    };

    const lastName = read("lastName");
    const firstName = read("firstName");

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

  if (sheet.rowCount > MAX_ROWS + 1) {
    problems.push({
      rowNumber: MAX_ROWS + 2,
      message: `Нэг удаад ${MAX_ROWS} хүртэл мөр оруулна. Үлдсэнийг тусад нь оруулна уу.`,
    });
  }

  return { rows, problems };
}

/** A cell as trimmed text, whatever Excel decided its type was. */
function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";

  // A cell holding a formula reports `{ result }`; a rich-text cell reports
  // `{ richText: [...] }`. Both are ordinary in a file that has been edited by
  // hand, and both read as "[object Object]" without this.
  if (typeof value === "object") {
    if ("result" in value) return String(value.result ?? "").trim();
    if ("richText" in value)
      return value.richText
        .map((part) => part.text)
        .join("")
        .trim();
    if ("text" in value) return String(value.text ?? "").trim();
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }

  return String(value).trim();
}

function parseSex(raw: string): "MALE" | "FEMALE" | null {
  const value = raw.trim().toLowerCase();

  if (["эрэгтэй", "хүү", "эр", "male", "m", "б"].includes(value)) return "MALE";
  if (["эмэгтэй", "охин", "эм", "female", "f", "х"].includes(value)) return "FEMALE";

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

  const value = row.getCell(index).value;

  if (value instanceof Date) {
    const iso = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
    return withinLivingMemory(iso) ? iso : null;
  }

  const text = String(value ?? "").trim();
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
