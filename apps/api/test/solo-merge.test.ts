import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createChild,
  createGroup,
  createMembership,
  createScenario,
  createUser,
  enrollChild,
  linkGuardian,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { SoloMergeRepository } from "../src/solo-teachers/solo-merge.repository";
import { classify } from "../src/solo-teachers/solo-merge-plan";

/**
 * D3 — the operator merges a solo teacher's workspace into the contracted
 * kindergarten they work at (the user, 2026-10-11).
 *
 * What is pinned: every table pointing at a kindergarten is classified; the
 * preview is the merge rolled back; after a merge the child, the family, the
 * group and the fee live in the target, the teacher is its TEACHER with no
 * ADMIN left, and nothing is deleted; a name taken there is renamed; a
 * membership the target already has is joined, not duplicated; the same child
 * already on the target's roll, or configuration a director owns, stops the
 * merge with nothing changed; only the operator may do any of it.
 */

let app: INestApplication;
const db = testDb();
const server = () => app.getHttpServer();
const PASSWORD = "Shine-Nuuts99";
const TEACHER_PHONE = "99112233";

let operator: AuthSession;
let target: Scenario;
let solo: {
  kindergartenId: string;
  groupId: string;
  yearId: string;
  childId: string;
  teacherUserId: string;
  parentUsername: string;
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

  const signup = await request(server()).post("/v1/teacher-applications").send({
    fullName: "Дорж Сараа",
    phone: TEACHER_PHONE,
    email: "saraa@example.mn",
    kindergartenName: "Нарлаг цэцэрлэг",
  });
  expect(signup.status).toBe(201);
  await request(server())
    .post("/v1/auth/invitation/accept")
    .send({ token: signup.body.invitationToken, password: PASSWORD })
    .expect(204);

  const kg = await db.kindergarten.findFirstOrThrow({
    where: { kind: "SOLO_TEACHER" },
    include: { groups: true, schoolYears: true, memberships: true },
  });
  const child = await createChild(kg.id, { firstName: "Тэмүүлэн", nationalId: "УБ21041299" });
  await enrollChild(kg.id, child.id, kg.groups[0]!.id, kg.schoolYears[0]!.id);
  const parent = await createUser({ username: uniq("parent-solo") });
  await createMembership(parent.id, kg.id, "PARENT");
  await linkGuardian(kg.id, child.id, parent.id);
  await db.accessSubscription.create({
    data: {
      kindergartenId: kg.id,
      childId: child.id,
      schoolYearId: kg.schoolYears[0]!.id,
      amount: "27000.00",
      status: "ACTIVE",
      paidAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  solo = {
    kindergartenId: kg.id,
    groupId: kg.groups[0]!.id,
    yearId: kg.schoolYears[0]!.id,
    childId: child.id,
    teacherUserId: kg.memberships[0]!.userId,
    parentUsername: parent.username,
  };

  target = await createScenario("t");
  // The solo group's own name is already taken in the target's year.
  await createGroup(target.kindergarten.id, target.schoolYear.id, "Миний бүлэг");

  const superUser = await createUser({ username: uniq("super"), isSuperAdmin: true });
  operator = await login(app, superUser.username);
});

const preview = (session: AuthSession, body: object) =>
  authed(
    request(server()).post(`/v1/platform/solo-workspaces/${solo.kindergartenId}/merge-preview`),
    session,
  ).send(body);
const merge = (session: AuthSession, body: object) =>
  authed(
    request(server()).post(`/v1/platform/solo-workspaces/${solo.kindergartenId}/merge`),
    session,
  ).send(body);

describe("the plan", () => {
  it("classifies every table that points at a kindergarten", async () => {
    const keys = await app.get(SoloMergeRepository).foreignKeysInto("kindergartens");
    const unclassified = keys.filter((fk) => classify(fk.table) === null).map((fk) => fk.table);
    expect(unclassified).toEqual([]);
  });
});

describe("who may", () => {
  it("is 404 for anyone but the operator", async () => {
    const admin = await login(app, target.adminUser.username);
    const teacher = await login(app, TEACHER_PHONE, PASSWORD);
    for (const session of [admin, teacher]) {
      expect(
        (await authed(request(server()).get("/v1/platform/solo-workspaces"), session)).status,
      ).toBe(404);
      expect((await merge(session, { targetKindergartenId: target.kindergarten.id })).status).toBe(
        404,
      );
    }
    expect((await db.child.findUniqueOrThrow({ where: { id: solo.childId } })).kindergartenId).toBe(
      solo.kindergartenId,
    );
  });

  it("lists the workspaces with where the teacher works", async () => {
    const res = await authed(request(server()).get("/v1/platform/solo-workspaces"), operator);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({
        id: solo.kindergartenId,
        workplace: "Нарлаг цэцэрлэг",
        childCount: 1,
      }),
    ]);
    // …and not among the kindergartens, where the merge picks its target.
    const kindergartens = await authed(
      request(server()).get("/v1/platform/kindergartens"),
      operator,
    );
    expect(kindergartens.body.items.map((k: { id: string }) => k.id)).not.toContain(
      solo.kindergartenId,
    );
  });
});

