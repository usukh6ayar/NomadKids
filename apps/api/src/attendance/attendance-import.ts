import type ExcelJS from "exceljs";
import { ATTENDANCE_STATUS_LABEL } from "@kinder/contracts";
import { cellText, normalizeHeading } from "../common/spreadsheet";

/**
 * A month of attendance read out of a spreadsheet — 2026-10-16, the user:
 * "Ирц сараар нөхөх" (by Excel, the third of the three ways asked for).
 *
 * ★ It reads what `journal-workbook.ts` writes — «Хүүхэд» | «Бүлэг» | 01 | 02 …
 * under a title — so the loop is «Сарын дэлгэрэнгүй татах» → fill in Excel →
 * import. A sheet a kindergarten made itself works too: the heading row is
 * searched for, the child may be one column or «Овог» + «Нэр», a day column
 * may be a day number or a date, and a mark may be the word, its letter (И,
 * Ө, Ч, Т, Х, Б) or a tick.
 *
 * ★★ Pure, and it writes nothing. The service checks each cell against the
 * child's days in the group; the web puts the result into the month grid for
 * the teacher to look over and save. Every refusal is a *row*, never a throw.
 */

export interface ImportRosterChild {
  childId: string;
  lastName: string | null;
  firstName: string;
}

export interface ImportedCell {
  rowNumber: number;
  childId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  status: string;
}

export interface AttendanceImportResult {
  cells: ImportedCell[];
  problems: { rowNumber: number; message: string }[];
}

const CHILD_HEADINGS = ["хүүхэд", "хүүхдийн нэр", "хүүхдийн овог нэр", "овог нэр", "нэр", "name"];
const LAST_NAME_HEADINGS = ["овог", "эцэг эхийн нэр", "эцгийн нэр"];
const FIRST_NAME_HEADINGS = ["нэр", "өөрийн нэр"];

/** The journal's footer rows — the tallies under the register, not children. */
const FOOTER_LABELS = new Set(["ирсэн", "өвчтэй", "чөлөөтэй", "тасалсан", "нийт", "дүн"]);

/** What a mark in a cell may be: the label, its letter, a tick, English. */
const STATUS_ALIASES: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(ATTENDANCE_STATUS_LABEL).map(([status, label]) => [
      normalizeHeading(label),
      status,
    ]),
  ),
  и: "PRESENT",
  ир: "PRESENT",
  "+": "PRESENT",
  "✓": "PRESENT",
  "✔": "PRESENT",
  v: "PRESENT",
  "1": "PRESENT",
  present: "PRESENT",
  ө: "SICK",
  өвчин: "SICK",
  sick: "SICK",
  ч: "EXCUSED",
  чөлөө: "EXCUSED",
  excused: "EXCUSED",
  т: "ABSENT",
  тас: "ABSENT",
  тасалсан: "ABSENT",
  absent: "ABSENT",
  х: "HALF_DAY",
  хагас: "HALF_DAY",
  б: "OTHER",
};

interface Header {
  sheet: ExcelJS.Worksheet;
  row: number;
  child: number | null;
  lastName: number | null;
  firstName: number | null;
  /** Column → `YYYY-MM-DD`. */
  days: Map<number, string>;
}

export function parseAttendanceMonth(
  book: ExcelJS.Workbook,
  month: string,
  roster: ImportRosterChild[],
): AttendanceImportResult {
  const header = findHeader(book, month);
  if (!header) {
    return {
      cells: [],
      problems: [
        {
          rowNumber: 0,
          message: "«Хүүхэд» багана болон сарын өдрүүдийн (1, 2, 3 …) гарчиг олдсонгүй",
        },
      ],
    };
  }

  const match = childMatcher(roster);
  const cells: ImportedCell[] = [];
  const problems: AttendanceImportResult["problems"] = [];
  const seen = new Map<string, number>();

  for (let r = header.row + 1; r <= header.sheet.rowCount; r++) {
    const row = header.sheet.getRow(r);
    const name =
      header.child !== null
        ? cellText(row.getCell(header.child))
        : [header.lastName, header.firstName]
            .map((column) => (column !== null ? cellText(row.getCell(column)) : ""))
            .join(" ")
            .trim();
    if (!name) continue;
    // The tallies under the journal's register — the end of the children.
    if (FOOTER_LABELS.has(normalizeHeading(name))) break;

    const found = match(name);
    if (found.kind !== "one") {
      problems.push({
        rowNumber: r,
        message:
          found.kind === "none"
            ? `Бүлэгт ийм хүүхэд олдсонгүй: «${name}»`
            : `Ижил нэртэй хүүхэд олон байна: «${name}» — овгийг бүтнээр бичнэ үү`,
      });
      continue;
    }

    const previous = seen.get(found.childId);
    if (previous !== undefined) {
      problems.push({ rowNumber: r, message: `«${name}» ${previous}-р мөрөнд аль хэдийн бий` });
      continue;
    }
    seen.set(found.childId, r);

    for (const [column, date] of header.days) {
      const raw = cellText(row.getCell(column));
      // Blank, or a dash somebody put for "nothing" — no mark either way.
      if (!raw || !normalizeHeading(raw)) continue;
      const status = STATUS_ALIASES[normalizeHeading(raw)] ?? STATUS_ALIASES[raw.trim()];
      if (!status) {
        problems.push({ rowNumber: r, message: `${date}: «${raw}» тэмдэглэгээ танигдсангүй` });
        continue;
      }
      cells.push({ rowNumber: r, childId: found.childId, date, status });
    }
  }

  return { cells, problems };
}

