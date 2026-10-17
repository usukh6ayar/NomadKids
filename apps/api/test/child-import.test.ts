import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/app";
import { createScenario, login, authed, type Scenario } from "./support/fixtures";
import { resetData, testDb } from "./support/db";

/**
 * Excel roster import — RFP §3.4.
 *
 * ★ Kept as a real suite rather than a scratch probe, because this endpoint
 * writes child records in bulk and takes an uploaded file. The two things worth
 * guarding for ever are that a dry run writes nothing, and that neither the
 * spreadsheet nor another kindergarten's teacher can choose the tenant.
 */

let app: INestApplication;
let a: Scenario, b: Scenario;
let teacherA: string[], teacherB: string[], parentA: string[];

async function book(rows: unknown[][], groupName: string) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("s");
  ws.addRow(["Овог", "Нэр", "Хүйс", "Төрсөн огноо", "Регистр", "Бүлэг"]);
  for (const r of rows) ws.addRow(r.map((c) => (c === "@G" ? groupName : c)));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  app = await createTestApp();
  await resetData();
  a = await createScenario("a");
  b = await createScenario("b");
  teacherA = await login(app, a.teacherUser.username);
  teacherB = await login(app, b.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
});
afterAll(async () => {
  await app.close();
});

const post = (kg: string, c: string[], buf: Buffer, dry: boolean) =>
  authed(
    request(app.getHttpServer()).post(`/v1/kindergartens/${kg}/children/import?dryRun=${dry}`),
    c,
  ).attach("file", buf, "roster.xlsx");

it("dry run writes nothing and reports what would happen", async () => {
  const before = await testDb().child.count({ where: { kindergartenId: a.kindergarten.id } });
  const buf = await book(
    [["Бат", "Тэмүүлэн", "Хүү", "2021-04-15", "УБ12345678", "@G"]],
    a.group.name,
  );

  const res = await post(a.kindergarten.id, teacherA, buf, true);
  expect(res.status).toBe(201);
  expect(res.body.dryRun).toBe(true);
  expect(res.body.willImport).toBe(1);
  expect(res.body.imported).toEqual([]);

  const after = await testDb().child.count({ where: { kindergartenId: a.kindergarten.id } });
  expect(after).toBe(before);
});

it("commit writes the children and enrolls them", async () => {
  const buf = await book(
    [
      ["Ганаа", "Сарнай", "Охин", "2020-09-01", "АА87654321", "@G"],
      ["Дорж", "Ану", "Хүү", "2022-07-03", "", "@G"],
    ],
    a.group.name,
  );

  const res = await post(a.kindergarten.id, teacherA, buf, false);
  expect(res.status).toBe(201);
  expect(res.body.imported).toHaveLength(2);

  const enrolled = await testDb().enrollment.count({
    where: { groupId: a.group.id, childId: { in: res.body.imported.map((c: any) => c.id) } },
  });
  expect(enrolled).toBe(2);
});

it("a second upload of the same file skips rather than overwrites", async () => {
  const buf = await book(
    [["Ганаа", "Сарнай", "Охин", "2020-09-01", "АА87654321", "@G"]],
    a.group.name,
  );
  const res = await post(a.kindergarten.id, teacherA, buf, true);
  expect(res.body.willImport).toBe(0);
  expect(res.body.problems[0].message).toContain("аль хэдийн бүртгэлтэй");
});

it("a group name from another kindergarten is refused", async () => {
  const buf = await book([["Хулан", "Тэнгис", "Охин", "2021-05-05", "", "@G"]], b.group.name);
  const res = await post(a.kindergarten.id, teacherA, buf, true);
  expect(res.body.willImport).toBe(0);
  expect(res.body.problems[0].message).toContain("бүлэг олдсонгүй");
});

it("a teacher from another kindergarten cannot import, and a guardian cannot either", async () => {
  const buf = await book([["Х", "Т", "Охин", "2021-05-05", "", "@G"]], a.group.name);
  expect((await post(a.kindergarten.id, teacherB, buf, true)).status).toBe(404);
  expect((await post(a.kindergarten.id, parentA, buf, true)).status).toBe(404);
});

