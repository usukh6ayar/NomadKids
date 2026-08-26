import ExcelJS from "exceljs";

/**
 * The roster as a spreadsheet — RFP §12.3's "Excel импорт, экспорт".
 *
 * ★ The export's columns are the import's columns, in the import's order.
 *
 * This is the property that makes the pair useful rather than merely present:
 * an administrator exports the roster, edits it in Excel, and uploads it again.
 * If the two shapes disagreed, that round trip would fail on the header row and
 * the export would be a dead end — a file you can look at and not use.
 *
 * `child-import.ts` accepts several spellings per column; these are the ones it
 * lists first, so a file this produces is always readable by that parser.
 */

export interface ExportChild {
  lastName: string;
  firstName: string;
  sex: string | null;
  dateOfBirth: string | null;
  nationalId: string | null;
  groupName: string | null;
  healthNotes: string | null;
  status: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Идэвхтэй",
  INACTIVE: "Идэвхгүй",
  GRADUATED: "Төгссөн",
  TRANSFERRED: "Шилжсэн",
};

export async function buildChildWorkbook(
  children: ExportChild[],
  kindergartenName: string,
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "NomadKids";
  book.created = new Date();

  const sheet = book.addWorksheet("Хүүхдүүд");

  sheet.columns = [
    { header: "Овог", key: "lastName", width: 20 },
    { header: "Нэр", key: "firstName", width: 20 },
    { header: "Хүйс", key: "sex", width: 10 },
    { header: "Төрсөн огноо", key: "dateOfBirth", width: 14 },
    { header: "Регистр", key: "nationalId", width: 16 },
    { header: "Бүлэг", key: "groupName", width: 18 },
    { header: "Эрүүл мэнд", key: "healthNotes", width: 34 },
    /*
     * ★ Status is last, and the importer ignores it.
     *
     * It belongs in an export — an administrator wants to see who has left —
     * but it must never be settable from a spreadsheet: a stale cell would
     * reactivate a child who graduated, or retire one who did not. Column
     * order is what keeps the round trip working; an extra trailing column the
     * parser does not recognise costs nothing.
     */
    { header: "Төлөв", key: "status", width: 12 },
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF4FF" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const child of children) {
    sheet.addRow({
      lastName: child.lastName,
      firstName: child.firstName,
      // The words the importer's `parseSex` accepts, not MALE/FEMALE — an
      // administrator editing this file should not have to type an enum.
      sex: child.sex === "MALE" ? "Хүү" : child.sex === "FEMALE" ? "Охин" : "",
      // Written as text in `YYYY-MM-DD` rather than as an Excel date cell.
      // A date cell is re-displayed in the reader's locale, so a file exported
      // here and opened elsewhere can show a different day — and this column is
      // read back by the importer.
      dateOfBirth: child.dateOfBirth ? child.dateOfBirth.slice(0, 10) : "",
      nationalId: child.nationalId ?? "",
      groupName: child.groupName ?? "",
      healthNotes: child.healthNotes ?? "",
      status: child.status ? (STATUS_LABEL[child.status] ?? child.status) : "",
    });
  }

  // A trailing sheet naming the source, so a file found on a desktop months
  // later still says which kindergarten and which day it came from.
  const about = book.addWorksheet("Тайлбар");
  about.columns = [{ width: 24 }, { width: 44 }];
  about.addRow(["Цэцэрлэг", kindergartenName]).getCell(1).font = { bold: true };
  about.addRow(["Татсан огноо", new Date().toLocaleDateString("mn-MN")]).getCell(1).font = {
    bold: true,
  };
  about.addRow(["Хүүхдийн тоо", children.length]).getCell(1).font = { bold: true };
  about.addRow([]);
  about
    .addRow([
      "Санамж",
      "Энэ файлыг засаад буцаан оруулж болно. 'Төлөв' багана импортод ашиглагдахгүй.",
    ])
    .getCell(1).font = { bold: true };

  return (await book.xlsx.writeBuffer()) as unknown as Buffer;
}