/**
 * The heading row: a child column (or surname and given name) and at least
 * three of the month's days. Every sheet's first rows are tried; the row with
 * the most days wins — the journal's grid over its summary sheets.
 */
function findHeader(book: ExcelJS.Workbook, month: string): Header | null {
  let best: Header | null = null;
  for (const sheet of book.worksheets) {
    for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
      const header: Header = {
        sheet,
        row: r,
        child: null,
        lastName: null,
        firstName: null,
        days: new Map(),
      };
      const labels: [number, string][] = [];
      sheet.getRow(r).eachCell((cell, column) => {
        labels.push([column, normalizeHeading(cellText(cell))]);
        const date = dayOf(cell, month);
        if (date) header.days.set(column, date);
      });
      for (const [column, label] of labels) {
        if (header.lastName === null && LAST_NAME_HEADINGS.includes(label)) {
          header.lastName = column;
        }
      }
      for (const [column, label] of labels) {
        if (header.child === null && CHILD_HEADINGS.includes(label) && label !== "нэр") {
          header.child = column;
        }
        if (header.firstName === null && FIRST_NAME_HEADINGS.includes(label)) {
          header.firstName = column;
        }
      }
      // «Нэр» alone is the whole name; beside «Овог» it is the given name.
      if (header.child === null && header.lastName === null && header.firstName !== null) {
        header.child = header.firstName;
        header.firstName = null;
      }
      const named = header.child !== null || header.firstName !== null;
      if (!named || header.days.size < 3) continue;
      if (!best || header.days.size > best.days.size) best = header;
    }
  }
  return best;
}

/** A heading cell as a day of `month`: «01», «5», or a date inside it. */
function dayOf(cell: ExcelJS.Cell, month: string): string | null {
  const text = cellText(cell);
  const bare = /^(\d{1,2})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();

  if (bare) {
    const day = Number(bare[1]);
    return day >= 1 && day <= last ? `${month}-${String(day).padStart(2, "0")}` : null;
  }
  if (iso && `${iso[1]}-${iso[2]}` === month) return text;
  return null;
}

type Match = { kind: "one"; childId: string } | { kind: "none" } | { kind: "many" };

/**
 * A name in the sheet to a child of the roster: the full «Овог Нэр» first,
 * then «Б.Нэр», then the given name alone — each only when it names one
 * child. Two «Ану» in a group need their surnames; the import never guesses.
 */
function childMatcher(roster: ImportRosterChild[]) {
  const norm = (value: string) =>
    value.normalize("NFC").toLowerCase().replace(/\./g, ". ").replace(/\s+/g, " ").trim();
  const index = (key: (child: ImportRosterChild) => string | null) => {
    const map = new Map<string, string[]>();
    for (const child of roster) {
      const value = key(child);
      if (!value) continue;
      map.set(norm(value), [...(map.get(norm(value)) ?? []), child.childId]);
    }
    return map;
  };
  const full = index((child) => (child.lastName ? `${child.lastName} ${child.firstName}` : null));
  const short = index((child) =>
    child.lastName ? `${child.lastName.charAt(0)}. ${child.firstName}` : null,
  );
  const given = index((child) => child.firstName);

  return (raw: string): Match => {
    const key = norm(raw);
    for (const map of [full, short, given]) {
      const ids = map.get(key);
      if (ids?.length === 1) return { kind: "one", childId: ids[0]! };
      if (ids && ids.length > 1) return { kind: "many" };
    }
    return { kind: "none" };
  };
}