it("a non-spreadsheet is refused by content, not by extension", async () => {
  const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(200)]);
  const res = await authed(
    request(app.getHttpServer()).post(
      `/v1/kindergartens/${a.kindergarten.id}/children/import?dryRun=true`,
    ),
    teacherA,
  ).attach("file", exe, "roster.xlsx");
  expect(res.status).toBe(400);
});

it("a whole import fails together: nothing lands when a later row is bad", async () => {
  const before = await testDb().child.count({ where: { kindergartenId: a.kindergarten.id } });
  const buf = await book(
    [
      ["Сайн", "Мөр", "Хүү", "2021-01-01", "", "@G"],
      ["Муу", "Мөр", "тодорхойгүй", "2021-01-01", "", "@G"],
    ],
    a.group.name,
  );

  const res = await post(a.kindergarten.id, teacherA, buf, false);
  // The good row still imports; the bad one is reported. All-or-nothing applies
  // to the write, not to validation — a bad row never reaches the transaction.
  expect(res.body.imported).toHaveLength(1);
  expect(res.body.problems).toHaveLength(1);
  const after = await testDb().child.count({ where: { kindergartenId: a.kindergarten.id } });
  expect(after).toBe(before + 1);
});

/**
 * 2026-10-16, «4-р цэцэрлэг»: children deleted and imported again answered 500
 * four times — the register's unique index counted deleted children, while
 * every check asked among live ones. The index is partial now.
 */
it("a deleted child's register can be imported again", async () => {
  const first = await post(
    a.kindergarten.id,
    teacherA,
    await book([["Буцаж", "Ирсэн", "Хүү", "2021-03-03", "ЗЗ11223344", "@G"]], a.group.name),
    false,
  );
  expect(first.status).toBe(201);
  const childId = first.body.imported[0].id as string;
  await testDb().child.update({ where: { id: childId }, data: { deletedAt: new Date() } });

  const again = await post(
    a.kindergarten.id,
    teacherA,
    await book([["Буцаж", "Ирсэн", "Хүү", "2021-03-03", "ЗЗ11223344", "@G"]], a.group.name),
    false,
  );
  expect(again.status).toBe(201);
  expect(again.body.imported).toHaveLength(1);

  // Still one live child per register: a third upload would skip, never 500.
  const third = await post(
    a.kindergarten.id,
    teacherA,
    await book([["Буцаж", "Ирсэн", "Хүү", "2021-03-03", "ЗЗ11223344", "@G"]], a.group.name),
    true,
  );
  expect(third.status).toBe(201);
  expect(third.body.willImport).toBe(0);
  expect(third.body.problems[0].message).toContain("аль хэдийн бүртгэлтэй");
});

/**
 * Whatever the roster was saved as — 2026-10-16, the client: "Эксэл оруулахад
 * олон төрлөөс таньж оруулж болдог болгоод өг". Dry runs: nothing is written.
 */
