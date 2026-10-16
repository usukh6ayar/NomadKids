import type { INestApplication } from "@nestjs/common";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  assignTeacher,
  authed,
  createChild,
  createGroup,
  createMembership,
  createScenario,
  createUser,
  enrollChild,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * «Ирц сараар нөхөх» — a past month filled in at once (the user, 2026-10-16).
 * `PUT /groups/:id/attendance/range`, and the range read's new fields.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let teacherA: AuthSession;
let parentA: AuthSession;
let teacherB: AuthSession;
let otherGroupTeacher: AuthSession;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Нарны бүлэг");
  const other = await createUser({ username: `teacher-a-other-${Date.now()}` });
  const membership = await createMembership(other.id, a.kindergarten.id, "TEACHER");
  await assignTeacher(a.kindergarten.id, otherGroup.id, membership.id);

  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  teacherB = await login(app, b.teacherUser.username);
  otherGroupTeacher = await login(app, other.username);
});

const server = () => app.getHttpServer();

const save = (session: AuthSession, groupId: string, entries: unknown[]) =>
  authed(request(server()).put(`/v1/groups/${groupId}/attendance/range`), session).send({
    entries,
  });

describe("filling in a month", () => {
  it("writes a month in one save, and a second save only changes what changed", async () => {
    const first = await save(teacherA, a.group.id, [
      { childId: a.child.id, date: "2026-02-02", status: "PRESENT" },
      { childId: a.child.id, date: "2026-02-03", status: "SICK" },
      { childId: a.child.id, date: "2026-02-04", status: "PRESENT" },
    ]);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ created: 3, updated: 0 });

    const second = await save(teacherA, a.group.id, [
      { childId: a.child.id, date: "2026-02-03", status: "SICK" },
      { childId: a.child.id, date: "2026-02-04", status: "ABSENT" },
    ]);
    expect(second.body).toEqual({ created: 0, updated: 1 });

    const rows = await db.attendance.findMany({
      where: { childId: a.child.id, deletedAt: null },
      orderBy: { date: "asc" },
    });
    expect(rows.map((row) => row.status)).toEqual(["PRESENT", "SICK", "ABSENT"]);
    expect(rows.every((row) => row.enrollmentId === a.enrollment.id)).toBe(true);
  });

  it("reads back the month's working days and each child's days in the group", async () => {
    await db.calendarDay.create({
      data: { kindergartenId: a.kindergarten.id, date: new Date("2026-02-03"), name: "Цагаан сар" },
    });
    const res = await authed(
      request(server()).get(
        `/v1/groups/${a.group.id}/attendance/range?from=2026-02-01&to=2026-02-07`,
      ),
      teacherA,
    );
    expect(res.status).toBe(200);
    // 1 Feb is a Sunday; the 3rd is closed by the calendar.
    expect(res.body.workingDays).toEqual(["2026-02-02", "2026-02-04", "2026-02-05", "2026-02-06"]);
    const row = res.body.rows.find((r: { child: { id: string } }) => r.child.id === a.child.id);
    expect(row.startedOn).toBe("2025-09-01");
    expect(row.endedOn).toBeNull();
  });

  it("refuses a day the child was not in the group, and writes nothing", async () => {
    const left = await createChild(a.kindergarten.id, { firstName: "Номин" });
    // Ended 2026-01-31 (the fixture's end date).
    await enrollChild(a.kindergarten.id, left.id, a.group.id, a.schoolYear.id, "TRANSFERRED");

    const res = await save(teacherA, a.group.id, [
      { childId: a.child.id, date: "2026-02-02", status: "PRESENT" },
      { childId: left.id, date: "2026-02-02", status: "PRESENT" },
    ]);
    expect(res.status).toBe(400);
    expect(await db.attendance.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(0);

    // The days before the move are theirs.
    const before = await save(teacherA, a.group.id, [
      { childId: left.id, date: "2026-01-30", status: "PRESENT" },
    ]);
    expect(before.status).toBe(200);
  });

  it("refuses a future day and a span over a month", async () => {
    const future = await save(teacherA, a.group.id, [
      { childId: a.child.id, date: "2099-01-05", status: "PRESENT" },
    ]);
    expect(future.status).toBe(400);

    const long = await save(teacherA, a.group.id, [
      { childId: a.child.id, date: "2026-01-05", status: "PRESENT" },
      { childId: a.child.id, date: "2026-02-20", status: "PRESENT" },
    ]);
    expect(long.status).toBe(400);
  });

  it("teacher from another group gets 404", async () => {
    const res = await save(otherGroupTeacher, a.group.id, [
      { childId: a.child.id, date: "2026-02-02", status: "PRESENT" },
    ]);
    expect(res.status).toBe(404);
    expect(await db.attendance.count()).toBe(0);
  });

  it("guardian of the child gets 404", async () => {
    const res = await save(parentA, a.group.id, [
      { childId: a.child.id, date: "2026-02-02", status: "PRESENT" },
    ]);
    expect(res.status).toBe(404);
    expect(await db.attendance.count()).toBe(0);
  });

  it("user from another kindergarten gets 404", async () => {
    const res = await save(teacherB, a.group.id, [
      { childId: a.child.id, date: "2026-02-02", status: "PRESENT" },
    ]);
    expect(res.status).toBe(404);

    // Nor can A's group carry B's child.
    const cross = await save(teacherA, a.group.id, [
      { childId: b.child.id, date: "2026-02-02", status: "PRESENT" },
    ]);
    expect(cross.status).toBe(400);
    expect(await db.attendance.count()).toBe(0);
  });
});

