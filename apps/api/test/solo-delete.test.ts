import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createChild,
  createMembership,
  createScenario,
  createUser,
  enrollChild,
  linkGuardian,
  login,
  setUpSoloWorkspace,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";

/**
 * The operator deletes a solo teacher's workspace — the user, 2026-10-18: the
 * client's trial opened many made-up accounts. «Устгах» is a soft delete;
 * «Бүр мөсөн устгах» removes the rows — only where no money moved, never the
 * audit log, and never a person who has a life in another kindergarten.
 */

let app: INestApplication;
const db = testDb();
const server = () => app.getHttpServer();

let operator: AuthSession;
let other: Scenario;
let solo: {
  kindergartenId: string;
  childId: string;
  teacherUserId: string;
  teacherUsername: string;
  parentUserId: string;
  schoolYearId: string;
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

  // Through the real sign-up, so the purge meets every row it creates.
  const signup = await request(server())
    .post("/v1/teacher-applications")
    .send({
      lastName: "Туршилт",
      firstName: "Багш",
      password: "Shine-Nuuts99",
      phone: "99112244",
      email: `${uniq("solo")}@example.mn`,
      kindergartenName: "Нарлаг цэцэрлэг",
    });
  expect(signup.status, JSON.stringify(signup.body)).toBe(201);

  const kg = await db.kindergarten.findFirstOrThrow({ where: { kind: "SOLO_TEACHER" } });
  const { schoolYear, group, teacher } = await setUpSoloWorkspace(kg.id);
  const child = await createChild(kg.id, { firstName: "Тэмүүлэн" });
  await enrollChild(kg.id, child.id, group.id, schoolYear.id);
  const parent = await createUser({ username: uniq("parent-solo") });
  await createMembership(parent.id, kg.id, "PARENT");
  await linkGuardian(kg.id, child.id, parent.id);
  await db.mediaFile.create({
    data: {
      kindergartenId: kg.id,
      childId: child.id,
      purpose: "CHILD_PHOTO",
      storageKey: `media/${uniq("photo")}.jpg`,
      originalName: "zurag.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 100,
    },
  });
  const teacherUser = await db.user.findUniqueOrThrow({ where: { id: teacher.userId } });

  solo = {
    kindergartenId: kg.id,
    childId: child.id,
    teacherUserId: teacher.userId,
    teacherUsername: teacherUser.username,
    parentUserId: parent.id,
    schoolYearId: schoolYear.id,
  };

  other = await createScenario("o");
  operator = await login(
    app,
    (await createUser({ username: uniq("super"), isSuperAdmin: true })).username,
  );
});

const softDelete = (session: AuthSession, id = solo.kindergartenId) =>
  authed(request(server()).delete(`/v1/platform/solo-workspaces/${id}`), session);

const purge = (session: AuthSession, username = solo.teacherUsername, id = solo.kindergartenId) =>
  authed(request(server()).post(`/v1/platform/solo-workspaces/${id}/purge`), session).send({
    username,
  });

describe("the operator's list", () => {
  it("says how many families paid, and whose username purges it", async () => {
    const res = await authed(request(server()).get("/v1/platform/solo-workspaces"), operator);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({
        id: solo.kindergartenId,
        paidChildCount: 0,
        teacherUsername: solo.teacherUsername,
      }),
    ]);
  });
});

describe("DELETE /platform/solo-workspaces/:id — «Устгах»", () => {
  it("is the operator's only — a director gets 404", async () => {
    const director = await softDelete(await login(app, other.adminUser.username));
    expect(director.status).toBe(404);
    expect(
      (await db.kindergarten.findUniqueOrThrow({ where: { id: solo.kindergartenId } })).deletedAt,
    ).toBeNull();
  });

  it("closes the workspace and the people who belong nowhere else; the rows stay", async () => {
    // A parent with a child in another kindergarten keeps their account.
    const both = await createUser({ username: uniq("parent-both") });
    await createMembership(both.id, solo.kindergartenId, "PARENT");
    await createMembership(both.id, other.kindergarten.id, "PARENT");

    const res = await softDelete(operator);

    expect(res.status).toBe(200);
    const kg = await db.kindergarten.findUniqueOrThrow({ where: { id: solo.kindergartenId } });
    expect(kg.deletedAt).not.toBeNull();
    expect(
      await db.membership.count({
        where: { kindergartenId: solo.kindergartenId, deletedAt: null },
      }),
    ).toBe(0);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: solo.teacherUserId } })).deletedAt,
    ).not.toBeNull();
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: solo.parentUserId } })).deletedAt,
    ).not.toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: both.id } })).deletedAt).toBeNull();
    expect(await db.child.count({ where: { id: solo.childId } })).toBe(1);

    const list = await authed(request(server()).get("/v1/platform/solo-workspaces"), operator);
    expect(list.body.items).toEqual([]);
    expect((await softDelete(operator)).status).toBe(404);
  });
});

