import { afterAll, beforeAll, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/app";
import { createScenario, login, authed, type Scenario } from "./support/fixtures";
import { resetData } from "./support/db";

/**
 * Roster export, and the round trip back — RFP §12.3.
 *
 * ★ The round trip is the point. An export whose file the importer cannot read
 * is a dead end, and the case that proves it is a child with no national id:
 * matching on the id alone re-created them on every re-upload.
 */

let app: INestApplication;
let a: Scenario, b: Scenario;
let teacherA: string[], teacherB: string[], parentA: string[];

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

it("export -> import round trip: the file this produces is one this accepts", async () => {
  // Seed via the import so the roster has known rows.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("s");
  ws.addRow(["Овог", "Нэр", "Хүйс", "Төрсөн огноо", "Регистр", "Бүлэг"]);
  ws.addRow(["Бат", "Тэмүүлэн", "Хүү", "2021-04-15", "УБ12345678", a.group.name]);
  ws.addRow(["Ганаа", "Сарнай", "Охин", "2020-09-01", "АА87654321", a.group.name]);
  const seed = Buffer.from(await wb.xlsx.writeBuffer());

  const seeded = await authed(
    request(app.getHttpServer()).post(
      `/v1/kindergartens/${a.kindergarten.id}/children/import?dryRun=false`,
    ),
    teacherA,
  ).attach("file", seed, "r.xlsx");
  expect(seeded.body.imported).toHaveLength(2);

  // Export it back out.
  const exported = await authed(
    request(app.getHttpServer()).get(`/v1/kindergartens/${a.kindergarten.id}/children/export`),
    teacherA,
  )
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });

  expect(exported.status).toBe(200);
  expect(exported.headers["content-type"]).toContain("spreadsheetml");

  // Feed the exported file straight back in as a dry run. Every row should be
  // understood — and skipped as already registered, which proves the parser
  // read the names and national ids rather than failing on the header.
  const round = await authed(
    request(app.getHttpServer()).post(
      `/v1/kindergartens/${a.kindergarten.id}/children/import?dryRun=true`,
    ),
    teacherA,
  ).attach("file", exported.body, "r.xlsx");

  expect(round.status).toBe(201);
  /*
   * Nothing is created a second time — including the scenario's own child, who
   * has no national id. That is the case this round trip exists to prove: the
   * export writes an empty register cell for them, and matching on the id alone
   * would have created them again on every re-upload.
   */
  expect(round.body.willImport).toBe(0);
  expect(round.body.problems.length).toBeGreaterThanOrEqual(3);
  expect(round.body.problems.every((p: any) => p.message.includes("алгасав"))).toBe(true);
});

it("export is scoped: another kindergarten's teacher gets 404, a guardian 404", async () => {
  const g = (c: string[]) =>
    authed(
      request(app.getHttpServer()).get(`/v1/kindergartens/${a.kindergarten.id}/children/export`),
      c,
    );
  expect((await g(teacherB)).status).toBe(404);
  expect((await g(parentA)).status).toBe(404);
});
