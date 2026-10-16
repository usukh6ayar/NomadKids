import type { INestApplication } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  assignTeacher,
  authed,
  createGroup,
  createMembership,
  createScenario,
  createSchoolYear,
  createUser,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";

/**
 * #235 made a teacher's reach the child's ACTIVE enrolment: the teacher a
 * child has left keeps their own notes and nothing else. Three teacher feeds
 * still listed children by the group a record was *filed under*, and one data
 * fault kept the old reach alive through a stale ACTIVE row. These tests hold
 * all four to the rule.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let newTeacher: AuthSession;
let newGroupId: string;

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
  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);

  const group = await createGroup(a.kindergarten.id, a.schoolYear.id, "Шинэ бүлэг");
  newGroupId = group.id;
  const user = await createUser({ username: uniq("newteacher") });
  const membership = await createMembership(user.id, a.kindergarten.id, "TEACHER");
  await assignTeacher(a.kindergarten.id, group.id, membership.id);
  newTeacher = await login(app, user.username);
});

const server = () => app.getHttpServer();

/** Files the family's note and absence request, then the director moves the child. */
async function fileThenMove() {
  const note = await authed(
    request(server()).post(`/v1/children/${a.child.id}/parent-observations`),
    parentA,
  ).send({ observedOn: "2026-02-11", situation: "Гэртээ ном уншив" });
  expect(note.status).toBe(201);

  const asked = await authed(
    request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
    parentA,
  )
    .field("dateFrom", "2099-03-02")
    .field("dateTo", "2099-03-03")
    .field("requestedStatus", "SICK")
    .field("reason", "Халуурсан");
  expect(asked.status).toBe(201);

  const moved = await authed(
    request(server()).post(`/v1/children/${a.child.id}/enrollments`),
    adminA,
  ).send({ groupId: newGroupId });
  expect(moved.status).toBe(201);
}

const dashboard = (session: AuthSession) =>
  request(server()).get("/v1/dashboard/teacher").set("Cookie", session.cookies);
const requestQueue = (session: AuthSession) =>
  request(server()).get("/v1/attendance-requests/review-queue").set("Cookie", session.cookies);
const childIds = (rows: { child: { id: string } }[]) => rows.map((row) => row.child.id);

describe("the feeds follow the group the child attends now", () => {
  it("the teacher the child left sees none of it on their dashboard", async () => {
    await fileThenMove();

    const res = await dashboard(teacherA);
    expect(res.status).toBe(200);
    expect(res.body.needsAttention.pendingReviews).toBe(0);
    expect(childIds(res.body.recentObservations)).not.toContain(a.child.id);
  });

  it("the new teacher's dashboard counts and shows it", async () => {
    await fileThenMove();

    const res = await dashboard(newTeacher);
    expect(res.body.needsAttention.pendingReviews).toBe(1);
    expect(childIds(res.body.recentObservations)).toContain(a.child.id);
  });

  it("the absence request moves to the new teacher's queue", async () => {
    await fileThenMove();

    const old = await requestQueue(teacherA);
    expect(old.status).toBe(200);
    expect(old.body.items).toHaveLength(0);

    const now = await requestQueue(newTeacher);
    expect(childIds(now.body.items)).toEqual([a.child.id]);
  });

  it("a teacher of another kindergarten sees nothing either way", async () => {
    await fileThenMove();
    const teacherB = await login(app, b.teacherUser.username);

    expect((await dashboard(teacherB)).body.needsAttention.pendingReviews).toBe(0);
    expect((await requestQueue(teacherB)).body.items).toHaveLength(0);
  });
});

describe("the data migration ends a stale earlier-year ACTIVE enrolment", () => {
  function runMigration() {
    const sql = readFileSync(
      join(
        __dirname,
        "../prisma/migrations/20261016130000_end_earlier_active_enrollments/migration.sql",
      ),
      "utf8",
    );
    return db.$executeRawUnsafe(sql);
  }

  it("closes last year's row, and the old group's teacher loses the child", async () => {
    // A move into next year's group before 2026-09-01 left last year ACTIVE.
    const nextYear = await createSchoolYear(a.kindergarten.id, false);
    await db.schoolYear.update({
      where: { id: nextYear.id },
      data: { startsOn: new Date("2026-09-01"), endsOn: new Date("2027-06-01") },
    });
    const nextGroup = await createGroup(a.kindergarten.id, nextYear.id, "Дараа жил");
    const current = await db.enrollment.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        groupId: nextGroup.id,
        schoolYearId: nextYear.id,
        startedOn: new Date("2026-09-01"),
      },
    });
    const before = await request(server())
      .get(`/v1/children/${a.child.id}`)
      .set("Cookie", teacherA.cookies);
    expect(before.status).toBe(200); // the stale row still grants the reach

    await runMigration();

    const old = await db.enrollment.findUniqueOrThrow({ where: { id: a.enrollment.id } });
    expect(old.status).toBe("TRANSFERRED");
    expect(old.endedOn?.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: current.id } })).status).toBe(
      "ACTIVE",
    );

    const after = await request(server())
      .get(`/v1/children/${a.child.id}`)
      .set("Cookie", teacherA.cookies);
    expect(after.status).toBe(404);
  });

  it("leaves a child with one ACTIVE enrolment, and another kindergarten, alone", async () => {
    await runMigration();
    for (const id of [a.enrollment.id, b.enrollment.id]) {
      expect((await db.enrollment.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");
    }
  });
});