describe("POST /platform/solo-workspaces/:id/purge — «Бүр мөсөн устгах»", () => {
  it("is the operator's only, and asks for the teacher's username typed", async () => {
    const director = await purge(await login(app, other.adminUser.username));
    const wrong = await purge(operator, "someone-else");

    expect(director.status).toBe(404);
    expect(wrong.status).toBe(400);
    expect(await db.kindergarten.count({ where: { id: solo.kindergartenId } })).toBe(1);
  });

  it("refuses once money moved — a family paid the portal fee (§14)", async () => {
    await db.accessSubscription.create({
      data: {
        kindergartenId: solo.kindergartenId,
        childId: solo.childId,
        schoolYearId: solo.schoolYearId,
        amount: "22000.00",
        status: "ACTIVE",
        paidAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    const res = await purge(operator);

    expect(res.status).toBe(409);
    expect(await db.kindergarten.count({ where: { id: solo.kindergartenId } })).toBe(1);
    expect(await db.child.count({ where: { id: solo.childId } })).toBe(1);
  });

  it("previews the very purge and rolls it back — counts, nothing removed", async () => {
    const director = await authed(
      request(server()).post(`/v1/platform/solo-workspaces/${solo.kindergartenId}/purge-preview`),
      await login(app, other.adminUser.username),
    );
    const res = await authed(
      request(server()).post(`/v1/platform/solo-workspaces/${solo.kindergartenId}/purge-preview`),
      operator,
    );

    expect(director.status).toBe(404);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ purgeable: true, usersDeleted: 2, files: 1 });
    expect(res.body.deleted).toMatchObject({ children: 1, kindergartens: 1 });
    expect(await db.kindergarten.count({ where: { id: solo.kindergartenId } })).toBe(1);
    expect(await db.child.count({ where: { id: solo.childId } })).toBe(1);
    expect(await db.user.count({ where: { id: solo.teacherUserId } })).toBe(1);
  });

  it("removes the workspace and its people, keeps the audit log, and says so in it", async () => {
    const auditBefore = await db.auditLog.count();

    const res = await purge(operator);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ mode: "purge", usersDeleted: 2, usersKept: 0, files: 1 });
    expect(await db.kindergarten.count({ where: { id: solo.kindergartenId } })).toBe(0);
    expect(await db.child.count({ where: { id: solo.childId } })).toBe(0);
    expect(await db.mediaFile.count({ where: { kindergartenId: solo.kindergartenId } })).toBe(0);
    expect(
      await db.user.count({ where: { id: { in: [solo.teacherUserId, solo.parentUserId] } } }),
    ).toBe(0);

    // ★ Every audit row stays, and one more records the purge.
    expect(await db.auditLog.count()).toBe(auditBefore + 1);
    const row = await db.auditLog.findFirstOrThrow({
      where: { objectType: "Kindergarten", objectId: solo.kindergartenId, action: "DELETE" },
    });
    expect(row.metadata).toMatchObject({
      mode: "purge",
      kindergartenId: solo.kindergartenId,
      teacherUsername: solo.teacherUsername,
    });

    // Another kindergarten is untouched.
    expect(await db.child.count({ where: { id: other.child.id } })).toBe(1);
    expect(await db.user.count({ where: { id: other.parentUser.id } })).toBe(1);
  });

  it("never deletes a person with a life elsewhere — their other kindergarten keeps them whole", async () => {
    // The solo child's parent is also a guardian in the other kindergarten.
    await createMembership(solo.parentUserId, other.kindergarten.id, "PARENT");
    await linkGuardian(other.kindergarten.id, other.child.id, solo.parentUserId);

    const res = await purge(operator);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ usersDeleted: 1, usersKept: 1 });
    expect(await db.user.count({ where: { id: solo.parentUserId } })).toBe(1);
    expect(
      await db.guardianship.count({
        where: { guardianUserId: solo.parentUserId, kindergartenId: other.kindergarten.id },
      }),
    ).toBe(1);
  });

  it("removes a workspace already soft-deleted", async () => {
    expect((await softDelete(operator)).status).toBe(200);
    const res = await purge(operator);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await db.kindergarten.count({ where: { id: solo.kindergartenId } })).toBe(0);
  });
});
