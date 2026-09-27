import ExcelJS from "exceljs";
import { ROLE_LABEL, STAFF_CATEGORY_LABEL } from "@kinder/contracts";

/**
 * «Багш, ажилтан» as a spreadsheet — 2026-09-27.
 *
 * Layout only: the rows are the directory's own query with the screen's
 * filters, so the file and the screen list the same people.
 */

export interface StaffWorkbookRow {
  lastName: string;
  firstName: string;
  registerNumber: string | null;
  dateOfBirth: Date | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  memberships: {
    role: string;
    position: string | null;
    staffCategory: string | null;
    startedOn: Date | null;
    assignments: { group: { name: string } }[];
  }[];
}

const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "");

export async function buildStaffWorkbook(rows: StaffWorkbookRow[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Багш, ажилтан");
  sheet.columns = [
    { header: "Овог", key: "lastName", width: 18 },
    { header: "Нэр", key: "firstName", width: 18 },
    { header: "Регистр", key: "registerNumber", width: 14 },
    { header: "Төрсөн огноо", key: "dateOfBirth", width: 13 },
    { header: "Утас", key: "phone", width: 12 },
    { header: "И-мэйл", key: "email", width: 26 },
    { header: "Үүрэг", key: "role", width: 16 },
    { header: "Албан тушаал", key: "position", width: 20 },
    { header: "Ангилал", key: "category", width: 14 },
    { header: "Ажилд орсон", key: "startedOn", width: 13 },
    { header: "Бүлэг", key: "groups", width: 24 },
    { header: "Төлөв", key: "status", width: 10 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const person of rows) {
    // One line per membership: a person who is both a teacher and an
    // administrator is two jobs, and each has its own position and start.
    const memberships = person.memberships.length ? person.memberships : [null];
    for (const m of memberships) {
      sheet.addRow({
        lastName: person.lastName,
        firstName: person.firstName,
        registerNumber: person.registerNumber ?? "",
        dateOfBirth: day(person.dateOfBirth),
        phone: person.phone ?? "",
        email: person.email ?? "",
        role: m ? (ROLE_LABEL[m.role as keyof typeof ROLE_LABEL] ?? m.role) : "",
        position: m?.position ?? "",
        category: m?.staffCategory
          ? (STAFF_CATEGORY_LABEL[m.staffCategory as keyof typeof STAFF_CATEGORY_LABEL] ?? "")
          : "",
        startedOn: day(m?.startedOn ?? null),
        groups: m ? m.assignments.map((a) => a.group.name).join(", ") : "",
        status: person.isActive ? "Идэвхтэй" : "Идэвхгүй",
      });
    }
  }

  return Buffer.from(await book.xlsx.writeBuffer());
}