describe("the preview", () => {
  it("is the merge rolled back — its counts, and nothing changed", async () => {
    const res = await preview(operator, { targetKindergartenId: target.kindergarten.id });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.result.moved).toMatchObject({
      "children.kindergartenId": 1,
      "enrollments.kindergartenId": 1,
      "groups.kindergartenId": 1,
      "guardianships.kindergartenId": 1,
    });
    expect(res.body.result.groupsRenamed).toEqual([
      { from: "Миний бүлэг", to: "Миний бүлэг (бие даасан)" },
    ]);

    const child = await db.child.findUniqueOrThrow({ where: { id: solo.childId } });
    expect(child.kindergartenId).toBe(solo.kindergartenId);
    const kg = await db.kindergarten.findUniqueOrThrow({ where: { id: solo.kindergartenId } });
    expect(kg.mergedIntoId).toBeNull();
  });

  it("names the same child already on the target's roll, and changes nothing", async () => {
    await createChild(target.kindergarten.id, { firstName: "Тэмүүлэн", nationalId: "УБ21041299" });
    const res = await preview(operator, { targetKindergartenId: target.kindergarten.id });
    expect(res.body).toMatchObject({ ok: false, refusal: { kind: "duplicates" } });
    expect(res.body.refusal.children).toHaveLength(1);
    expect((await merge(operator, { targetKindergartenId: target.kindergarten.id })).status).toBe(
      409,
    );
  });

  it("refuses configuration a director owns", async () => {
    await db.developmentDomain.create({
      data: { kindergartenId: solo.kindergartenId, name: "Шатар", code: "chess" },
    });
    const res = await preview(operator, { targetKindergartenId: target.kindergarten.id });
    expect(res.body).toMatchObject({
      ok: false,
      refusal: { kind: "blocked", tables: { "development_domains.kindergartenId": 1 } },
    });
  });
});

describe("the merge", () => {
  it("moves the child, the family, the group and the fee; the teacher becomes the target's teacher", async () => {
    const res = await merge(operator, {
      targetKindergartenId: target.kindergarten.id,
      groupName: "Сараа багшийн бүлэг",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const targetId = target.kindergarten.id;

    const child = await db.child.findUniqueOrThrow({ where: { id: solo.childId } });
    expect(child.kindergartenId).toBe(targetId);
    const enrollment = await db.enrollment.findFirstOrThrow({ where: { childId: solo.childId } });
    expect(enrollment).toMatchObject({
      kindergartenId: targetId,
      schoolYearId: target.schoolYear.id,
    });
    const group = await db.group.findUniqueOrThrow({ where: { id: solo.groupId } });
    expect(group).toMatchObject({
      kindergartenId: targetId,
      schoolYearId: target.schoolYear.id,
      name: "Сараа багшийн бүлэг",
    });
    const fee = await db.accessSubscription.findFirstOrThrow({ where: { childId: solo.childId } });
    expect(fee).toMatchObject({ kindergartenId: targetId, schoolYearId: target.schoolYear.id });

    const teacherships = await db.membership.findMany({ where: { userId: solo.teacherUserId } });
    const live = teacherships.filter((m) => m.deletedAt === null);
    expect(live.map((m) => [m.kindergartenId, m.role])).toEqual([[targetId, "TEACHER"]]);
    const assignment = await db.groupTeacher.findFirstOrThrow({ where: { groupId: solo.groupId } });
    expect(assignment).toMatchObject({ membershipId: live[0]!.id, kindergartenId: targetId });

    // Nothing deleted: the solo row and its year stay, archived and pointing on.
    const kg = await db.kindergarten.findUniqueOrThrow({ where: { id: solo.kindergartenId } });
    expect(kg).toMatchObject({ mergedIntoId: targetId, isActive: false });
    expect(kg.deletedAt).not.toBeNull();
    expect(await db.schoolYear.findUnique({ where: { id: solo.yearId } })).not.toBeNull();
    expect(
      await db.auditLog.count({ where: { objectType: "SoloWorkspaceMerge", objectId: kg.id } }),
    ).toBe(2);
  });

  it("everyone carries on: the family, the teacher and the target's director all reach the child", async () => {
    await merge(operator, { targetKindergartenId: target.kindergarten.id }).expect(200);

    const parent = await login(app, solo.parentUsername);
    expect(
      (await authed(request(server()).get(`/v1/children/${solo.childId}`), parent)).status,
    ).toBe(200);

    const teacher = await login(app, TEACHER_PHONE, PASSWORD);
    expect(
      (await authed(request(server()).get(`/v1/children/${solo.childId}`), teacher)).status,
    ).toBe(200);
    const me = await authed(request(server()).get("/v1/auth/me"), teacher);
    expect(me.body.soloKindergartenIds).toEqual([]);

    const director = await login(app, target.adminUser.username);
    const roster = await authed(request(server()).get("/v1/children?pageSize=100"), director);
    expect(roster.body.items.map((c: { id: string }) => c.id)).toContain(solo.childId);
  });

  it("joins a membership the target already has instead of duplicating it", async () => {
    const existing = await createMembership(solo.teacherUserId, target.kindergarten.id, "TEACHER");
    await db.membership.update({
      where: { id: existing.id },
      data: { isActive: false, deletedAt: new Date() },
    });

    const res = await merge(operator, { targetKindergartenId: target.kindergarten.id });
    expect(res.body).toMatchObject({ membershipsJoined: 1, adminsDropped: 1 });

    const joined = await db.membership.findUniqueOrThrow({ where: { id: existing.id } });
    expect(joined).toMatchObject({ isActive: true, deletedAt: null });
    const assignment = await db.groupTeacher.findFirstOrThrow({ where: { groupId: solo.groupId } });
    expect(assignment.membershipId).toBe(existing.id);
  });

  it("can be run again into the same kindergarten, and not into another", async () => {
    await merge(operator, { targetKindergartenId: target.kindergarten.id }).expect(200);
    expect((await merge(operator, { targetKindergartenId: target.kindergarten.id })).status).toBe(
      200,
    );
    const other = await createScenario("o");
    expect((await merge(operator, { targetKindergartenId: other.kindergarten.id })).status).toBe(
      404,
    );
  });
});
