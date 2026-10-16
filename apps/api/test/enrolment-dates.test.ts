import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  authed,
  createGroup,
  createScenario,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";

/**
 * Follow-ups from the reviews of #235, #239 and #240 (2026-10-16): a move
 * dated in the past, a request dated before the child's current group, and a
 * family note for a child no group holds. The scenario's child is enrolled
 * from 2025-09-01.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let parentA: AuthSession;
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
  parentA = await login(app, a.parentUser.username);
  newGroupId = (await createGroup(a.kindergarten.id, a.schoolYear.id, "Шинэ бүлэг")).id;
});

const server = () => app.getHttpServer();

const move = (startedOn?: string) =>
  authed(request(server()).post(`/v1/children/${a.child.id}/enrollments`), adminA).send({
    groupId: newGroupId,
    ...(startedOn ? { startedOn } : {}),
  });

const sheet = async (groupId: string, date: string) => {
  const res = await authed(
    request(server()).get(`/v1/groups/${groupId}/attendance?date=${date}`),
    adminA,
  );
  expect(res.status).toBe(200);
  return res.body.map((row: { child: { id: string } }) => row.child.id);
};

const day = (value: Date | null | undefined) => value?.toISOString().slice(0, 10);

describe("a move dated in the past (№4)", () => {
  it("ends the old group on the day the new one starts", async () => {
    expect((await move("2026-10-01")).status).toBe(201);

    const old = await db.enrollment.findFirstOrThrow({
      where: { childId: a.child.id, groupId: a.group.id },
    });
    expect(old.status).toBe("TRANSFERRED");
    expect(day(old.endedOn)).toBe("2026-10-01");
  });

  it("puts the child on one register for the days in between, not two", async () => {
    await move("2026-10-01");

    expect(await sheet(newGroupId, "2026-10-05")).toContain(a.child.id);
    expect(await sheet(a.group.id, "2026-10-05")).not.toContain(a.child.id);
    expect(await sheet(a.group.id, "2026-09-30")).toContain(a.child.id);
  });

  it("refuses a start before the current group's own, and changes nothing", async () => {
    const res = await move("2025-08-01");
    expect(res.status).toBe(400);

    const rows = await db.enrollment.findMany({ where: { childId: a.child.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("ACTIVE");
    expect(rows[0]!.endedOn).toBeNull();
  });

  it("still allows a correction on the day the child joined", async () => {
    expect((await move("2025-09-01")).status).toBe(201);
    expect(await sheet(newGroupId, "2025-09-01")).toContain(a.child.id);
    expect(await sheet(a.group.id, "2025-09-01")).not.toContain(a.child.id);
  });

  it("an administrator of another kindergarten gets 404", async () => {
    const adminB = await login(app, b.adminUser.username);
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/enrollments`),
      adminB,
    ).send({ groupId: newGroupId, startedOn: "2026-10-01" });
    expect(res.status).toBe(404);
  });
});

describe("an attendance request dated before the current group (№5)", () => {
  const ask = (dateFrom: string, dateTo: string) =>
    authed(request(server()).post(`/v1/children/${a.child.id}/attendance-requests`), parentA)
      .field("dateFrom", dateFrom)
      .field("dateTo", dateTo)
      .field("requestedStatus", "SICK");

  it("is refused when it starts before the child joined the group", async () => {
    await move("2026-10-01");

    const res = await ask("2026-09-29", "2026-10-02");
    expect(res.status).toBe(400);
    expect(await db.attendanceRequest.count({ where: { childId: a.child.id } })).toBe(0);
  });

  it("is accepted from the day the child joined", async () => {
    await move("2026-10-01");

    const res = await ask("2026-10-01", "2026-10-02");
    expect(res.status).toBe(201);
    const row = await db.attendanceRequest.findFirstOrThrow({ where: { childId: a.child.id } });
    const live = await db.enrollment.findFirstOrThrow({
      where: { childId: a.child.id, status: "ACTIVE" },
    });
    expect(row.enrollmentId).toBe(live.id);
  });

  it("guardian of another child gets 404", async () => {
    const parentB = await login(app, b.parentUser.username);
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentB,
    )
      .field("dateFrom", "2026-10-01")
      .field("dateTo", "2026-10-02")
      .field("requestedStatus", "SICK");
    expect(res.status).toBe(404);
  });
});

describe("a family note for a child no group holds (№6)", () => {
  const note = (session: AuthSession, childId = a.child.id) =>
    authed(request(server()).post(`/v1/children/${childId}/parent-observations`), session).send({
      observedOn: "2026-10-10",
      situation: "Гэртээ зураг зурав",
    });

  it("is refused once the enrolment has ended", async () => {
    const live = await db.enrollment.findFirstOrThrow({ where: { childId: a.child.id } });
    const ended = await authed(request(server()).patch(`/v1/enrollments/${live.id}`), adminA).send({
      status: "GRADUATED",
    });
    expect(ended.status).toBe(200);

    const res = await note(parentA);
    expect(res.status).toBe(400);
    expect(await db.observation.count({ where: { childId: a.child.id, source: "PARENT" } })).toBe(
      0,
    );
  });

  it("is accepted while the child is in a group", async () => {
    expect((await note(parentA)).status).toBe(201);
  });

  it("guardian of another child gets 404", async () => {
    const parentB = await login(app, b.parentUser.username);
    expect((await note(parentB)).status).toBe(404);
  });
});
