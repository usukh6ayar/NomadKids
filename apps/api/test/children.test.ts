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
  createSchoolYear,
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

  it("★ can be marked GRADUATED, distinct from a plain ENDED/TRANSFERRED", async () => {
    const res = await authed(
      request(server()).patch(`/v1/enrollments/${a.enrollment.id}`),
      adminA,
    ).send({ status: "GRADUATED" });

    expect(res.status).toBe(200);
    const row = await db.enrollment.findUnique({ where: { id: a.enrollment.id } });
    expect(row?.status).toBe("GRADUATED");
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
// The enrollment archive — "Цэцэрлэг, бүлгийн архив"
// ═══════════════════════════════════════════════════════════════════════════

describe("promotion — Order А/261, Annex 2 §1 item 9", () => {
  /**
   * ★ The defect this requirement exposed.
   *
   * `enrollChild` ends the child's previous ACTIVE enrolment only when it is in
   * the *same* school year. `GET /groups` is not filtered by year and the
   * transfer form lists everything it returns, so moving a child into next
   * year's group leaves this year's row ACTIVE and the child holds two. Every
   * reader of "the current enrolment" then picks whichever Postgres returned
   * first — the child header, the enrolment archive, the funding count.
   */
  it("a child never holds two ACTIVE enrolments", async () => {
    const nextYear = await createSchoolYear(a.kindergarten.id, false);
    const nextGroup = await createGroup(a.kindergarten.id, nextYear.id, "Дараа жилийн бүлэг");

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/enrollments`),
      adminA,
    ).send({ groupId: nextGroup.id });
    expect(res.status).toBe(201);

    const active = await db.enrollment.findMany({
      where: { childId: a.child.id, status: "ACTIVE", deletedAt: null },
    });
    expect(active).toHaveLength(1);
    expect(active[0]!.groupId).toBe(nextGroup.id);
  });
});

describe("enrollment archive", () => {
  const archive = (childId: string) => `/v1/children/${childId}/enrollment-archive`;

  it("gives a guardian the current placement, its teacher, and an empty history", async () => {
    const res = await request(server()).get(archive(a.child.id)).set("Cookie", parentA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.child.id).toBe(a.child.id);
    expect(res.body.current.kindergarten.id).toBe(a.kindergarten.id);
    expect(res.body.current.group.id).toBe(a.group.id);
    expect(res.body.current.teachers).toEqual([
      expect.objectContaining({ id: a.teacherUser.id, role: "LEAD" }),
    ]);
    expect(res.body.history).toEqual([]);
  });

  it("moves the old placement into history after a transfer", async () => {
    const newGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Шинэ бүлэг");
    await authed(request(server()).post(`/v1/children/${a.child.id}/enrollments`), adminA).send({
      groupId: newGroup.id,
    });

    const res = await request(server()).get(archive(a.child.id)).set("Cookie", parentA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.current.group.id).toBe(newGroup.id);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0]).toMatchObject({
      status: "TRANSFERRED",
      group: { id: a.group.id },
    });
  });

  it("a guardian of another child gets 404", async () => {
    const res = await request(server()).get(archive(a.child.id)).set("Cookie", parentB.cookies);
    expect(res.status).toBe(404);
  });

  it("a teacher from another kindergarten gets 404", async () => {
    const res = await request(server()).get(archive(a.child.id)).set("Cookie", teacherB.cookies);
    expect(res.status).toBe(404);
  });

  it("an admin from another kindergarten gets 404", async () => {
    const res = await request(server()).get(archive(a.child.id)).set("Cookie", adminB.cookies);
    expect(res.status).toBe(404);
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
  /**
   * ★ The teacher supplies nothing but who is primary — 2026-08-29.
   *
   * This used to send a username, a surname, a given name and a relationship:
   * four facts about a person standing in front of the teacher, typed by the
   * teacher. The account is now a placeholder with a generated handle, and the
   * guardian gives their own name, phone and relationship when they accept.
   * See `inviteGuardianSchema`.
   */
  const invitation = (extra: Record<string, unknown> = {}) => ({ ...extra });

  /** What a guardian fills in on the acceptance screen. */
  const acceptance = (token: string, extra: Record<string, unknown> = {}) => ({
    token,
    password: "Shine-Nuuts99",
    firstName: "Сарнай",
    phone: "99001122",
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
    /*
      ★ `OTHER` until the guardian says otherwise.
      
      The relationship is theirs to state, and a teacher guessing it is how a
      father is recorded as a mother. The enum has no "unknown" member; `OTHER`
      already means "not one of the named relationships", which is true here.
      The acceptance test below asserts it becomes `MOTHER`.
    */
    expect(guardianship?.relation).toBe("OTHER");

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
    ).send(invitation());

    // The handle is generated now, so the test reads it back rather than
    // choosing it — which is the point: nobody, including the teacher, knows a
    // credential for this account until the invitation is accepted.
    const username = res.body.user.username as string;
    expect(username).toMatch(/^guardian-/);

    const login = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: username, password: "Shine-Nuuts99" });
    expect(login.status).toBe(401);

    const accept = await request(server())
      .post("/v1/auth/invitation/accept")
      .send(acceptance(res.body.invitationToken));
    expect(accept.status).toBe(204);

    const after = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: username, password: "Shine-Nuuts99" });
    expect(after.status).toBe(200);
  });

  /**
   * ★ The half of the flow that moved: the guardian describes themselves.
   *
   * The account is created as "Асран хамгаалагч" with no phone and an `OTHER`
   * relationship. Accepting is what turns it into a person, and this is the
   * assertion that the three fields actually land.
   */
  it("writes the guardian's own name, phone and relationship on acceptance", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/guardian-invitations`),
      teacherA,
    ).send(invitation());

    expect(res.body.user.firstName).toBe("Асран хамгаалагч");

    await request(server())
      .post("/v1/auth/invitation/accept")
      .send(acceptance(res.body.invitationToken, { firstName: "Болормаа", relation: "FATHER" }))
      .expect(204);

    const user = await db.user.findUnique({ where: { id: res.body.user.id } });
    expect(user?.firstName).toBe("Болормаа");
    expect(user?.phone).toBe("99001122");
    // No surname is collected at all — the client asked for a given name only.
    expect(user?.lastName).toBe("");

    const guardianship = await db.guardianship.findFirst({
      where: { childId: a.child.id, guardianUserId: res.body.user.id },
    });
    expect(guardianship?.relation).toBe("FATHER");
  });

  it("the accepted guardian sees that child and no other", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/guardian-invitations`),
      teacherA,
    ).send(invitation());

    await request(server())
      .post("/v1/auth/invitation/accept")
      .send(acceptance(res.body.invitationToken));

    const session = await login(app, res.body.user.username, "Shine-Nuuts99");

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

  /**
   * ★★ The summary and the list share one filter.
   *
   * A total assembled from a second, hand-copied `where` is how a header ends
   * up reporting a number the rows beneath it contradict — or counts children
   * the caller may not see. `childWhere` is extracted for exactly this.
   */
  it("agrees with the list it heads, under the same query", async () => {
    const [summary, list] = await Promise.all([
      request(server()).get("/v1/children/summary").set("Cookie", teacherA.cookies),
      request(server()).get("/v1/children?page=1&pageSize=25").set("Cookie", teacherA.cookies),
    ]);

    expect(summary.body.total).toBe(list.body.total);
  });

  it("narrows with the same search term", async () => {
    const res = await request(server())
      .get("/v1/children/summary")
      .query({ q: "нэгэнтzzz-байхгүй" })
      .set("Cookie", teacherA.cookies);

    expect(res.body.total).toBe(0);
    // No countable birthday means no average — "0 нас" would be a claim.
    expect(res.body.averageAgeMonths).toBeNull();
  });

  /**
   * ★★★ `children/summary` is declared before `children/:id`.
   *
   * Nest matches in declaration order, so a `:id` route registered first would
   * hand "summary" to the child lookup, which answers 404 — the same status an
   * unauthorized child gets. The bug would read as a permissions problem.
   */
  it("is a route of its own, not swallowed by the :id lookup", async () => {
    const res = await request(server()).get("/v1/children/summary").set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("total");
  });

  it("★ does not count another kindergarten's children", async () => {
    const teacherB = await login(app, b.teacherUser.username);

    const res = await request(server()).get("/v1/children/summary").set("Cookie", teacherB.cookies);

    // Scenario B has exactly one child of its own.
    expect(res.body.total).toBe(1);
  });
});

describe("the roster's sex split", () => {
  /**
   * ★ Counted independently rather than subtracted.
   *
   * `Sex` is a two-value enum today, so `girls = total - boys` would agree —
   * and would silently file every child under the remaining label the day the
   * column becomes nullable or gains a third value.
   */
  it("counts boys and girls separately", async () => {
    for (const sex of ["FEMALE", "FEMALE", "MALE"] as const) {
      const child = await createChild(a.kindergarten.id, { sex });
      await enrollChild(a.kindergarten.id, child.id, a.group.id, a.schoolYear.id);
    }

    const res = await request(server()).get("/v1/children/summary").set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.girls).toBe(2);
    // Two boys: the scenario's own child plus the one created above.
    expect(res.body.boys).toBe(2);
    expect(res.body.boys + res.body.girls).toBe(res.body.total);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Search, filter and sort — RFP §11
// ═══════════════════════════════════════════════════════════════════════════

describe("roster filters", () => {
  /**
   * Ages relative to today, so the assertions do not rot: a fixture with a
   * literal 2021 birth date silently becomes a different age every year, and
   * the test that depended on "is three" starts failing for a reason that has
   * nothing to do with the code.
   */
  async function childAged(years: number, days = 0, overrides: Record<string, unknown> = {}) {
    const now = new Date();
    const dob = new Date(
      Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() - days),
    );
    const child = await createChild(a.kindergarten.id, { dateOfBirth: dob, ...overrides });
    await enrollChild(a.kindergarten.id, child.id, a.group.id, a.schoolYear.id);
    return child;
  }

  async function ids(query: string) {
    const res = await request(server())
      .get(`/v1/children?pageSize=100&${query}`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(200);
    return (res.body.items as { id: string }[]).map((c) => c.id);
  }

  it("filters by sex", async () => {
    const girl = await childAged(3, 0, { sex: "FEMALE", firstName: "Сараа" });
    const boy = await childAged(3, 0, { sex: "MALE", firstName: "Болд" });

    const found = await ids("sex=FEMALE");
    expect(found).toContain(girl.id);
    expect(found).not.toContain(boy.id);
  });

  /**
   * ★ The off-by-one that makes an age filter return nothing.
   *
   * "At most 4" has to mean every child who has not yet turned five, including
   * one who is 4 years and 364 days old. An inclusive `today − 4 years` lower
   * bound matches only children who are exactly four **to the day** — which is
   * almost nobody, and looks like an empty roster rather than a bug.
   */
  it("includes a child on the last day of the range", async () => {
    const almostFive = await childAged(5, -1); // one day short of five
    const justFive = await childAged(5, 1); // one day past five

    const found = await ids("ageMin=2&ageMax=4");
    expect(found).toContain(almostFive.id);
    expect(found).not.toContain(justFive.id);
  });

  it("includes a child on their birthday, at the bottom of the range", async () => {
    const exactlyThree = await childAged(3);
    expect(await ids("ageMin=3")).toContain(exactlyThree.id);
    expect(await ids("ageMin=4")).not.toContain(exactlyThree.id);
  });

  it("rejects an inverted range rather than quietly swapping it", async () => {
    const res = await request(server())
      .get("/v1/children?ageMin=5&ageMax=2")
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(400);
  });

  /**
   * ★★ The summary heads the list, so it must narrow with it.
   *
   * The two used to build their filter object separately. Adding `sex` and the
   * age range to one and not the other is how a header comes to say "12
   * children" over a list showing four.
   */
  it("the summary narrows with the same filters as the list", async () => {
    await childAged(3, 0, { sex: "FEMALE" });
    await childAged(3, 0, { sex: "FEMALE" });
    await childAged(6, 0, { sex: "MALE" });

    const query = "sex=FEMALE&ageMin=2&ageMax=4";
    const [summary, list] = await Promise.all([
      request(server()).get(`/v1/children/summary?${query}`).set("Cookie", teacherA.cookies),
      request(server()).get(`/v1/children?pageSize=100&${query}`).set("Cookie", teacherA.cookies),
    ]);

    expect(summary.body.total).toBe(list.body.total);
    expect(summary.body.total).toBe(2);
  });
});

/**
 * A child's standing — Order А/261, Annex 2 §1 item 7, "Зайлшгүй шаардлагатай".
 *
 * The order names four states: үргэлжлүүлэн суралцаж байгаа, түр суралцаж
 * байгаа, чөлөөтэй, идэвхгүй. `ChildStatus` held two, so a child away for a
 * fortnight and a child who had left the kindergarten were the same row to
 * every query — including the ones a director answers a ministry with.
 */
describe("a child's standing", () => {
  async function setStatus(status: string) {
    return authed(request(server()).patch(`/v1/children/${a.child.id}`), adminA).send({ status });
  }

  it("records each of the four states the order names", async () => {
    for (const status of ["TEMPORARY", "ON_LEAVE", "INACTIVE", "ACTIVE"]) {
      const res = await setStatus(status);
      expect(res.status).toBe(200);

      const row = await db.child.findUniqueOrThrow({ where: { id: a.child.id } });
      expect(row.status).toBe(status);
    }
  });

  /**
   * ★ The old name is gone, not aliased.
   *
   * `ARCHIVED` was renamed to `INACTIVE` in migration `20260901120000`. A
   * client still sending the old word must be told, because the alternative —
   * silently mapping it — would leave two spellings of one state in circulation
   * and the second one would outlive everybody who knew about the first.
   */
  it("refuses the name the state used to have", async () => {
    const res = await setStatus("ARCHIVED");
    expect(res.status).toBe(400);
  });

  it("refuses a state it does not define", async () => {
    expect((await setStatus("GRADUATED")).status).toBe(400);
  });

  /**
   * The register a director reads. `status` was already a filter on this
   * endpoint; what changed is that it can now separate the two states that
   * used to be one.
   */
  it("filters the roster by standing", async () => {
    const onLeave = await createChild(a.kindergarten.id, { firstName: "Чөлөөтэй" });
    await enrollChild(a.kindergarten.id, onLeave.id, a.group.id, a.schoolYear.id);
    await db.child.update({ where: { id: onLeave.id }, data: { status: "ON_LEAVE" } });

    const res = await request(server())
      .get("/v1/children?pageSize=100&status=ON_LEAVE")
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    const found = (res.body.items as { id: string }[]).map((c) => c.id);
    expect(found).toEqual([onLeave.id]);
  });

  it("a guardian cannot change their own child's standing", async () => {
    const res = await authed(request(server()).patch(`/v1/children/${a.child.id}`), parentA).send({
      status: "ACTIVE",
    });

    expect(res.status).toBe(404);
  });

  it("a teacher from another kindergarten gets 404, not a changed row", async () => {
    const res = await authed(request(server()).patch(`/v1/children/${a.child.id}`), teacherB).send({
      status: "INACTIVE",
    });

    expect(res.status).toBe(404);
    const row = await db.child.findUniqueOrThrow({ where: { id: a.child.id } });
    expect(row.status).toBe("ACTIVE");
  });
});

describe("roster sorting", () => {
  async function named(lastName: string, firstName: string, dateOfBirth: Date) {
    const child = await createChild(a.kindergarten.id, { lastName, firstName, dateOfBirth });
    await enrollChild(a.kindergarten.id, child.id, a.group.id, a.schoolYear.id);
    return child;
  }

  it("orders by name by default, and reverses on request", async () => {
    await named("Аюуш", "Аз", new Date("2022-01-01"));
    await named("Ямаа", "Яруу", new Date("2022-01-01"));

    const asc = await request(server())
      .get("/v1/children?pageSize=100")
      .set("Cookie", teacherA.cookies);
    const desc = await request(server())
      .get("/v1/children?pageSize=100&order=desc")
      .set("Cookie", teacherA.cookies);

    expect(asc.body.items[0].lastName).toBe("Аюуш");
    expect(desc.body.items[0].lastName).toBe("Ямаа");
  });

  /**
   * ★ `sort=age` is `dateOfBirth` with the direction flipped, and this pins
   * which way round.
   *
   * Ascending **age** is youngest first, and a younger child has a *later*
   * birth date — so `age asc` and `dateOfBirth asc` return opposite orders.
   * That inversion is the whole reason `childOrderBy` does the flip in one
   * place; the first draft of this test asserted it backwards, which is
   * exactly the mistake the mapping exists to make impossible at the call
   * sites.
   */
  it("sorts by age ascending — youngest first, which is the latest birth date", async () => {
    const older = await named("Хэрэглэгч", "Ахмад", new Date("2020-01-01"));
    const younger = await named("Хэрэглэгч", "Бага", new Date("2023-01-01"));

    const byAge = await request(server())
      .get("/v1/children?pageSize=100&sort=age&order=asc")
      .set("Cookie", teacherA.cookies);
    const byDate = await request(server())
      .get("/v1/children?pageSize=100&sort=dateOfBirth&order=asc")
      .set("Cookie", teacherA.cookies);

    const ageOrder = (byAge.body.items as { id: string }[]).map((c) => c.id);
    const dateOrder = (byDate.body.items as { id: string }[]).map((c) => c.id);

    // Youngest first.
    expect(ageOrder.indexOf(younger.id)).toBeLessThan(ageOrder.indexOf(older.id));
    // The same two children under the same `order`, in the opposite sequence:
    // earliest birth date is the oldest child.
    expect(dateOrder.indexOf(older.id)).toBeLessThan(dateOrder.indexOf(younger.id));

    // And descending age puts the oldest first.
    const oldestFirst = await request(server())
      .get("/v1/children?pageSize=100&sort=age&order=desc")
      .set("Cookie", teacherA.cookies);
    const descOrder = (oldestFirst.body.items as { id: string }[]).map((c) => c.id);
    expect(descOrder.indexOf(older.id)).toBeLessThan(descOrder.indexOf(younger.id));
  });

  it("refuses a sort field that is not offered", async () => {
    const res = await request(server())
      .get("/v1/children?sort=healthNotes")
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(400);
  });
});

/**
 * `?ids=` — the roster's checkboxes, added 2026-09-04 so the Excel export can
 * be a hand-picked set rather than whatever the filters happen to describe.
 *
 * ★ The property under test is that it **narrows and cannot widen**.
 *
 * It is a filter ANDed into `childWhere`, whose first term is
 * `visibleChildrenWhere(actor)` — so an id the caller may not see drops out
 * instead of being fetched. The alternative shape, "fetch these ids then check
 * each one", is one forgotten check away from the cross-tenant read this file
 * exists to prevent, and there is no check here to forget.
 *
 * The list endpoint is asserted rather than the export because they share the
 * same `where` and the same `childFilters()` — one expression, two callers —
 * and a JSON body can be read without parsing a spreadsheet.
 */
describe("the ?ids= selection filter", () => {
  it("narrows the roster to the named children", async () => {
    const res = await authed(request(server()).get(`/v1/children?ids=${a.child.id}`), teacherA);

    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([a.child.id]);
  });

  /**
   * ★★ The discriminating case. Naming another kindergarten's child returns
   * nothing, not that child — the id is intersected with what this teacher may
   * already list, never trusted as a lookup key.
   */
  it("cannot reach another kindergarten's child by naming its id", async () => {
    const res = await authed(request(server()).get(`/v1/children?ids=${b.child.id}`), teacherA);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  /** A mixed list yields only the visible half, silently — a filter, not an error. */
  it("returns only the visible half of a mixed list", async () => {
    const res = await authed(
      request(server()).get(`/v1/children?ids=${a.child.id},${b.child.id}`),
      teacherA,
    );

    expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([a.child.id]);
  });

  it("rejects a value that is not a uuid rather than ignoring it", async () => {
    const res = await authed(request(server()).get("/v1/children?ids=not-a-uuid"), teacherA);
    expect(res.status).toBe(400);
  });

  /**
   * ★ `nationalId` is on the list rows now, for the roster table's Регистр
   * column. It used to be detail-only; the note on `childDetailSchema` records
   * why that changed and why the exposure it was guarding against does not
   * apply to a staff-only, already-authorized list.
   */
  it("carries the national id on list rows", async () => {
    const res = await authed(request(server()).get("/v1/children"), teacherA);

    expect(res.status).toBe(200);
    expect(res.body.items[0]).toHaveProperty("nationalId");
  });
});

/**
 * Гадаад иргэн — the flag and its identifier, added 2026-09-04.
 *
 * ★ Why a flag exists at all: `nationalIdSchema` is two Cyrillic letters and
 * eight digits, which a foreign child cannot produce. Registering one meant
 * leaving the field blank with nothing on the record saying why, and the state
 * reports this feeds count foreign children.
 */
describe("гадаад иргэн хүүхэд", () => {
  it("registers a foreign child with a free-text identifier and no регистр", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/children`),
      teacherA,
    ).send({
      lastName: "Kim",
      firstName: "Minjun",
      sex: "MALE",
      dateOfBirth: "2021-05-04",
      isForeign: true,
      foreignId: "M12345678",
    });

    expect(res.status).toBe(201);

    const child = await db.child.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(child.isForeign).toBe(true);
    expect(child.foreignId).toBe("M12345678");
    // ★ No регистр invented for them — the whole reason the flag exists.
    expect(child.nationalId).toBeNull();
  });

  /** The default, so every row that predates the column reads as a citizen. */
  it("defaults to a Mongolian citizen when the flag is not sent", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/children`),
      teacherA,
    ).send({ lastName: "Бат", firstName: "Болд", sex: "MALE", dateOfBirth: "2021-05-04" });

    expect(res.status).toBe(201);
    const child = await db.child.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(child.isForeign).toBe(false);
    expect(child.foreignId).toBeNull();
  });

  it("lets an existing child be marked foreign afterwards", async () => {
    const res = await authed(request(server()).patch(`/v1/children/${a.child.id}`), teacherA).send({
      isForeign: true,
      foreignId: "E0987654",
    });

    expect(res.status).toBe(200);
    const child = await db.child.findUniqueOrThrow({ where: { id: a.child.id } });
    expect(child.isForeign).toBe(true);
    expect(child.foreignId).toBe("E0987654");
  });

  /**
   * ★ The identifier is not validated, deliberately — a passport number, a
   * residence permit and a foreign national id each have their own shape, and
   * imposing one would push staff into typing a placeholder. Only the length
   * is bounded.
   */
  it("accepts any shape of foreign identifier, but bounds its length", async () => {
    const ok = await authed(request(server()).patch(`/v1/children/${a.child.id}`), teacherA).send({
      isForeign: true,
      foreignId: "AB-1234/567",
    });
    expect(ok.status).toBe(200);

    const tooLong = await authed(
      request(server()).patch(`/v1/children/${a.child.id}`),
      teacherA,
    ).send({ isForeign: true, foreignId: "x".repeat(65) });
    expect(tooLong.status).toBe(400);
  });
});

/**
 * ★ The flag has to survive a round trip, not just a write.
 *
 * The first version of this feature set `isForeign` on create and nowhere else:
 * the edit form could not change it and no list carried it, so a child
 * registered as foreign looked identical to one whose регистр nobody had typed
 * in. These assertions pin the two halves that make the field real — it comes
 * back on a list row, and it can be corrected afterwards.
 */
describe("гадаад иргэн — round trip", () => {
  it("carries the flag and the identifier on list rows", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/children`),
      teacherA,
    ).send({
      lastName: "Kim",
      firstName: "Minjun",
      sex: "MALE",
      dateOfBirth: "2021-05-04",
      isForeign: true,
      foreignId: "M12345678",
      groupId: a.group.id,
    });
    expect(created.status).toBe(201);

    const list = await authed(request(server()).get("/v1/children?q=Minjun"), teacherA);
    const row = list.body.items.find((c: { id: string }) => c.id === created.body.id);

    expect(row.isForeign).toBe(true);
    expect(row.foreignId).toBe("M12345678");
    expect(row.nationalId).toBeNull();
  });

  /**
   * ★ Un-flagging clears the foreign identifier and lets a регистр back in.
   *
   * The edit form sends whichever identifier matches the flag and nulls the
   * other; without that, a corrected record would carry both and the roster's
   * Регистр column would contradict the badge beside it.
   */
  it("can be corrected back to a Mongolian citizen", async () => {
    await authed(request(server()).patch(`/v1/children/${a.child.id}`), teacherA).send({
      isForeign: true,
      foreignId: "E0987654",
      nationalId: null,
    });

    const back = await authed(request(server()).patch(`/v1/children/${a.child.id}`), teacherA).send(
      {
        isForeign: false,
        foreignId: null,
        nationalId: "УБ11112222",
      },
    );
    expect(back.status).toBe(200);

    const child = await db.child.findUniqueOrThrow({ where: { id: a.child.id } });
    expect(child.isForeign).toBe(false);
    expect(child.foreignId).toBeNull();
    expect(child.nationalId).toBe("УБ11112222");
  });
});
