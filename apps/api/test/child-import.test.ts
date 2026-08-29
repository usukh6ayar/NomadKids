import { afterAll, beforeAll, expect, it } from "vitest";
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
