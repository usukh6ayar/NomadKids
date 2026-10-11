import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { currentSchoolYear } from "../src/solo-teachers/solo-teachers.service";

/**
 * A teacher signing up alone (#195; the user, 2026-10-11).
 *
 * What is pinned: the sign-up builds the whole workspace at once and the
 * invitation sets the password; a phone or email already in use is a 409;
 * the workspace takes **parents only** and **one group**; a contracted
 * kindergarten is untouched by either rule; the session names the workspace.
 */

let app: INestApplication;
const db = testDb();
const server = () => app.getHttpServer();
const PASSWORD = "Shine-Nuuts99";

const FORM = {
  fullName: "Дорж Сараа",
  phone: "99112233",
  email: "saraa@example.mn",
  propertyType: "Төрийн",
  location: "Баянзүрх дүүрэг",
  kindergartenName: "115-р цэцэрлэг",
};

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
});

const signup = (body: Record<string, unknown> = FORM) =>
  request(server()).post("/v1/teacher-applications").send(body);

/** Signs up, sets the password through the invitation, and signs in by phone. */
async function soloTeacher() {
  const res = await signup();
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const accept = await request(server())
    .post("/v1/auth/invitation/accept")
    .send({ token: res.body.invitationToken, password: PASSWORD });
  expect(accept.status, JSON.stringify(accept.body)).toBe(204);

  const session = await login(app, FORM.phone, PASSWORD);
  const kindergarten = await db.kindergarten.findFirstOrThrow({ where: { kind: "SOLO_TEACHER" } });
  return { session, kindergartenId: kindergarten.id };
}

describe("signing up", () => {
  it("builds the whole workspace at once: the teacher is its director and its group's teacher", async () => {
    const res = await signup();
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(["invitationToken"]);

    const kindergarten = await db.kindergarten.findFirstOrThrow({
      where: { kind: "SOLO_TEACHER" },
      include: { groups: true, schoolYears: true, memberships: true },
    });
    expect(kindergarten).toMatchObject({
      name: "Д.Сараа — бие даасан багш",
      soloWorkplaceName: "115-р цэцэрлэг",
      esisInstitutionId: null,
    });
    expect(kindergarten.groups).toHaveLength(1);
    expect(kindergarten.schoolYears).toEqual([
      expect.objectContaining({ isCurrent: true, name: currentSchoolYear(new Date()).name }),
    ]);
    expect(kindergarten.memberships.map((m) => m.role).sort()).toEqual(["ADMIN", "TEACHER"]);

    const teacher = kindergarten.memberships.find((m) => m.role === "TEACHER")!;
    const assignment = await db.groupTeacher.findFirstOrThrow({
      where: { membershipId: teacher.id },
    });
    expect(assignment.groupId).toBe(kindergarten.groups[0]!.id);
  });

  it("the invitation sets the password; the teacher signs in by phone, and the session names the workspace", async () => {
    const { session, kindergartenId } = await soloTeacher();
    const me = await authed(request(server()).get("/v1/auth/me"), session);
    expect(me.status).toBe(200);
    expect(me.body.soloKindergartenIds).toEqual([kindergartenId]);
  });

  it("refuses a phone or an email already in use", async () => {
    expect((await signup()).status).toBe(201);
    expect((await signup({ ...FORM, email: "other@example.mn" })).status).toBe(409);
    expect((await signup({ ...FORM, phone: "88112233" })).status).toBe(409);
    expect(await db.kindergarten.count({ where: { kind: "SOLO_TEACHER" } })).toBe(1);
  });

  it("refuses a malformed phone and unknown fields", async () => {
    expect((await signup({ ...FORM, phone: "9911" })).status).toBe(400);
    expect((await signup({ ...FORM, isSuperAdmin: true })).status).toBe(400);
  });

  it("five an hour from one address", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await signup({ ...FORM, phone: `9911223${i}`, email: `t${i}@example.mn` });
      expect(res.status).toBe(201);
    }
    expect((await signup({ ...FORM, phone: "99112239", email: "t9@example.mn" })).status).toBe(429);
  });
});

describe("the workspace's rules", () => {
  const invite = (session: AuthSession, kindergartenId: string, role: string, n = 1) =>
    authed(request(server()).post(`/v1/kindergartens/${kindergartenId}/users`), session).send({
      username: `invited-${role.toLowerCase()}-${n}`,
      lastName: "Бат",
      firstName: "Сүх",
      role,
    });

  it("takes parents only — no teacher, cook or accountant", async () => {
    const { session, kindergartenId } = await soloTeacher();

    for (const role of ["TEACHER", "COOK", "ACCOUNTANT", "ADMIN"]) {
      const res = await invite(session, kindergartenId, role);
      expect(res.status, role).toBe(400);
    }
    expect((await invite(session, kindergartenId, "PARENT")).status).toBe(201);
  });

  it("keeps one group", async () => {
    const { session, kindergartenId } = await soloTeacher();
    const year = await db.schoolYear.findFirstOrThrow({ where: { kindergartenId } });

    const res = await authed(
      request(server()).post(`/v1/kindergartens/${kindergartenId}/groups`),
      session,
    ).send({ schoolYearId: year.id, name: "Хоёр дахь", ageBand: "SENIOR" });
    expect(res.status).toBe(400);
    expect(await db.group.count({ where: { kindergartenId } })).toBe(1);
  });

  it("leaves a contracted kindergarten as it was", async () => {
    const a = await createScenario("a");
    const admin = await login(app, a.adminUser.username);

    expect((await invite(admin, a.kindergarten.id, "TEACHER")).status).toBe(201);
    const group = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/groups`),
      admin,
    ).send({ schoolYearId: a.schoolYear.id, name: "Хоёр дахь", ageBand: "SENIOR" });
    expect(group.status).toBe(201);

    const me = await authed(request(server()).get("/v1/auth/me"), admin);
    expect(me.body.soloKindergartenIds).toEqual([]);
  });
});

describe("currentSchoolYear", () => {
  it("runs September to May, and from June prepares the coming year", () => {
    expect(currentSchoolYear(new Date("2026-10-11T00:00:00Z")).name).toBe("2026-2027");
    expect(currentSchoolYear(new Date("2027-03-01T00:00:00Z")).name).toBe("2026-2027");
    expect(currentSchoolYear(new Date("2027-07-01T00:00:00Z")).name).toBe("2027-2028");
  });
});