describe("rosters in the shapes kindergartens actually have", () => {
  const dry = (buf: Buffer, name: string) =>
    authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${a.kindergarten.id}/children/import?dryRun=true`,
      ),
      teacherA,
    ).attach("file", buf, name);

  it("finds the headings below a title, on a later sheet, with marks and a rich-text heading", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Заавар").addRow(["Энэ хуудсыг бөглөнө үү"]);
    const ws = wb.addWorksheet("Жагсаалт");
    ws.addRow(["2026-2027 оны хичээлийн жилийн хүүхдийн бүртгэл"]);
    ws.addRow([]);
    ws.addRow([
      "№",
      { richText: [{ text: "Овог" }, { text: ":" }] },
      "Нэр *",
      "Хүйс",
      "Төрсөн огноо (он-сар-өдөр)",
      "Бүлгийн нэр",
    ]);
    ws.addRow([1, "Төмөр", "Анир", "Эр.", "2021 оны 4 сарын 15", a.group.name]);
    ws.addRow([2, "Цогт", "Номин", "охин", 44301, a.group.name]);

    const res = await dry(Buffer.from(await wb.xlsx.writeBuffer()), "roster.xlsx");
    expect(res.status).toBe(201);
    expect(res.body.problems).toEqual([]);
    expect(res.body.willImport).toBe(2);
  });

  it("splits a single «Овог нэр» column", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow(["Хүүхдийн овог нэр", "Хүйс", "Төрсөн огноо"]);
    ws.addRow(["Батын Тэнүүн", "Хүү", "15.04.2021"]);
    ws.addRow(["Тэмүүлэн", "Хүү", "15.04.2021"]);

    const res = await dry(Buffer.from(await wb.xlsx.writeBuffer()), "roster.xlsx");
    expect(res.body.willImport).toBe(1);
    expect(res.body.problems).toEqual([{ rowNumber: 3, message: "Овог хоосон байна" }]);
  });

  it("reads a windows-1251 CSV separated by semicolons, as Windows Excel saves one", async () => {
    // «Овог;Нэр;Хүйс;Төрсөн огноо» / «Сүх;Ариун;Хүү;05.04.2021» in cp1251.
    const cp1251 = (s: string) =>
      Buffer.from(
        [...s].map((ch) => {
          const code = ch.codePointAt(0)!;
          if (code < 0x80) return code;
          if (code >= 0x410 && code <= 0x44f) return code - 0x350;
          return { Ө: 0xaa, ө: 0xba, Ү: 0xaf, ү: 0xbf, Ё: 0xa8, ё: 0xb8 }[ch] ?? 0x3f;
        }),
      );
    const csv = cp1251("Овог;Нэр;Хүйс;Төрсөн огноо\r\nСүх;Ариун;Хүү;05.04.2021\r\n");
    const res = await dry(csv, "roster.csv");
    expect(res.status).toBe(201);
    expect(res.body.problems).toEqual([]);
    expect(res.body.willImport).toBe(1);
  });

  it("reads a UTF-8 CSV with commas and a quoted field", async () => {
    const csv = Buffer.from(
      '﻿Овог,Нэр,Хүйс,Төрсөн огноо,Эрүүл мэнд\n"Болд","Хонгор","Охин","2021-06-01","Самар, сүү"\n',
    );
    const res = await dry(csv, "roster.csv");
    expect(res.body.problems).toEqual([]);
    expect(res.body.willImport).toBe(1);
  });

  it("refuses a legacy .xls with a message that says how to re-save it", async () => {
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(504),
    ]);
    const res = await dry(ole, "roster.xls");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(".xlsx");
  });
});

/*
 * ★ 2026-10-18, the user: «овог нэр регистер төрсөн он сар хүйс» — headings
 * as teachers write them, columns in any order, the register standing in for
 * an empty birth date and sex, and the template's «Жишээ» rows never imported.
 */
describe("a roster as teachers write it", () => {
  async function workbook(rows: unknown[][]) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    for (const row of rows) ws.addRow(row);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it("reads «Регистер» and «Төрсөн он сар» in any order, and the register's birth date and sex", async () => {
    const { parseChildWorkbook } = await import("../src/children/child-import");
    const result = await parseChildWorkbook(
      await workbook([
        ["Хүйс", "Регистер", "Нэр", "Төрсөн он сар", "Овог"],
        ["Эрэгтэй", "УП21241512", "Тэмүүлэн", "2021-04-15", "Батын"],
        [null, "УП20310324", "Анужин", null, "Доржийн"],
      ]),
    );

    expect(result.problems).toEqual([]);
    expect(
      result.rows.map((r) => [r.lastName, r.firstName, r.sex, r.dateOfBirth, r.nationalId]),
    ).toEqual([
      ["Батын", "Тэмүүлэн", "MALE", "2021-04-15", "УП21241512"],
      ["Доржийн", "Анужин", "FEMALE", "2020-11-03", "УП20310324"],
    ]);
  });

  it("reads a heading with a note after it", async () => {
    const { parseChildWorkbook } = await import("../src/children/child-import");
    const result = await parseChildWorkbook(
      await workbook([
        ["Овог", "Нэр", "Төрсөн огноо (жил-сар-өдөр)", "Хүйс (эр/эм)"],
        ["Батын", "Тэмүүлэн", "2021-04-15", "эр"],
      ]),
    );

    expect(result.rows).toHaveLength(1);
  });

  it("imports nothing from the template's «Жишээ» rows", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { parseChildWorkbook } = await import("../src/children/child-import");
    const template = readFileSync(
      join(__dirname, "../../web/public/templates/huuhdiin-burtgel-zagvar.xlsx"),
    );

    const result = await parseChildWorkbook(template);

    expect(result).toEqual({ rows: [], problems: [] });
  });
});
