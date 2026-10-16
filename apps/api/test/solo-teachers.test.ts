import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  authed,
  createChild,
  createGroup,
  createMembership,
  createScenario,
  createSchoolYear,
  createUser,
  enrollChild,
  login,
  type AuthSession,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { currentSchoolYear } from "./support/school-year";

/**
 * A teacher signing up alone (#195; the user, 2026-10-11).
 *
 * What is pinned: the sign-up builds the whole workspace at once, password
 * and all — one window (2026-10-14); a phone or email already in use is a 409;
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
  lastName: "Дорж",
  firstName: "Сараа",
  password: PASSWORD,
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

/** Signs up and signs in by phone with the password the form set. */
async function soloTeacher() {
  const res = await signup();
  expect(res.status, JSON.stringify(res.body)).toBe(201);

  const session = await login(app, FORM.phone, PASSWORD);
  const kindergarten = await db.kindergarten.findFirstOrThrow({ where: { kind: "SOLO_TEACHER" } });
  return { session, kindergartenId: kindergarten.id };
}

describe("signing up", () => {
  it("builds the workspace and the teacher's membership — the year and the group are theirs to make", async () => {
    const res = await signup();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ created: true });

    const kindergarten = await db.kindergarten.findFirstOrThrow({
      where: { kind: "SOLO_TEACHER" },
      include: { groups: true, schoolYears: true, memberships: true },
    });
    expect(kindergarten).toMatchObject({
      name: "Д.Сараа",
      soloWorkplaceName: "115-р цэцэрлэг",
      esisInstitutionId: null,
    });
    expect(kindergarten.groups).toEqual([]);
    expect(kindergarten.schoolYears).toEqual([]);
    expect(kindergarten.memberships.map((m) => m.role)).toEqual(["TEACHER"]);
  });

  it("keeps the surname and the given name apart, and issues no invitation", async () => {
    await signup().expect(201);
    const user = await db.user.findFirstOrThrow({ where: { phone: FORM.phone } });
    expect(user).toMatchObject({ lastName: "Дорж", firstName: "Сараа" });
    expect(user.selfRegisteredAt).not.toBeNull();
    expect(await db.authToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it("refuses a weak password and a missing surname", async () => {
    expect((await signup({ ...FORM, password: "aaaaaaaa" })).status).toBe(400);
    expect((await signup({ ...FORM, lastName: " " })).status).toBe(400);
    expect(await db.kindergarten.count({ where: { kind: "SOLO_TEACHER" } })).toBe(0);
  });

  it("the teacher signs in by phone at once, and the session names the workspace", async () => {
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

const post = (session: AuthSession, url: string, body: Record<string, unknown>) =>
  authed(request(server()).post(url), session).send(body);

/** The teacher's own year and group, made the way the screen makes them. */
async function setUp(session: AuthSession, kindergartenId: string) {
  const year = currentSchoolYear(new Date());
  const created = await post(session, `/v1/kindergartens/${kindergartenId}/school-years`, {
    name: year.name,
    startsOn: year.startsOn.toISOString().slice(0, 10),
    endsOn: year.endsOn.toISOString().slice(0, 10),
    isCurrent: true,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const group = await post(session, `/v1/kindergartens/${kindergartenId}/groups`, {
    schoolYearId: created.body.id,
    name: "Нарлаг",
    ageBand: "SENIOR",
  });
  expect(group.status, JSON.stringify(group.body)).toBe(201);
  return { yearId: created.body.id as string, groupId: group.body.id as string };
}

describe("the solo teacher", () => {
  it("sets up their own school year and group, and teaches the group at once", async () => {
    const { session, kindergartenId } = await soloTeacher();
    const { yearId, groupId } = await setUp(session, kindergartenId);

    const groups = await authed(
      request(server()).get(`/v1/groups?kindergartenId=${kindergartenId}`),
      session,
    );
    expect(groups.body.items.map((g: { id: string }) => g.id)).toEqual([groupId]);

    const renamed = await authed(request(server()).patch(`/v1/groups/${groupId}`), session).send({
      name: "Нарлаг бүлэг",
      ageBand: "MIDDLE",
    });
    expect(renamed.status).toBe(200);
    const year = await authed(request(server()).patch(`/v1/school-years/${yearId}`), session).send({
      name: "Миний жил",
    });
    expect(year.status).toBe(200);

    // One group a school year.
    const second = await post(session, `/v1/kindergartens/${kindergartenId}/groups`, {
      schoolYearId: yearId,
      name: "Хоёр дахь",
      ageBand: "SENIOR",
    });
    expect(second.status).toBe(400);
  });

  it("registers a child into their group and invites the family", async () => {
    const { session, kindergartenId } = await soloTeacher();
    const child = {
      lastName: "Бат",
      firstName: "Тэмүүлэн",
      sex: "MALE",
      dateOfBirth: "2021-03-04",
    };

    // No group yet: told what to do first, not left with a child they cannot see.
    const early = await post(session, `/v1/kindergartens/${kindergartenId}/children`, child);
    expect(early.status).toBe(400);

    const { groupId } = await setUp(session, kindergartenId);
    const created = await post(session, `/v1/kindergartens/${kindergartenId}/children`, child);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const enrollment = await db.enrollment.findFirstOrThrow({
      where: { childId: created.body.id as string },
    });
    expect(enrollment).toMatchObject({ groupId, status: "ACTIVE" });

    const roster = await authed(request(server()).get("/v1/children"), session);
    expect(roster.body.items.map((c: { id: string }) => c.id)).toEqual([created.body.id]);

    const invitation = await post(
      session,
      `/v1/children/${created.body.id as string}/guardian-invitations`,
      { isPrimary: true },
    );
    expect(invitation.status, JSON.stringify(invitation.body)).toBe(201);
  });

  it("is a teacher, not the director: no staff, no teacher assignments, nobody else's kindergarten", async () => {
    const { session, kindergartenId } = await soloTeacher();
    const { groupId } = await setUp(session, kindergartenId);

    const me = await authed(request(server()).get("/v1/auth/me"), session);
    expect(me.body.memberships.map((m: { role: string }) => m.role)).toEqual(["TEACHER"]);

    const staff = await post(session, `/v1/kindergartens/${kindergartenId}/users`, {
      username: "invited-parent",
      lastName: "Бат",
      firstName: "Сүх",
      role: "PARENT",
    });
    expect(staff.status).toBe(404);
    const teacher = await db.membership.findFirstOrThrow({ where: { kindergartenId } });
    const assign = await post(session, `/v1/groups/${groupId}/teachers`, {
      membershipId: teacher.id,
    });
    expect(assign.status).toBe(404);

    // A contracted kindergarten's teacher sets up nothing.
    const a = await createScenario("a");
    const contracted = await login(app, a.teacherUser.username);
    const year = await post(contracted, `/v1/kindergartens/${a.kindergarten.id}/school-years`, {
      name: "2030-2031",
      startsOn: "2030-09-01",
      endsOn: "2031-05-31",
    });
    expect(year.status).toBe(404);
    const group = await post(contracted, `/v1/kindergartens/${a.kindergarten.id}/groups`, {
      schoolYearId: a.schoolYear.id,
      name: "Шинэ",
      ageBand: "SENIOR",
    });
    expect(group.status).toBe(404);
    // Nor reaches the solo workspace.
    const into = await post(contracted, `/v1/kindergartens/${kindergartenId}/school-years`, {
      name: "2030-2031",
      startsOn: "2030-09-01",
      endsOn: "2031-05-31",
    });
    expect(into.status).toBe(404);
  });
});

/** The migration's statements, one at a time — the driver takes one per call. */
function runMigration() {
  const sql = readFileSync(
    join(__dirname, "../prisma/migrations/20261014090000_solo_teacher_role_only/migration.sql"),
    "utf8",
  );
  const statements = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return db.$transaction(statements.map((s) => db.$executeRawUnsafe(s)));
}

describe("the migration, for those who signed up as director too", () => {
  /** A workspace as sign-up built it before 2026-10-14. */
  async function oldWorkspace() {
    const { kindergartenId } = await soloTeacher();
    const teacher = await db.membership.findFirstOrThrow({
      where: { kindergartenId, role: "TEACHER" },
    });
    const admin = await createMembership(teacher.userId, kindergartenId, "ADMIN");
    const year = await createSchoolYear(kindergartenId, true);
    const group = await createGroup(kindergartenId, year.id, "Миний бүлэг");
    await db.groupTeacher.create({
      data: { kindergartenId, groupId: group.id, membershipId: teacher.id },
    });
    return { kindergartenId, teacher, admin, year, group };
  }

  it("keeps everything they made within a teacher's reach, then takes the director's role", async () => {
    const { kindergartenId, teacher, admin, group } = await oldWorkspace();
    // What an ADMIN could do that a TEACHER reaches only through a group:
    // a child registered without one, a child no longer attending, and a
    // group of last year nobody assigned them to.
    const loose = await createChild(kindergartenId, { firstName: "Номин" });
    const gone = await createChild(kindergartenId, { firstName: "Анар" });
    await db.child.update({ where: { id: gone.id }, data: { status: "INACTIVE" } });
    const lastYear = await createSchoolYear(kindergartenId, false);
    const oldGroup = await createGroup(kindergartenId, lastYear.id, "Өнгөрсөн");
    const placed = await createChild(kindergartenId, { firstName: "Тэмүүлэн" });
    await enrollChild(kindergartenId, placed.id, oldGroup.id, lastYear.id);
    // A one-word name, written twice by the old sign-up.
    await db.user.update({
      where: { id: teacher.userId },
      data: { lastName: "Сараа", firstName: "Сараа" },
    });
    // Not theirs to touch: a contracted director, and a solo ADMIN with no
    // teacher's role there (revoking it would lock them out).
    const a = await createScenario("a");
    await signup({ ...FORM, phone: "88112233", email: "other@example.mn" }).expect(201);
    const lone = await db.membership.findFirstOrThrow({
      where: { kindergartenId: { not: kindergartenId }, role: "TEACHER" },
    });
    await db.membership.update({ where: { id: lone.id }, data: { role: "ADMIN" } });
    const directors = () =>
      db.membership.count({
        where: { kindergartenId: a.kindergarten.id, role: "ADMIN", deletedAt: null },
      });
    const directorsBefore = await directors();

    await runMigration();

    expect(await db.membership.findUniqueOrThrow({ where: { id: admin.id } })).toMatchObject({
      isActive: false,
      deletedAt: expect.any(Date),
    });
    expect(await db.membership.findUniqueOrThrow({ where: { id: teacher.id } })).toMatchObject({
      isActive: true,
      deletedAt: null,
    });
    expect(
      await db.groupTeacher.count({ where: { membershipId: teacher.id, endedOn: null } }),
    ).toBe(2);
    expect(await db.enrollment.findFirstOrThrow({ where: { childId: loose.id } })).toMatchObject({
      groupId: group.id,
      status: "ACTIVE",
    });
    expect(await db.enrollment.findFirstOrThrow({ where: { childId: gone.id } })).toMatchObject({
      groupId: group.id,
      status: "ENDED",
    });
    expect(await db.enrollment.count({ where: { childId: placed.id } })).toBe(1);
    expect(await db.user.findUniqueOrThrow({ where: { id: teacher.userId } })).toMatchObject({
      lastName: "",
      firstName: "Сараа",
    });
    expect(await db.membership.findUniqueOrThrow({ where: { id: lone.id } })).toMatchObject({
      isActive: true,
      deletedAt: null,
    });
    expect(await directors()).toBe(directorsBefore);
    expect(
      await db.auditLog.findFirstOrThrow({
        where: { objectType: "Membership", objectId: admin.id },
      }),
    ).toMatchObject({ action: "PERMISSION_CHANGE", kindergartenId });

    // Signed in as the teacher they now are: every child who attends is there.
    // ★ Not the one who no longer does — a teacher reaches a child through an
    // ACTIVE enrollment, and a solo workspace is no exception (the user,
    // 2026-10-16, D2 reversed). Their own notes about them stay readable.
    const session = await login(app, FORM.phone, PASSWORD);
    const me = await authed(request(server()).get("/v1/auth/me"), session);
    expect(me.body.memberships.map((m: { role: string }) => m.role)).toEqual(["TEACHER"]);
    const roster = await authed(request(server()).get("/v1/children?pageSize=100"), session);
    expect(roster.body.items.map((c: { id: string }) => c.id).sort()).toEqual(
      [loose.id, placed.id].sort(),
    );
  });

  it("runs twice without doing anything twice", async () => {
    const { kindergartenId } = await oldWorkspace();
    await createChild(kindergartenId, { firstName: "Номин" });
    await runMigration();
    const counts = async () => ({
      assignments: await db.groupTeacher.count({ where: { kindergartenId } }),
      enrollments: await db.enrollment.count({ where: { kindergartenId } }),
      audit: await db.auditLog.count({ where: { kindergartenId } }),
    });
    const once = await counts();
    await runMigration();
    expect(await counts()).toEqual(once);
  });
});

describe("the workspace's rules", () => {
  const invite = (session: AuthSession, kindergartenId: string, role: string, n = 1) =>
    post(session, `/v1/kindergartens/${kindergartenId}/users`, {
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

  it("keeps one group a school year", async () => {
    const { session, kindergartenId } = await soloAdministrator();
    const year = await createSchoolYear(kindergartenId, true);
    await createGroup(kindergartenId, year.id);
    const next = await createSchoolYear(kindergartenId, false);

    const body = { name: "Хоёр дахь", ageBand: "SENIOR" };
    const same = await post(session, `/v1/kindergartens/${kindergartenId}/groups`, {
      ...body,
      schoolYearId: year.id,
    });
    expect(same.status).toBe(400);
    const nextYear = await post(session, `/v1/kindergartens/${kindergartenId}/groups`, {
      ...body,
      schoolYearId: next.id,
    });
    expect(nextYear.status, JSON.stringify(nextYear.body)).toBe(201);
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

/**
 * Follow-ups from the ultra review of #226 (the user's decisions, 2026-10-16).
 */
describe("the solo teacher runs their own workspace", () => {
  const child = { lastName: "Бат", firstName: "Тэмүүлэн", sex: "MALE", dateOfBirth: "2021-03-04" };

  it("revokes a guardian, links an account, ends an enrolment — and a contracted teacher cannot", async () => {
    const { session, kindergartenId } = await soloTeacher();
    await setUp(session, kindergartenId);
    const created = await post(session, `/v1/kindergartens/${kindergartenId}/children`, child);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const childId = created.body.id as string;

    // An account already in NomadKids, linked by the teacher.
    const parent = await createUser({ username: uniq("parent") });
    await createMembership(parent.id, kindergartenId, "PARENT");
    const linked = await post(session, `/v1/children/${childId}/guardians`, {
      guardianUserId: parent.id,
      relation: "MOTHER",
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(201);

    // The wrong person after all: the teacher takes the access back.
    const guardianship = await db.guardianship.findFirstOrThrow({
      where: { childId, guardianUserId: parent.id },
    });
    const revoked = await authed(
      request(server()).patch(`/v1/guardianships/${guardianship.id}`),
      session,
    ).send({ canView: false });
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);

    const enrollment = await db.enrollment.findFirstOrThrow({ where: { childId } });
    const ended = await authed(
      request(server()).patch(`/v1/enrollments/${enrollment.id}`),
      session,
    ).send({ status: "ENDED" });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);

    // A contracted kindergarten's teacher still gets 404 on their own child.
    const a = await createScenario("a");
    const teacherA = await login(app, a.teacherUser.username);
    const theirs = await authed(
      request(server()).patch(`/v1/guardianships/${a.guardianship.id}`),
      teacherA,
    ).send({ canView: false });
    expect(theirs.status).toBe(404);
  });

  it("holds two open school years, no more", async () => {
    const { session, kindergartenId } = await soloTeacher();
    await setUp(session, kindergartenId);
    const year = (start: number) =>
      post(session, `/v1/kindergartens/${kindergartenId}/school-years`, {
        name: `${start}-${start + 1}`,
        startsOn: `${start}-09-01`,
        endsOn: `${start + 1}-06-01`,
      });
    const next = new Date().getUTCFullYear() + 1;
    expect((await year(next)).status).toBe(201);
    const third = await year(next + 1);
    expect(third.status).toBe(400);
  });

  it("archives the old group once every child has moved up", async () => {
    const { session, kindergartenId } = await soloTeacher();
    const { groupId } = await setUp(session, kindergartenId);
    expect(
      (await post(session, `/v1/kindergartens/${kindergartenId}/children`, child)).status,
    ).toBe(201);

    const next = new Date().getUTCFullYear() + 1;
    const year = await post(session, `/v1/kindergartens/${kindergartenId}/school-years`, {
      name: `${next}-${next + 1}`,
      startsOn: `${next}-09-01`,
      endsOn: `${next + 1}-06-01`,
    });
    expect(year.status, JSON.stringify(year.body)).toBe(201);
    const newGroup = await post(session, `/v1/kindergartens/${kindergartenId}/groups`, {
      schoolYearId: year.body.id,
      name: "Нарлаг 2",
      ageBand: "SENIOR",
    });
    expect(newGroup.status, JSON.stringify(newGroup.body)).toBe(201);

    const moved = await post(session, `/v1/groups/${groupId}/promotions`, {
      toGroupId: newGroup.body.id,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(201);
    expect(moved.body.archivedFrom).toBe(true);
    expect((await db.group.findUniqueOrThrow({ where: { id: groupId } })).deletedAt).not.toBeNull();
  });

  it("signs up with a mobile number only", async () => {
    expect((await signup({ ...FORM, phone: "11223344" })).status).toBe(400);
  });
});