/**
 * «Ирц сараар нөхөх» by Excel — the sheet is read for the grid, never written.
 */
describe("reading a month out of a spreadsheet", () => {
  const upload = (session: AuthSession, groupId: string, file: Buffer, name = "ирц.xlsx") =>
    authed(
      request(server()).post(`/v1/groups/${groupId}/attendance/range/import?month=2026-02`),
      session,
    ).attach("file", file, name);

  it("reads back the journal's own download, edited in Excel", async () => {
    const exported = await authed(
      request(server())
        .get(`/v1/groups/${a.group.id}/attendance/range/export?from=2026-02-01&to=2026-02-28`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => done(null, Buffer.concat(chunks)));
        }),
      teacherA,
    );
    expect(exported.status).toBe(200);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(exported.body as ArrayBuffer);
    const sheet = book.getWorksheet("Өдөр тутмын ирц")!;
    // Row 3 is the heading; the child is the first row under it.
    const header = sheet.getRow(3);
    const columnOf = (day: string) => {
      let found = 0;
      header.eachCell((cell, column) => {
        if (String(cell.value) === day) found = column;
      });
      return found;
    };
    const childRow = sheet.getRow(4);
    childRow.getCell(columnOf("02")).value = "Ирсэн";
    childRow.getCell(columnOf("03")).value = "Ө";
    childRow.getCell(columnOf("04")).value = "+";
    childRow.getCell(columnOf("07")).value = "И"; // a Saturday
    childRow.getCell(columnOf("05")).value = "??";
    const file = Buffer.from(await book.xlsx.writeBuffer());

    const res = await upload(teacherA, a.group.id, file);
    expect(res.status).toBe(201);
    expect(res.body.entries).toEqual([
      { childId: a.child.id, date: "2026-02-02", status: "PRESENT" },
      { childId: a.child.id, date: "2026-02-03", status: "SICK" },
      { childId: a.child.id, date: "2026-02-04", status: "PRESENT" },
    ]);
    const messages = res.body.problems.map((p: { message: string }) => p.message).join(" | ");
    expect(messages).toContain("2026-02-07: амралтын өдөр");
    expect(messages).toContain("«??»");

    // Read for the grid — nothing written.
    expect(await db.attendance.count()).toBe(0);
  });

  it("reads a CSV with surname and name columns, and names a child it cannot find", async () => {
    const csv = Buffer.from(
      [
        "Овог;Нэр;1;2;3;4",
        `${a.child.lastName ?? ""};${a.child.firstName};;И;Ч;Т`,
        "Хэн;Нэгэн;;И;;",
      ].join("\n"),
    );
    const res = await upload(teacherA, a.group.id, csv, "ирц.csv");
    expect(res.status).toBe(201);
    expect(res.body.entries).toEqual([
      { childId: a.child.id, date: "2026-02-02", status: "PRESENT" },
      { childId: a.child.id, date: "2026-02-03", status: "EXCUSED" },
      { childId: a.child.id, date: "2026-02-04", status: "ABSENT" },
    ]);
    expect(res.body.problems).toEqual([
      { rowNumber: 3, message: "Бүлэгт ийм хүүхэд олдсонгүй: «Хэн Нэгэн»" },
    ]);
  });

  const someFile = () => Buffer.from("Хүүхэд;1;2;3\nБат;И;И;И\n");

  it("teacher from another group gets 404", async () => {
    expect((await upload(otherGroupTeacher, a.group.id, someFile(), "a.csv")).status).toBe(404);
  });

  it("guardian of the child gets 404", async () => {
    expect((await upload(parentA, a.group.id, someFile(), "a.csv")).status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    expect((await upload(teacherB, a.group.id, someFile(), "a.csv")).status).toBe(404);
  });
});
