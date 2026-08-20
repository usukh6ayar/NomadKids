import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  assignTeacher,
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

/**
 * Children, guardianships and enrollment — the authorization heart of the
 * system, tested through HTTP.
 *
 * The brief names the cases that must be covered: IDOR, cross-kindergarten,
 * revoked guardian, revoked teacher, sibling access, multiple guardians,
 * multiple teachers. Each has its own block below.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let adminB: AuthSession;
let teacherB: AuthSession;
let parentB: AuthSession;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  adminB = await login(app, b.adminUser.username);
  teacherB = await login(app, b.teacherUser.username);
  parentB = await login(app, b.parentUser.username);
});

const server = () => app.getHttpServer();

// ═══════════════════════════════════════════════════════════════════════════
// IDOR — changing an id in the URL
// ═══════════════════════════════════════════════════════════════════════════

describe("IDOR", () => {
  it("guardian of another child gets 404 on detail", async () => {
    const res = await request(server())
      .get(`/v1/children/${b.child.id}`)
      .set("Cookie", parentA.cookies);
    expect(res.status).toBe(404);
  });

  it("teacher from another group gets 404", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");
    const child = await createChild(a.kindergarten.id, { firstName: "Хол" });
    await enrollChild(a.kindergarten.id, child.id, other.id, a.schoolYear.id);

    const res = await request(server())
      .get(`/v1/children/${child.id}`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    const res = await request(server())
      .get(`/v1/children/${a.child.id}`)
      .set("Cookie", adminB.cookies);
    expect(res.status).toBe(404);
  });

  it("a nonexistent id is indistinguishable from a forbidden one", async () => {
    const forbidden = await request(server())
      .get(`/v1/children/${b.child.id}`)
      .set("Cookie", parentA.cookies);
    const missing = await request(server())
      .get("/v1/children/00000000-0000-4000-8000-000000000000")
      .set("Cookie", parentA.cookies);

    expect(forbidden.status).toBe(missing.status);
    expect(forbidden.body.title).toBe(missing.body.title);
  });

  it("PATCH on another child's record gets 404 and changes nothing", async () => {
    const res = await authed(request(server()).patch(`/v1/children/${b.child.id}`), teacherA).send({
      firstName: "Хулгайлсан",
    });

    expect(res.status).toBe(404);
    const untouched = await db.child.findUnique({ where: { id: b.child.id } });
    expect(untouched?.firstName).toBe(b.child.firstName);
  });

  it("enrolling another kindergarten's child gets 404", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${b.child.id}/enrollments`),
      adminA,
    ).send({ groupId: a.group.id });
    expect(res.status).toBe(404);
  });

  it("listing another child's guardians gets 404", async () => {
    const res = await request(server())
      .get(`/v1/children/${b.child.id}/guardians`)
      .set("Cookie", parentA.cookies);
    expect(res.status).toBe(404);
  });

  it("listing another child's enrollments gets 404", async () => {
    const res = await request(server())
      .get(`/v1/children/${b.child.id}/enrollments`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-kindergarten isolation
// ═══════════════════════════════════════════════════════════════════════════

describe("cross-kindergarten isolation", () => {
  it("A's child list contains none of B's children", async () => {
    const res = await request(server()).get("/v1/children").set("Cookie", adminA.cookies);
    const ids = res.body.items.map((c: { id: string }) => c.id);

    expect(ids).toContain(a.child.id);
    expect(ids).not.toContain(b.child.id);
  });

  it("holds in both directions", async () => {
    const res = await request(server()).get("/v1/children").set("Cookie", adminB.cookies);
    const ids = res.body.items.map((c: { id: string }) => c.id);

    expect(ids).toEqual([b.child.id]);
  });

  it("a group filter cannot reach across kindergartens", async () => {
    const res = await request(server())
      .get(`/v1/children?groupId=${b.group.id}`)
      .set("Cookie", adminA.cookies);

    expect(res.body.items).toHaveLength(0);
  });

  it("registering a child in another kindergarten gets 404", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${b.kindergarten.id}/children`),
      adminA,
    ).send({
      lastName: "Халдлага",
      firstName: "Оролдлого",
      sex: "MALE",
      dateOfBirth: "2021-05-05",
    });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Revoked access
// ═══════════════════════════════════════════════════════════════════════════

describe("revoked guardian", () => {
  it("loses access immediately when canView is set false", async () => {
    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", parentA.cookies))
        .status,
    ).toBe(200);

    await authed(request(server()).patch(`/v1/guardianships/${a.guardianship.id}`), adminA).send({
      canView: false,
    });

    // No re-login: authority is re-read per request.
    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", parentA.cookies))
        .status,
    ).toBe(404);
  });

  it("disappears from the revoked guardian's own list", async () => {
    await authed(request(server()).patch(`/v1/guardianships/${a.guardianship.id}`), adminA).send({
      canView: false,
    });

    const res = await request(server()).get("/v1/children/mine").set("Cookie", parentA.cookies);
    expect(res.body).toHaveLength(0);
  });

  it("REVOKING PRESERVES the relationship record", async () => {
    // Custody arrangements reverse; the history is part of the child's record.
    await authed(request(server()).patch(`/v1/guardianships/${a.guardianship.id}`), adminA).send({
      canView: false,
    });

    const row = await db.guardianship.findUnique({ where: { id: a.guardianship.id } });
    expect(row).not.toBeNull();
    expect(row?.canView).toBe(false);
    expect(row?.deletedAt).toBeNull();
  });

  it("can be restored", async () => {
    await authed(request(server()).patch(`/v1/guardianships/${a.guardianship.id}`), adminA).send({
      canView: false,
    });
    await authed(request(server()).patch(`/v1/guardianships/${a.guardianship.id}`), adminA).send({
      canView: true,
    });

    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", parentA.cookies))
        .status,
    ).toBe(200);
  });
});

describe("revoked teacher", () => {
  it("loses child access when the assignment ends", async () => {
    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", teacherA.cookies))
        .status,
    ).toBe(200);

    await authed(request(server()).delete(`/v1/group-teachers/${a.assignment.id}`), adminA);

    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", teacherA.cookies))
        .status,
    ).toBe(404);
  });

  it("disappears from the revoked teacher's child list", async () => {
    await authed(request(server()).delete(`/v1/group-teachers/${a.assignment.id}`), adminA);

    const res = await request(server()).get("/v1/children").set("Cookie", teacherA.cookies);
    expect(res.body.items).toHaveLength(0);
  });

  it("loses access when the whole membership is revoked", async () => {
    await authed(request(server()).delete(`/v1/memberships/${a.teacherMembership.id}`), adminA);

    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", teacherA.cookies))
        .status,
    ).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sibling isolation, multiple guardians, multiple teachers
// ═══════════════════════════════════════════════════════════════════════════

describe("sibling isolation", () => {
  it("a parent of two children sees both, and nobody else's", async () => {
    const sibling = await createChild(a.kindergarten.id, { firstName: "Дүү" });
    await enrollChild(a.kindergarten.id, sibling.id, a.group.id, a.schoolYear.id);
    await linkGuardian(a.kindergarten.id, sibling.id, a.parentUser.id);

    const classmate = await createChild(a.kindergarten.id, { firstName: "Ангийнх" });
    await enrollChild(a.kindergarten.id, classmate.id, a.group.id, a.schoolYear.id);

    const res = await request(server()).get("/v1/children/mine").set("Cookie", parentA.cookies);
    const ids = res.body.map((c: { id: string }) => c.id);

    expect(ids).toHaveLength(2);
    expect(ids).toContain(a.child.id);
    expect(ids).toContain(sibling.id);
    expect(ids).not.toContain(classmate.id);
  });

  it("a classmate in the same group is still 404 for the parent", async () => {
    // Sharing a room is not a relationship.
    const classmate = await createChild(a.kindergarten.id, { firstName: "Ангийнх" });
    await enrollChild(a.kindergarten.id, classmate.id, a.group.id, a.schoolYear.id);

    const res = await request(server())
      .get(`/v1/children/${classmate.id}`)
      .set("Cookie", parentA.cookies);
    expect(res.status).toBe(404);
  });
});

describe("multiple guardians", () => {
  it("both parents reach the child independently", async () => {
    const father = await createUser({ username: uniq("father") });
    await createMembership(father.id, a.kindergarten.id, "PARENT");
    await linkGuardian(a.kindergarten.id, a.child.id, father.id);

    const fatherSession = await login(app, father.username);

    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", parentA.cookies))
        .status,
    ).toBe(200);
    expect(
      (
        await request(server())
          .get(`/v1/children/${a.child.id}`)
          .set("Cookie", fatherSession.cookies)
      ).status,
    ).toBe(200);
  });

  it("revoking ONE guardian leaves the other's access intact", async () => {
    // The case a custody dispute produces, and the reason revocation is
    // per-guardianship rather than per-child.
    const father = await createUser({ username: uniq("father") });
    await createMembership(father.id, a.kindergarten.id, "PARENT");
    const fatherLink = await linkGuardian(a.kindergarten.id, a.child.id, father.id);
    const fatherSession = await login(app, father.username);

    await authed(request(server()).patch(`/v1/guardianships/${fatherLink.id}`), adminA).send({
      canView: false,
    });

    expect(
      (
        await request(server())
          .get(`/v1/children/${a.child.id}`)
          .set("Cookie", fatherSession.cookies)
      ).status,
    ).toBe(404);
    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", parentA.cookies))
        .status,
    ).toBe(200);
  });
});

describe("multiple teachers", () => {
  it("both assigned teachers reach the child", async () => {
    const assistant = await createUser({ username: uniq("assistant") });
    const membership = await createMembership(assistant.id, a.kindergarten.id, "TEACHER");
    await assignTeacher(a.kindergarten.id, a.group.id, membership.id);

    const session = await login(app, assistant.username);
    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", session.cookies))
        .status,
    ).toBe(200);
  });

  it("revoking one teacher leaves the other's access intact", async () => {
    const assistant = await createUser({ username: uniq("assistant") });
    const membership = await createMembership(assistant.id, a.kindergarten.id, "TEACHER");
    const assignment = await assignTeacher(a.kindergarten.id, a.group.id, membership.id);
    const session = await login(app, assistant.username);

    await authed(request(server()).delete(`/v1/group-teachers/${assignment.id}`), adminA);

    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", session.cookies))
        .status,
    ).toBe(404);
    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", teacherA.cookies))
        .status,
    ).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Write access is narrower than read
// ═══════════════════════════════════════════════════════════════════════════

describe("a guardian may read but not write", () => {
  it("reads their own child", async () => {
    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", parentA.cookies))
        .status,
    ).toBe(200);
  });

  it("CANNOT edit their own child", async () => {
    const res = await authed(request(server()).patch(`/v1/children/${a.child.id}`), parentA).send({
      firstName: "Эцэг эхийн засвар",
    });
    expect(res.status).toBe(404);
  });

  it("cannot archive their own child", async () => {
    const res = await authed(request(server()).delete(`/v1/children/${a.child.id}`), parentA);
    expect(res.status).toBe(404);
  });

  it("cannot add a guardian", async () => {
    const other = await createUser({ username: uniq("other") });
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/guardians`),
      parentA,
    ).send({ guardianUserId: other.id, relation: "FATHER" });
    expect(res.status).toBe(404);
  });

  it("cannot enrol their own child", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/enrollments`),
      parentA,
    ).send({ groupId: a.group.id });
    expect(res.status).toBe(404);
  });
});

describe("a teacher may record but not administer", () => {
  it("edits a child in their group", async () => {
    const res = await authed(request(server()).patch(`/v1/children/${a.child.id}`), teacherA).send({
      healthNotes: "Самрын харшилтай",
    });
    expect(res.status).toBe(200);
  });

  it("cannot archive a child", async () => {
    const res = await authed(request(server()).delete(`/v1/children/${a.child.id}`), teacherA);
    expect(res.status).toBe(404);
  });

  it("cannot change guardianships", async () => {
    const res = await authed(
      request(server()).patch(`/v1/guardianships/${a.guardianship.id}`),
      teacherA,
    ).send({ canView: false });
    expect(res.status).toBe(404);
  });

  it("cannot enrol a child", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/enrollments`),
      teacherA,
    ).send({ groupId: a.group.id });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Registration and enrollment history
// ═══════════════════════════════════════════════════════════════════════════

describe("registering a child", () => {
  it("creates one without a group, and the registrar can still see it", async () => {
    // ★ The D8 fallback in action. Until an enrollment exists,
    // `Child.kindergartenId` is the only thing granting access — without it the
    // staff member filling in the record is locked out of it.
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/children`),
      adminA,
    ).send({ lastName: "Шинэ", firstName: "Хүүхэд", sex: "FEMALE", dateOfBirth: "2022-03-15" });

    expect(res.status).toBe(201);

    const detail = await request(server())
      .get(`/v1/children/${res.body.id}`)
      .set("Cookie", adminA.cookies);
    expect(detail.status).toBe(200);
  });

  it("creates one with a group and enrols it in the same request", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/children`),
      adminA,
    ).send({
      lastName: "Шинэ",
      firstName: "Сурагч",
      sex: "MALE",
      dateOfBirth: "2022-03-15",
      groupId: a.group.id,
    });

    expect(res.status).toBe(201);
    const enrollments = await db.enrollment.findMany({ where: { childId: res.body.id } });
    expect(enrollments).toHaveLength(1);
  });

  it("a TEACHER may register a child", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/children`),
      teacherA,
    ).send({ lastName: "Багшийн", firstName: "Бүртгэл", sex: "MALE", dateOfBirth: "2022-01-01" });
    expect(res.status).toBe(201);
  });

  it("a parent may not", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/children`),
      parentA,
    ).send({ lastName: "Эцэг", firstName: "Эх", sex: "MALE", dateOfBirth: "2022-01-01" });
    expect(res.status).toBe(404);
  });

  it("refuses a duplicate national id in the same kindergarten", async () => {
    await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/children`),
      adminA,
    ).send({
      lastName: "Нэг",
      firstName: "Дэх",
      sex: "MALE",
      dateOfBirth: "2022-01-01",
      nationalId: "УБ12345678",
    });

    const second = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/children`),
      adminA,
    ).send({
      lastName: "Хоёр",
      firstName: "Дахь",
      sex: "FEMALE",
      dateOfBirth: "2022-02-01",
      nationalId: "УБ12345678",
    });

    expect(second.status).toBe(409);
  });

  it("rejects a birth date in the future", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/children`),
      adminA,
    ).send({ lastName: "Ирээдүй", firstName: "Хүүхэд", sex: "MALE", dateOfBirth: "2099-01-01" });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed national id", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/children`),
      adminA,
    ).send({
      lastName: "Буруу",
      firstName: "Регистр",
      sex: "MALE",
      dateOfBirth: "2022-01-01",
      nationalId: "12345",
    });
    expect(res.status).toBe(400);
  });
});

describe("enrollment history", () => {
  it("a transfer ENDS the old enrollment and keeps it", async () => {
    // ★ History is what authorization reads. Deleting the old row would strip
    // the previous teacher of access to observations they wrote themselves.
    const newGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Шинэ бүлэг");

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/enrollments`),
      adminA,
    ).send({ groupId: newGroup.id });

    expect(res.status).toBe(201);

    const enrollments = await db.enrollment.findMany({
      where: { childId: a.child.id },
      orderBy: { startedOn: "asc" },
    });
    expect(enrollments).toHaveLength(2);
    expect(enrollments[0]!.status).toBe("TRANSFERRED");
    expect(enrollments[0]!.endedOn).not.toBeNull();
    expect(enrollments[1]!.status).toBe("ACTIVE");
  });

  it("the PREVIOUS teacher keeps access after a transfer", async () => {
    // D2: authorization semantics preserved unchanged from the reference.
    const newGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Шинэ бүлэг");
    const newTeacher = await createUser({ username: uniq("newteacher") });
    const membership = await createMembership(newTeacher.id, a.kindergarten.id, "TEACHER");
    await assignTeacher(a.kindergarten.id, newGroup.id, membership.id);

    await authed(request(server()).post(`/v1/children/${a.child.id}/enrollments`), adminA).send({
      groupId: newGroup.id,
    });

    // The old teacher still reaches the child, through enrollment history.
    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", teacherA.cookies))
        .status,
    ).toBe(200);

    const newSession = await login(app, newTeacher.username);
    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", newSession.cookies))
        .status,
    ).toBe(200);
  });

  it("never leaves two ACTIVE enrollments for one school year", async () => {
    const newGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Шинэ бүлэг");
    await authed(request(server()).post(`/v1/children/${a.child.id}/enrollments`), adminA).send({
      groupId: newGroup.id,
    });

    const active = await db.enrollment.count({
      where: { childId: a.child.id, schoolYearId: a.schoolYear.id, status: "ACTIVE" },
    });
    expect(active).toBe(1);
  });

  it("returns the full history, newest first", async () => {
    const newGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Шинэ бүлэг");
    await authed(request(server()).post(`/v1/children/${a.child.id}/enrollments`), adminA).send({
      groupId: newGroup.id,
    });

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/enrollments`)
      .set("Cookie", adminA.cookies);

    expect(res.body).toHaveLength(2);
    expect(res.body[0].group.id).toBe(newGroup.id);
  });

  it("ending an enrollment does not delete it", async () => {
    const res = await authed(
      request(server()).patch(`/v1/enrollments/${a.enrollment.id}`),
      adminA,
    ).send({ status: "ENDED" });

    expect(res.status).toBe(200);
    const row = await db.enrollment.findUnique({ where: { id: a.enrollment.id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).toBeNull();
    expect(row?.endedOn).not.toBeNull();
  });

  it("refuses enrolling into another kindergarten's group", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/enrollments`),
      adminA,
    ).send({ groupId: b.group.id });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Audit and misc
// ═══════════════════════════════════════════════════════════════════════════

describe("audit", () => {
  it("records who viewed a child's record", async () => {
    await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", teacherA.cookies);

    const entry = await db.auditLog.findFirst({
      where: { action: "VIEW", childId: a.child.id },
    });
    expect(entry?.actorUserId).toBe(a.teacherUser.id);
  });

  it("records a guardianship revocation", async () => {
    await authed(request(server()).patch(`/v1/guardianships/${a.guardianship.id}`), adminA).send({
      canView: false,
    });

    const entry = await db.auditLog.findFirst({
      where: { action: "PERMISSION_CHANGE", objectType: "Guardianship" },
    });
    expect((entry?.metadata as { change: string }).change).toBe("revoked");
  });
});

describe("soft-deleted children", () => {
  it("vanish from lists and detail for everyone", async () => {
    await authed(request(server()).delete(`/v1/children/${a.child.id}`), adminA);

    expect(
      (await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", adminA.cookies))
        .status,
    ).toBe(404);

    const list = await request(server()).get("/v1/children").set("Cookie", adminA.cookies);
    expect(list.body.items.map((c: { id: string }) => c.id)).not.toContain(a.child.id);
  });
});

describe("CSRF", () => {
  it("rejects a child write with no CSRF header", async () => {
    const res = await request(server())
      .patch(`/v1/children/${a.child.id}`)
      .set("Cookie", teacherA.cookies)
      .send({ firstName: "CSRF-гүй" });

    expect(res.status).toBe(403);
  });
});

describe("teacher B sees only B's children", () => {
  it("does not leak across the parallel scenario", async () => {
    const res = await request(server()).get("/v1/children").set("Cookie", teacherB.cookies);
    expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([b.child.id]);
  });

  it("parent B sees only their own", async () => {
    const res = await request(server()).get("/v1/children/mine").set("Cookie", parentB.cookies);
    expect(res.body.map((c: { id: string }) => c.id)).toEqual([b.child.id]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Inviting a guardian — a teacher creates the family's account
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /children/:id/guardian-invitations", () => {
  const invitation = (extra: Record<string, unknown> = {}) => ({
    username: uniq("etseg"),
    lastName: "Ганболд",
    firstName: "Сарнай",
    relation: "MOTHER",
    ...extra,
  });

  it("a teacher can invite a guardian for a child in their group", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/guardian-invitations`),
      teacherA,
    ).send(invitation());

    expect(res.status).toBe(201);
    expect(res.body.invitationToken).toEqual(expect.any(String));
    expect(res.body.user.id).toBeDefined();
    // Never echoed back, even though the account was just created.
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("creates the guardianship immediately, and a PARENT membership", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/guardian-invitations`),
      teacherA,
    ).send(invitation());

    const guardianship = await db.guardianship.findFirst({
      where: { childId: a.child.id, guardianUserId: res.body.user.id },
    });
    expect(guardianship?.canView).toBe(true);
    expect(guardianship?.relation).toBe("MOTHER");

    const membership = await db.membership.findFirst({
      where: { userId: res.body.user.id, kindergartenId: a.kindergarten.id },
    });
    // Fixed to PARENT — a teacher must not be able to mint a colleague.
    expect(membership?.role).toBe("PARENT");
  });

  it("the invited account cannot be opened until the invitation is accepted", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/guardian-invitations`),
      teacherA,
    ).send(invitation({ username: "etseg-shalgalt" }));

    // The password is random bytes nobody has seen. An unaccepted invitation
    // therefore grants nothing, which is what makes creating the guardianship
    // up front safe.
    const login = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: "etseg-shalgalt", password: "Shine-Nuuts99" });
    expect(login.status).toBe(401);

    const accept = await request(server())
      .post("/v1/auth/invitation/accept")
      .send({ token: res.body.invitationToken, password: "Shine-Nuuts99" });
    expect(accept.status).toBe(204);

    const after = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: "etseg-shalgalt", password: "Shine-Nuuts99" });
    expect(after.status).toBe(200);
  });

  it("the accepted guardian sees that child and no other", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/guardian-invitations`),
      teacherA,
    ).send(invitation({ username: "etseg-hamrah" }));

    await request(server())
      .post("/v1/auth/invitation/accept")
      .send({ token: res.body.invitationToken, password: "Shine-Nuuts99" });

    const session = await login(app, "etseg-hamrah", "Shine-Nuuts99");

    const mine = await request(server())
      .get(`/v1/children/${a.child.id}`)
      .set("Cookie", session.cookies);
    expect(mine.status).toBe(200);

    // ★ The invitation binds one child. Another child in the same kindergarten
    // must stay invisible, or the QR a teacher prints would be a key to the
    // whole class.
    const otherChild = await createChild(a.kindergarten.id, { lastName: "Өөр" });
    await enrollChild(a.kindergarten.id, otherChild.id, a.group.id, a.schoolYear.id);

    const theirs = await request(server())
      .get(`/v1/children/${otherChild.id}`)
      .set("Cookie", session.cookies);
    expect(theirs.status).toBe(404);
  });

  // ── Authorization — CLAUDE.md §4.1 ──────────────────────────────────────

  it("a teacher from another kindergarten gets 404", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${b.child.id}/guardian-invitations`),
      teacherA,
    ).send(invitation());

    expect(res.status).toBe(404);
  });

  it("a teacher who does not teach the child gets 404", async () => {
    const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, uniq("Өөр бүлэг"));
    const otherChild = await createChild(a.kindergarten.id, { lastName: "Хол" });
    await enrollChild(a.kindergarten.id, otherChild.id, otherGroup.id, a.schoolYear.id);

    const res = await authed(
      request(server()).post(`/v1/children/${otherChild.id}/guardian-invitations`),
      teacherA,
    ).send(invitation());

    // Same bar as writing an observation about them — `assertCanRecord`.
    expect(res.status).toBe(404);
  });

  it("a guardian cannot invite another guardian", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/guardian-invitations`),
      parentA,
    ).send(invitation());

    expect([403, 404]).toContain(res.status);
  });

  it("requires authentication", async () => {
    const res = await request(server())
      .post(`/v1/children/${a.child.id}/guardian-invitations`)
      .send(invitation());

    expect(res.status).toBe(401);
  });

  it("requires CSRF", async () => {
    const res = await request(server())
      .post(`/v1/children/${a.child.id}/guardian-invitations`)
      .set("Cookie", teacherA.cookies)
      .send(invitation());

    expect(res.status).toBe(403);
  });

  it("refuses a username that already exists", async () => {
    const existing = await createUser({ username: uniq("busad") });

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/guardian-invitations`),
      teacherA,
    ).send(invitation({ username: existing.username }));

    /*
     * ★ A conflict, not a silent link.
     *
     * Attaching an account somebody already owns to this child is exactly the
     * decision this endpoint may not make — it is `POST children/:id/guardians`,
     * and an administrator's. Answering 409 sends the teacher to ask for one.
     */
    expect(res.status).toBe(409);

    const guardianship = await db.guardianship.findFirst({
      where: { childId: a.child.id, guardianUserId: existing.id },
    });
    expect(guardianship).toBeNull();
  });
});
