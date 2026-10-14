import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  authed,
  createMembership,
  createScenario,
  login,
  type AuthSession,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { currentSchoolYear } from "../src/solo-teachers/solo-teachers.service";

/**
 * A teacher signing up alone (#195; the user, 2026-10-11).
 *
 * What is pinned: the sign-up builds the whole workspace at once and the
 * invitation sets the password; a phone or email already in use is a 409;
 * the teacher is the group's **teacher only**, never the director (the user,
 * 2026-10-14) — and the migration took the director's role from those who
 * signed up before; a workspace that still has an administrator takes
 * **parents only** and **one group**; a contracted kindergarten is untouched
 * by either rule; the session names the workspace.
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
  it("builds the whole workspace at once: the teacher is its group's teacher and nothing more", async () => {
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
    expect(kindergarten.memberships.map((m) => m.role).sort()).toEqual(["TEACHER"]);

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
    // The same address in another casing — how one teacher got two accounts.
    expect((await signup({ ...FORM, phone: "88112233", email: "Saraa@Example.MN" })).status).toBe(
      409,
    );
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

describe("the solo teacher's role", () => {
  it("is a teacher's: their group, its children and families — not the director's routes", async () => {
    const { session, kindergartenId } = await soloTeacher();
    const group = await db.group.findFirstOrThrow({ where: { kindergartenId } });
    const year = await db.schoolYear.findFirstOrThrow({ where: { kindergartenId } });

    const me = await authed(request(server()).get("/v1/auth/me"), session);
    expect(me.body.memberships.map((m: { role: string }) => m.role)).toEqual(["TEACHER"]);

    const child = await authed(
      request(server()).post(`/v1/kindergartens/${kindergartenId}/children`),
      session,
    ).send({
      lastName: "Бат",
      firstName: "Тэмүүлэн",
      sex: "MALE",
      dateOfBirth: "2021-03-04",
      groupId: group.id,
    });
    expect(child.status, JSON.stringify(child.body)).toBe(201);
    const invitation = await authed(
      request(server()).post(`/v1/children/${child.body.id}/guardian-invitations`),
      session,
    ).send({ isPrimary: true });
    expect(invitation.status, JSON.stringify(invitation.body)).toBe(201);

    // The director's routes: staff and groups.
    const staff = await authed(
      request(server()).post(`/v1/kindergartens/${kindergartenId}/users`),
      session,
    ).send({ username: "invited-parent", lastName: "Бат", firstName: "Сүх", role: "PARENT" });
    expect(staff.status).toBe(404);
    const newGroup = await authed(
      request(server()).post(`/v1/kindergartens/${kindergartenId}/groups`),
      session,
    ).send({ schoolYearId: year.id, name: "Хоёр дахь", ageBand: "SENIOR" });
    expect(newGroup.status).toBe(404);
    expect(await db.group.count({ where: { kindergartenId } })).toBe(1);
  });

  it("is taken back from those who signed up as director too, keeping their group", async () => {
    const { kindergartenId } = await soloTeacher();
    const teacher = await db.membership.findFirstOrThrow({
      where: { kindergartenId, role: "TEACHER" },
    });
    // Before 2026-10-14 sign-up made them ADMIN as well.
    const oldAdmin = await createMembership(teacher.userId, kindergartenId, "ADMIN");
    // A solo workspace's ADMIN with no teacher's role there is left alone —
    // revoking it would lock them out.
    const other = await signup({ ...FORM, phone: "88112233", email: "other@example.mn" });
    expect(other.status).toBe(201);
    const lone = await db.membership.findFirstOrThrow({
      where: { kindergartenId: { not: kindergartenId }, role: "TEACHER" },
    });
    await db.membership.update({ where: { id: lone.id }, data: { role: "ADMIN" } });
    // A contracted kindergarten's director is never touched.
    const a = await createScenario("a");

    await db.$executeRawUnsafe(
      readFileSync(
        join(__dirname, "../prisma/migrations/20261014090000_solo_teacher_role_only/migration.sql"),
        "utf8",
      ),
    );

    expect(await db.membership.findUniqueOrThrow({ where: { id: oldAdmin.id } })).toMatchObject({
      isActive: false,
      deletedAt: expect.any(Date),
    });
    expect(await db.membership.findUniqueOrThrow({ where: { id: teacher.id } })).toMatchObject({
      isActive: true,
      deletedAt: null,
    });
    expect(await db.groupTeacher.count({ where: { membershipId: teacher.id } })).toBe(1);
    expect(await db.membership.findUniqueOrThrow({ where: { id: lone.id } })).toMatchObject({
      isActive: true,
      deletedAt: null,
    });
    expect(
      await db.membership.count({
        where: { kindergartenId: a.kindergarten.id, role: "ADMIN", deletedAt: null },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.findFirstOrThrow({
        where: { objectType: "Membership", objectId: oldAdmin.id },
      }),
    ).toMatchObject({ action: "PERMISSION_CHANGE", kindergartenId });

    const session = await login(app, FORM.phone, PASSWORD);
    const me = await authed(request(server()).get("/v1/auth/me"), session);
    expect(me.body.memberships.map((m: { role: string }) => m.role)).toEqual(["TEACHER"]);
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

  /**
   * A solo workspace that still has an administrator — an ADMIN row from
   * before 2026-10-14 — keeps both rules.
   */
  async function soloAdministrator() {
    const { kindergartenId } = await soloTeacher();
    const teacher = await db.membership.findFirstOrThrow({
      where: { kindergartenId, role: "TEACHER" },
    });
    await createMembership(teacher.userId, kindergartenId, "ADMIN");
    return { session: await login(app, FORM.phone, PASSWORD), kindergartenId };
  }

  it("takes parents only — no teacher, cook or accountant", async () => {
    const { session, kindergartenId } = await soloAdministrator();

    for (const role of ["TEACHER", "COOK", "ACCOUNTANT", "ADMIN"]) {
      const res = await invite(session, kindergartenId, role);
      expect(res.status, role).toBe(400);
    }
    expect((await invite(session, kindergartenId, "PARENT")).status).toBe(201);
  });

  it("keeps one group", async () => {
    const { session, kindergartenId } = await soloAdministrator();
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

/**
 * A teacher whose kindergarten has signed is refused a workspace of their own
 * beside it (#211 item 3) — equal names in the same district only.
 */
describe("a solo sign-up for a contracted kindergarten", () => {
  async function contracted(name: string, district: string) {
    const scenario = await createScenario("c");
    await db.kindergarten.update({
      where: { id: scenario.kindergarten.id },
      data: { name, district },
    });
  }

  it("is refused when the district's contracted kindergarten has the same name", async () => {
    await contracted("115-р Цэцэрлэг", "Баянзүрх");

    const res = await signup();

    expect(res.status).toBe(409);
    expect(res.body.detail ?? res.body.message).toContain("115-р Цэцэрлэг");
    expect(await db.kindergarten.count({ where: { kind: "SOLO_TEACHER" } })).toBe(0);
  });

  it("goes through when the name only resembles one, or the district differs", async () => {
    await contracted("115-р цэцэрлэг", "Сүхбаатар");
    await contracted("1150-р цэцэрлэг", "Баянзүрх");

    const res = await signup();

    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});
