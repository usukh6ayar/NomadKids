import ExcelJS from "exceljs";
import type { EsisCoverageMatrix, EsisCoverageState } from "./esis-coverage";

/**
 * The 84/84 matrix as a spreadsheet — the artifact the ministry reads.
 *
 * ★ A file rather than a screenshot of a screen, because this one leaves the
 * building. A reviewer sorts it, filters it and counts it, and the covering
 * letter quotes the summary block at the top.
 *
 * ★★ The summary is **formulas over the rows**, not numbers written beside
 * them. A reviewer who filters the sheet sees the count change, which is what
 * makes it checkable rather than merely asserted — the same argument
 * `invoice-register-workbook.ts` makes for its totals.
 */

const STATE_LABEL: Readonly<Record<EsisCoverageState, string>> = {
  IN_USE: "Ашиглаж байна",
  WIRED_UNUSED: "Холбогдсон, энэ хугацаанд дуудаагүй",
  DISPOSITIONED: "Зориудаар холбоогүй",
  SUPERSEDED: "Дараагийн хувилбараар солигдсон",
  UNDECIDED: "Шийдвэрлээгүй",
};

function asDate(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export async function buildEsisCoverageWorkbook(
  matrix: EsisCoverageMatrix,
  kindergartenName: string,
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "NomadKids";
  book.created = new Date();

  const sheet = book.addWorksheet("ЭСИС сервисийн ашиглалт");
  sheet.columns = [
    { header: "API дугаар", key: "apiId", width: 20 },
    { header: "Сервисийн нэр", key: "name", width: 46 },
    { header: "Зорилго", key: "purpose", width: 42 },
    { header: "Дуудагдах нөхцөл", key: "trigger", width: 32 },
    { header: "Сүүлд дуудсан", key: "lastCalledAt", width: 15 },
    { header: "Дуудсан тоо", key: "calls", width: 13 },
    { header: "Төлөв", key: "state", width: 30 },
    { header: "Тайлбар", key: "reason", width: 64 },
  ];

  for (const row of matrix.rows) {
    sheet.addRow({
      apiId: row.apiId,
      name: row.name,
      purpose: row.purpose,
      trigger: row.trigger,
      lastCalledAt: asDate(row.lastCalledAt),
      calls: row.calls,
      state: STATE_LABEL[row.state],
      reason: row.reason ?? "",
    });
  }

  /*
   * ★ Wrapped, because a reason is a sentence and a truncated one reads as
   * evasion — which is the opposite of what this column is for.
   */
  sheet.getColumn("reason").alignment = { wrapText: true, vertical: "top" };
  sheet.getColumn("purpose").alignment = { wrapText: true, vertical: "top" };

  /*
   * ★★ The two counts the ministry actually asks for, as formulas over the
   * rows beneath them. "We used what you granted" and "we called nothing
   * without a reason" are the whole argument, and a reviewer can re-count both
   * without trusting this file's arithmetic.
   */
  const first = 2;
  const last = matrix.rows.length + 1;
  sheet.spliceRows(1, 0, []);
  sheet.spliceRows(1, 0, []);
  sheet.spliceRows(1, 0, []);
  sheet.spliceRows(1, 0, []);

  const title = sheet.getRow(1);
  title.getCell(1).value = `${kindergartenName} — ЭСИС-ийн сервисийн ашиглалт`;
  title.font = { bold: true, size: 12 };

  const period = sheet.getRow(2);
  period.getCell(1).value = `Хугацаа: ${asDate(matrix.from)} — ${asDate(matrix.to)}`;

  const counts = sheet.getRow(3);
  counts.getCell(1).value = "Олгосон эрх";
  counts.getCell(2).value = matrix.rows.length;
  counts.getCell(3).value = "Үүнээс ашигласан";
  counts.getCell(4).value = {
    formula: `COUNTIF(G${first + 4}:G${last + 4},"${STATE_LABEL.IN_USE}")`,
  };
  counts.getCell(5).value = "Шалтгаангүй дуудаагүй";
  /*
   * ★★★ This cell should read **0**, and it is on the sheet precisely so that
   * a reviewer sees it rather than taking our word. `esis-coverage.test.ts`
   * refuses to let it be anything else; here it is the claim, checkable.
   */
  counts.getCell(6).value = {
    formula: `COUNTIF(G${first + 4}:G${last + 4},"${STATE_LABEL.UNDECIDED}")`,
  };
  counts.font = { bold: true };

  sheet.getRow(5).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 5 }];

  return (await book.xlsx.writeBuffer()) as unknown as Buffer;
}
