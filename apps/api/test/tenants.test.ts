import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  assignTeacher,
  authed,
  createGroup,
  createMembership,
  createSchoolYear,
  createScenario,
  createUser,
  enrollChild,
  createChild,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Kindergartens, school years, groups and teacher assignments — through HTTP.
 *
 * Every authorization assertion here goes through a real request, because a
 * unit test of the service passes even when a controller forgets to call it.
 * CLAUDE.md §4.1.
 *
 * The convention under test throughout: **404, never 403**, for every
 * authorization failure including wrong-role. docs/SECURITY.md §5.4.
 */

let app: INestApplication;
const db = testDb();

/** Two independent kindergartens — the shape most isolation bugs need. */
let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let adminB: AuthSession;
let accountantA: AuthSession;

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
  adminB = await login(app, b.adminUser.username);

  /*
    ★ An accountant of kindergarten A, teaching nothing — which is the whole
    point of the cases at the foot of "GET /groups". The role exists in
    `нэмэлт.md` §13 and reads the register and the funding sheet; it does not
    appear in `createScenario`, so it is made here.
  */
  const accUser = await createUser({ username: uniq("acct") });
  await createMembership(accUser.id, a.kindergarten.id, "ACCOUNTANT");
  accountantA = await login(app, accUser.username);
});

const server = () => app.getHttpServer();

describe("GET /kindergartens", () => {
  it("returns only the kindergartens the actor belongs to", async () => {
    const res = await request(server()).get("/v1/kindergartens").set("Cookie", adminA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.map((k: { id: string }) => k.id)).toEqual([a.kindergarten.id]);
  });

  it("a teacher sees their own kindergarten", async () => {
    const res = await request(server()).get("/v1/kindergartens").set("Cookie", teacherA.cookies);
    expect(res.body.map((k: { id: string }) => k.id)).toEqual([a.kindergarten.id]);
  });

  it("requires authentication", async () => {
    expect((await request(server()).get("/v1/kindergartens")).status).toBe(401);
  });
});

describe("GET /kindergartens/:id", () => {
  it("allows a member", async () => {
    const res = await request(server())
      .get(`/v1/kindergartens/${a.kindergarten.id}`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(200);
  });

  it("returns 404 for another kindergarten", async () => {
    const res = await request(server())
      .get(`/v1/kindergartens/${b.kindergarten.id}`)
      .set("Cookie", adminA.cookies);
    expect(res.status).toBe(404);
  });

  it("returns 404 for an id that does not exist", async () => {
    // Indistinguishable from the previous case, by design.
    const res = await request(server())
      .get("/v1/kindergartens/00000000-0000-4000-8000-000000000000")
      .set("Cookie", adminA.cookies);
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed id", async () => {
    const res = await request(server())
      .get("/v1/kindergartens/not-a-uuid")
      .set("Cookie", adminA.cookies);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /kindergartens/:id", () => {
  it("allows its own admin", async () => {
    const res = await authed(
      request(server()).patch(`/v1/kindergartens/${a.kindergarten.id}`),
      adminA,
    ).send({ name: "Шинэ нэр" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Шинэ нэр");
  });

  it("REFUSES a director of another kindergarten", async () => {
    const res = await authed(
      request(server()).patch(`/v1/kindergartens/${b.kindergarten.id}`),
      adminA,
    ).send({ name: "Хулгайлсан нэр" });

    expect(res.status).toBe(404);

    const untouched = await db.kindergarten.findUnique({ where: { id: b.kindergarten.id } });
    expect(untouched?.name).toBe(b.kindergarten.name);
  });

  it("refuses a teacher — wrong role gets 404, not 403", async () => {
    const res = await authed(
      request(server()).patch(`/v1/kindergartens/${a.kindergarten.id}`),
      teacherA,
    ).send({ name: "Багшийн оролдлого" });
    expect(res.status).toBe(404);
  });

  it("refuses a parent", async () => {
    const res = await authed(
      request(server()).patch(`/v1/kindergartens/${a.kindergarten.id}`),
      parentA,
    ).send({ name: "Эцэг эхийн оролдлого" });
    expect(res.status).toBe(404);
  });

  it("writes an audit entry", async () => {
    await authed(request(server()).patch(`/v1/kindergartens/${a.kindergarten.id}`), adminA).send({
      name: "Аудиттай нэр",
    });

    const entry = await db.auditLog.findFirst({
      where: { objectType: "Kindergarten", action: "UPDATE" },
    });
    expect(entry?.actorUserId).toBe(a.adminUser.id);
  });
});

describe("school years", () => {
  it("lists them for a member", async () => {
    const res = await request(server())
      .get(`/v1/kindergartens/${a.kindergarten.id}/school-years`)
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("refuses listing another kindergarten's years", async () => {
    const res = await request(server())
      .get(`/v1/kindergartens/${b.kindergarten.id}/school-years`)
      .set("Cookie", adminA.cookies);
    expect(res.status).toBe(404);
  });

  it("creates one", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/school-years`),
      adminA,
    ).send({ name: "2026-2027", startsOn: "2026-09-01", endsOn: "2027-06-01" });

    expect(res.status).toBe(201);
  });

  it("refuses a year that ends before it starts", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/school-years`),
      adminA,
    ).send({ name: "Буруу", startsOn: "2027-06-01", endsOn: "2026-09-01" });

    expect(res.status).toBe(400);
  });

  it("moves `isCurrent` rather than colliding with the existing current year", async () => {
    // A partial unique index allows one current year per kindergarten, so
    // creating a second current year must clear the first — otherwise the
    // insert fails with a constraint error instead of doing what was asked.
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/school-years`),
      adminA,
    ).send({ name: "2026-2027", startsOn: "2026-09-01", endsOn: "2027-06-01", isCurrent: true });

    expect(res.status).toBe(201);

    const current = await db.schoolYear.findMany({
      where: { kindergartenId: a.kindergarten.id, isCurrent: true },
    });
    expect(current).toHaveLength(1);
    expect(current[0]!.name).toBe("2026-2027");
  });

  it("refuses a director of another kindergarten", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${b.kindergarten.id}/school-years`),
      adminA,
    ).send({ name: "Халдлага", startsOn: "2026-09-01", endsOn: "2027-06-01" });

    expect(res.status).toBe(404);
  });

  it("refuses a second year with the same name, with a message rather than a 500", async () => {
    // `@@unique([kindergartenId, name])`. Prisma's P2002 reaches the problem
    // filter as an unrecognised exception unless the service turns it into an
    // HttpException first, and a bare 500 tells the administrator who typed the
    // year twice that the product is broken.
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/school-years`),
      adminA,
    ).send({ name: a.schoolYear.name, startsOn: "2026-09-01", endsOn: "2027-06-01" });

    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/аль хэдийн/);
  });
});

/**
 * Editing an existing school year.
 *
 * ★ The route had no test of any kind before this, and the frontend had no
 * caller — so every rule below was reachable only by hand.
 */
describe("PATCH /school-years/:id", () => {
  it("renames a year", async () => {
    const res = await authed(
      request(server()).patch(`/v1/school-years/${a.schoolYear.id}`),
      adminA,
    ).send({ name: "2030-2031" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("2030-2031");
  });

  it("moves the dates", async () => {
    const res = await authed(
      request(server()).patch(`/v1/school-years/${a.schoolYear.id}`),
      adminA,
    ).send({ startsOn: "2025-09-15", endsOn: "2026-06-15" });

    expect(res.status).toBe(200);

    const stored = await db.schoolYear.findUnique({ where: { id: a.schoolYear.id } });
    expect(stored?.startsOn.toISOString().slice(0, 10)).toBe("2025-09-15");
    expect(stored?.endsOn.toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  /**
   * ★ The rule this whole file most needs pinned.
   *
   * `updateSchoolYearSchema` leaves `isCurrent` optional with **no** default,
   * unlike the create schema's `.default(false)`. So a rename arrives with the
   * field `undefined`, the repository skips its demotion and Prisma skips the
   * column. Give the two DTOs the same default and every corrected typo would
   * quietly leave the kindergarten with no current year — a change that breaks
   * `/admin/terms` and `/admin/groups` and looks nothing like a rename.
   */
  it("a rename does not disturb the current-year flag", async () => {
    const res = await authed(
      request(server()).patch(`/v1/school-years/${a.schoolYear.id}`),
      adminA,
    ).send({ name: "Шинэ нэр" });

    expect(res.status).toBe(200);

    const current = await db.schoolYear.findMany({
      where: { kindergartenId: a.kindergarten.id, isCurrent: true },
    });
    expect(current).toHaveLength(1);
    expect(current[0]!.id).toBe(a.schoolYear.id);
  });

  it("moves `isCurrent` to another year, leaving exactly one", async () => {
    const other = await createSchoolYear(a.kindergarten.id, false);

    const res = await authed(request(server()).patch(`/v1/school-years/${other.id}`), adminA).send({
      isCurrent: true,
    });

    expect(res.status).toBe(200);

    const current = await db.schoolYear.findMany({
      where: { kindergartenId: a.kindergarten.id, isCurrent: true },
    });
    expect(current).toHaveLength(1);
    expect(current[0]!.id).toBe(other.id);
  });

  /** The demotion is scoped to the kindergarten — B's current year is untouched. */
  it("promoting a year in A leaves B's current year alone", async () => {
    const other = await createSchoolYear(a.kindergarten.id, false);
    await authed(request(server()).patch(`/v1/school-years/${other.id}`), adminA).send({
      isCurrent: true,
    });

    const stillCurrent = await db.schoolYear.findUnique({ where: { id: b.schoolYear.id } });
    expect(stillCurrent?.isCurrent).toBe(true);
  });

  it("refuses a year that ends before it starts", async () => {
    const res = await authed(
      request(server()).patch(`/v1/school-years/${a.schoolYear.id}`),
      adminA,
    ).send({ startsOn: "2027-06-01", endsOn: "2026-09-01" });

    expect(res.status).toBe(400);
    // Attached to the field, so the web form can put it under the input.
    expect(res.body.errors?.endsOn?.[0]).toMatch(/хойш байх ёстой/);
  });

  it("refuses renaming onto another year's name", async () => {
    const other = await createSchoolYear(a.kindergarten.id, false);

    const res = await authed(request(server()).patch(`/v1/school-years/${other.id}`), adminA).send({
      name: a.schoolYear.name,
    });

    expect(res.status).toBe(409);
  });

  it("refuses a teacher", async () => {
    const res = await authed(
      request(server()).patch(`/v1/school-years/${a.schoolYear.id}`),
      teacherA,
    ).send({ name: "Багшийн оролдлого" });

    expect(res.status).toBe(404);
  });

  it("refuses a parent", async () => {
    const res = await authed(
      request(server()).patch(`/v1/school-years/${a.schoolYear.id}`),
      parentA,
    ).send({ name: "Эцэг эхийн оролдлого" });

    expect(res.status).toBe(404);
  });

  it("refuses a director of another kindergarten", async () => {
    const res = await authed(
      request(server()).patch(`/v1/school-years/${b.schoolYear.id}`),
      adminA,
    ).send({ name: "Хулгай" });

    expect(res.status).toBe(404);

    const untouched = await db.schoolYear.findUnique({ where: { id: b.schoolYear.id } });
    expect(untouched?.name).toBe(b.schoolYear.name);
  });

  it("returns 404 for an id that does not exist", async () => {
    const res = await authed(
      request(server()).patch("/v1/school-years/00000000-0000-4000-8000-000000000000"),
      adminA,
    ).send({ name: "Хоосон" });

    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed id", async () => {
    const res = await authed(request(server()).patch("/v1/school-years/not-a-uuid"), adminA).send({
      name: "Буруу",
    });

    expect(res.status).toBe(400);
  });

  it("writes an audit entry", async () => {
    await authed(request(server()).patch(`/v1/school-years/${a.schoolYear.id}`), adminA).send({
      name: "Аудиттай жил",
    });

    const entry = await db.auditLog.findFirst({
      where: { objectType: "SchoolYear", action: "UPDATE" },
    });
    expect(entry?.actorUserId).toBe(a.adminUser.id);
    expect(entry?.objectId).toBe(a.schoolYear.id);
  });

  /**
   * ★ A group belonging to the year is not a constraint on editing it.
   *
   * Nothing in the DTO can move a year between kindergartens, so a rename or a
   * date change cannot orphan a group — and unlike `archiveGroup`, there is no
   * enrolment guard to trip, because there is no delete route to guard.
   */
  it("edits a year that already has groups and enrolled children", async () => {
    const res = await authed(
      request(server()).patch(`/v1/school-years/${a.schoolYear.id}`),
      adminA,
    ).send({ name: "Хүүхэдтэй жил" });

    expect(res.status).toBe(200);

    const group = await db.group.findUnique({ where: { id: a.group.id } });
    expect(group?.schoolYearId).toBe(a.schoolYear.id);
  });
});

describe("GET /groups", () => {
  it("an admin sees every group in their kindergarten", async () => {
    await createGroup(a.kindergarten.id, a.schoolYear.id, "Хоёрдугаар бүлэг");

    const res = await request(server()).get("/v1/groups").set("Cookie", adminA.cookies);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  it("a TEACHER sees only their assigned groups", async () => {
    // The narrowing that matters: a teacher in a kindergarten with several
    // groups must not see the ones they do not teach.
    await createGroup(a.kindergarten.id, a.schoolYear.id, "Тэдний биш бүлэг");

    const res = await request(server()).get("/v1/groups").set("Cookie", teacherA.cookies);
    expect(res.status).toBe(200);
    expect(res.body.items.map((g: { id: string }) => g.id)).toEqual([a.group.id]);
  });

  it("a teacher cannot widen the scope with a query parameter", async () => {
    // ?kindergartenId is a filter, never a grant.
    const res = await request(server())
      .get(`/v1/groups?kindergartenId=${b.kindergarten.id}`)
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it("an admin cannot list another kindergarten's groups", async () => {
    const res = await request(server())
      .get(`/v1/groups?kindergartenId=${b.kindergarten.id}`)
      .set("Cookie", adminA.cookies);

    expect(res.body.items).toHaveLength(0);
  });

  /*
    ★ 2026-09-13, and it was a real defect rather than a missing nicety.

    The client: "нягтлан хэсэг дээр ирцийн дэлгэрэнгүй дээр ороод бүлэг гээд
    бүлэг сонгох гэхээр харагдахгүй байна." `/attendance/register` is gated to
    ADMIN and ACCOUNTANT and answers with every class's name and counts — but
    this route refused the role outright, and even once allowed in, the service
    narrowed any non-admin to the groups they *teach*. An accountant teaches
    none, so the "Бүлэг" select on the one screen built for them was empty and
    no group could ever be chosen.
  */
  it("★ an accountant sees every group in their kindergarten", async () => {
    await createGroup(a.kindergarten.id, a.schoolYear.id, "Хоёрдугаар бүлэг");

    const res = await request(server()).get("/v1/groups").set("Cookie", accountantA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  /* The grant is to their own kindergarten, and a query parameter is a filter. */
  it("★ an accountant cannot list another kindergarten's groups", async () => {
    const res = await request(server())
      .get(`/v1/groups?kindergartenId=${b.kindergarten.id}`)
      .set("Cookie", accountantA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it("refuses a parent — wrong role", async () => {
    expect((await request(server()).get("/v1/groups").set("Cookie", parentA.cookies)).status).toBe(
      404,
    );
  });

  it("paginates", async () => {
    for (let i = 0; i < 5; i++) {
      await createGroup(a.kindergarten.id, a.schoolYear.id, `Бүлэг ${i}`);
    }

    const res = await request(server())
      .get("/v1/groups?page=1&pageSize=2")
      .set("Cookie", adminA.cookies);

    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(6);
    expect(res.body.totalPages).toBe(3);
  });

  it("refuses a pageSize above the ceiling", async () => {
    const res = await request(server())
      .get("/v1/groups?pageSize=100000")
      .set("Cookie", adminA.cookies);
    expect(res.status).toBe(400);
  });
});

describe("GET /groups/:id", () => {
  it("allows the assigned teacher", async () => {
    const res = await request(server())
      .get(`/v1/groups/${a.group.id}`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(200);
  });

  it("REFUSES a teacher from another group in the same kindergarten", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");

    const res = await request(server())
      .get(`/v1/groups/${other.id}`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(404);
  });

  it("refuses a director of another kindergarten", async () => {
    const res = await request(server())
      .get(`/v1/groups/${b.group.id}`)
      .set("Cookie", adminA.cookies);
    expect(res.status).toBe(404);
  });

  it("REFUSES a revoked teacher", async () => {
    await db.groupTeacher.update({
      where: { id: a.assignment.id },
      data: { endedOn: new Date() },
    });

    const res = await request(server())
      .get(`/v1/groups/${a.group.id}`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(404);
  });

  /*
    ★ An accountant opens any class in their own kindergarten — 2026-09-13,
    with the list fix above. They are not a teacher, so the assignment check
    that narrows one does not apply to them; they read every class on the
    register and the funding sheet already.
  */
  it("★ allows an accountant into a group they do not teach", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");

    const res = await request(server())
      .get(`/v1/groups/${other.id}`)
      .set("Cookie", accountantA.cookies);
    expect(res.status).toBe(200);
  });

  it("★ refuses an accountant another kindergarten's group", async () => {
    const res = await request(server())
      .get(`/v1/groups/${b.group.id}`)
      .set("Cookie", accountantA.cookies);
    expect(res.status).toBe(404);
  });
});

describe("POST /kindergartens/:id/groups", () => {
  it("creates a group", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/groups`),
      adminA,
    ).send({ schoolYearId: a.schoolYear.id, name: "Шинэ бүлэг", ageBand: "JUNIOR" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Шинэ бүлэг");
  });

  it("REFUSES a school year belonging to another kindergarten", async () => {
    // Without this check an admin could attach their group to another
    // kindergarten's year simply by passing its id.
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/groups`),
      adminA,
    ).send({ schoolYearId: b.schoolYear.id, name: "Хулгайлсан жил", ageBand: "JUNIOR" });

    expect(res.status).toBe(400);
  });

  it("refuses a teacher", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/groups`),
      teacherA,
    ).send({ schoolYearId: a.schoolYear.id, name: "Багшийн бүлэг", ageBand: "JUNIOR" });

    expect(res.status).toBe(404);
  });

  it("rejects an unknown age band", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/groups`),
      adminA,
    ).send({ schoolYearId: a.schoolYear.id, name: "Буруу", ageBand: "NOT_A_BAND" });

    expect(res.status).toBe(400);
  });
});

/**
 * `PATCH /groups/:id` — rename, re-band, and the reversible archive.
 *
 * ★ The status round trip is the one that matters most here.
 *
 * The product has two operations that both read as "archive" and behave
 * completely differently: `status: ARCHIVED` is a flag the row keeps and can
 * flip back, while `DELETE` sets `deletedAt` and `baseWhere` then hides the row
 * from every query with no endpoint to restore it. The admin screen presents
 * them as a reversible toggle and a confirmed one-way delete respectively, and
 * that presentation is only honest if `status` really does go both ways —
 * which nothing asserted until now.
 */
describe("PATCH /groups/:id", () => {
  it("renames a group", async () => {
    const res = await authed(request(server()).patch(`/v1/groups/${a.group.id}`), adminA).send({
      name: "Шинэ нэр",
    });

    expect(res.status).toBe(200);
    const row = await db.group.findUniqueOrThrow({ where: { id: a.group.id } });
    expect(row.name).toBe("Шинэ нэр");
  });

  it("changes the age band", async () => {
    const res = await authed(request(server()).patch(`/v1/groups/${a.group.id}`), adminA).send({
      ageBand: "SENIOR",
    });

    expect(res.status).toBe(200);
    const row = await db.group.findUniqueOrThrow({ where: { id: a.group.id } });
    expect(row.ageBand).toBe("SENIOR");
  });

  it("archives and restores through status, leaving the row visible", async () => {
    const archived = await authed(request(server()).patch(`/v1/groups/${a.group.id}`), adminA).send(
      { status: "ARCHIVED" },
    );
    expect(archived.status).toBe(200);

    let row = await db.group.findUniqueOrThrow({ where: { id: a.group.id } });
    expect(row.status).toBe("ARCHIVED");
    // Unlike DELETE, this leaves the row reachable — which is what makes the
    // restore below possible at all.
    expect(row.deletedAt).toBeNull();

    const listed = await authed(request(server()).get("/v1/groups"), adminA);
    expect(listed.body.items.map((g: { id: string }) => g.id)).toContain(a.group.id);

    const restored = await authed(request(server()).patch(`/v1/groups/${a.group.id}`), adminA).send(
      { status: "ACTIVE" },
    );
    expect(restored.status).toBe(200);

    row = await db.group.findUniqueOrThrow({ where: { id: a.group.id } });
    expect(row.status).toBe("ACTIVE");
  });

  /** Unlike DELETE, archiving by status has no enrolment guard — the children
   *  stay where they are and the group is still there to hold them. */
  it("archives by status even while children are enrolled", async () => {
    const res = await authed(request(server()).patch(`/v1/groups/${a.group.id}`), adminA).send({
      status: "ARCHIVED",
    });
    expect(res.status).toBe(200);
  });

  it("refuses an empty name", async () => {
    const res = await authed(request(server()).patch(`/v1/groups/${a.group.id}`), adminA).send({
      name: "",
    });
    expect(res.status).toBe(400);
  });

  /** `schoolYearId` is absent from `updateGroupSchema`, and Zod strips unknown
   *  keys — so a client sending one would appear to succeed and change nothing.
   *  The edit form does not offer it for this reason. */
  it("ignores a school year in the body rather than moving the group", async () => {
    const before = await db.group.findUniqueOrThrow({ where: { id: a.group.id } });
    const otherYear = await createSchoolYear(a.kindergarten.id, false);

    const res = await authed(request(server()).patch(`/v1/groups/${a.group.id}`), adminA).send({
      schoolYearId: otherYear.id,
      name: "Хэвээр",
    });

    expect(res.status).toBe(200);
    const after = await db.group.findUniqueOrThrow({ where: { id: a.group.id } });
    expect(after.schoolYearId).toBe(before.schoolYearId);
    expect(after.name).toBe("Хэвээр");
  });
});

/**
 * Programme and hours — Order А/261, Annex 2 §1 items 5, 6, 13, 14 and 16.
 *
 * All five are marked "Зайлшгүй шаардлагатай", so they are pass/fail at a
 * ministry inspection rather than nice to have. The schema could not express
 * any of them before migration `20260901120000`: every group was implicitly the
 * main programme on standard hours, and a kindergarten running a ger group or
 * an extended-hours group had nowhere to say so.
 */
describe("group programme and hours", () => {
  it("defaults to the main programme on standard hours", async () => {
    // The ordinary group, created by a form that does not mention either field.
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/groups`),
      adminA,
    ).send({ schoolYearId: a.schoolYear.id, name: "Энгийн бүлэг", ageBand: "JUNIOR" });

    expect(res.status).toBe(201);
    const row = await db.group.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.programKind).toBe("MAIN");
    expect(row.attendanceForm).toBe("STANDARD");
  });

  it("records an alternative-programme group on extended hours", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/groups`),
      adminA,
    ).send({
      schoolYearId: a.schoolYear.id,
      name: "Гэр бүлэг",
      ageBand: "MIDDLE",
      programKind: "ALTERNATIVE",
      attendanceForm: "EXTENDED",
    });

    expect(res.status).toBe(201);
    const row = await db.group.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.programKind).toBe("ALTERNATIVE");
    expect(row.attendanceForm).toBe("EXTENDED");
  });

  it("rejects a programme it does not define", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/groups`),
      adminA,
    ).send({
      schoolYearId: a.schoolYear.id,
      name: "Буруу",
      ageBand: "JUNIOR",
      programKind: "SOMETHING_ELSE",
    });

    expect(res.status).toBe(400);
  });

  it("rejects an attendance form it does not define", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/groups`),
      adminA,
    ).send({
      schoolYearId: a.schoolYear.id,
      name: "Буруу",
      ageBand: "JUNIOR",
      attendanceForm: "ALL_NIGHT",
    });

    expect(res.status).toBe(400);
  });

  it("moves an existing group onto shortened hours", async () => {
    const res = await authed(request(server()).patch(`/v1/groups/${a.group.id}`), adminA).send({
      attendanceForm: "SHORTENED",
    });

    expect(res.status).toBe(200);
    const row = await db.group.findUniqueOrThrow({ where: { id: a.group.id } });
    expect(row.attendanceForm).toBe("SHORTENED");
    // The programme is a separate decision and must not move with it.
    expect(row.programKind).toBe("MAIN");
  });

  /**
   * ★ The trap `updateGroupSchema` is written to avoid.
   *
   * `createGroupSchema` gives both fields `.default(...)`; the update schema
   * deliberately does not. Were the default copied across, Zod would fill in
   * "MAIN" for a body that never mentioned the programme, and renaming a ger
   * group would quietly convert it to the main programme — the same fault
   * `updateSchoolYearSchema` documents for `isCurrent`.
   */
  it("a rename leaves the programme and the hours alone", async () => {
    await db.group.update({
      where: { id: a.group.id },
      data: { programKind: "ALTERNATIVE", attendanceForm: "EXTENDED" },
    });

    const res = await authed(request(server()).patch(`/v1/groups/${a.group.id}`), adminA).send({
      name: "Зөвхөн нэр солив",
    });

    expect(res.status).toBe(200);
    const row = await db.group.findUniqueOrThrow({ where: { id: a.group.id } });
    expect(row.name).toBe("Зөвхөн нэр солив");
    expect(row.programKind).toBe("ALTERNATIVE");
    expect(row.attendanceForm).toBe("EXTENDED");
  });

  it("lists the alternative-programme groups on their own — item 6", async () => {
    const alternative = await createGroup(a.kindergarten.id, a.schoolYear.id, "Хувилбарт бүлэг");
    await db.group.update({
      where: { id: alternative.id },
      data: { programKind: "ALTERNATIVE" },
    });

    const res = await authed(request(server()).get("/v1/groups?programKind=ALTERNATIVE"), adminA);

    expect(res.status).toBe(200);
    expect(res.body.items.map((g: { id: string }) => g.id)).toEqual([alternative.id]);
  });

  /**
   * The filter is a filter, never a grant — the same rule the kindergarten and
   * school-year filters on this endpoint are held to.
   */
  it("the programme filter does not reach another kindergarten's groups", async () => {
    const theirs = await createGroup(b.kindergarten.id, b.schoolYear.id, "Тэдний хувилбарт");
    await db.group.update({ where: { id: theirs.id }, data: { programKind: "ALTERNATIVE" } });

    const res = await authed(request(server()).get("/v1/groups?programKind=ALTERNATIVE"), adminA);

    expect(res.status).toBe(200);
    expect(res.body.items.map((g: { id: string }) => g.id)).not.toContain(theirs.id);
  });

  it("refuses a teacher setting the programme on a group they teach", async () => {
    const res = await authed(request(server()).patch(`/v1/groups/${a.group.id}`), teacherA).send({
      programKind: "ALTERNATIVE",
    });

    expect(res.status).toBe(404);
  });
});

/**
 * `POST /groups/:id/promotions` — Order А/261, Annex 2 §1 item 9, mandatory:
 * "Суралцагчийн анги дэвших болон давтан суралцах үйл ажиллагааг бүртгэх".
 *
 * There was no way to express either before this. A director moved children up
 * a year by opening each child's edit screen and transferring them one at a
 * time, which recorded every one of them as TRANSFERRED — the same word the
 * register uses for a child who changed group in March. The end of a school
 * year and a mid-year move looked identical in the archive.
 */
describe("POST /groups/:id/promotions", () => {
  /**
   * A group in next year's school year.
   *
   * ★ The band matters and is named at every call site. `createScenario`\'s
   * group is MIDDLE (see `support/fixtures.ts`), so SENIOR is a promotion and
   * MIDDLE is a repeat — and the outcome is derived from exactly that
   * comparison, so a test that guesses the fixture\'s band tests nothing.
   */
  async function nextYearGroup(ageBand: "SENIOR" | "MIDDLE" = "SENIOR") {
    const year = await createSchoolYear(a.kindergarten.id, false);
    const group = await createGroup(a.kindergarten.id, year.id, `Бүлэг ${uniq()}`);
    await db.group.update({ where: { id: group.id }, data: { ageBand } });
    return group;
  }

  it("moves the whole group up and records it as a promotion", async () => {
    const target = await nextYearGroup("SENIOR");

    const res = await authed(
      request(server()).post(`/v1/groups/${a.group.id}/promotions`),
      adminA,
    ).send({ toGroupId: target.id });

    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe("PROMOTED");
    expect(res.body.movedCount).toBe(1);

    const rows = await db.enrollment.findMany({
      where: { childId: a.child.id, deletedAt: null },
      orderBy: { startedOn: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.status).toBe("PROMOTED");
    expect(rows[0]!.endedOn).not.toBeNull();
    expect(rows[1]!.status).toBe("ACTIVE");
    expect(rows[1]!.groupId).toBe(target.id);
  });

  /**
   * ★ The distinction the order asks for, and it is derived rather than sent.
   *
   * Same age band means the child stayed where they were for another year.
   * Nothing in the request says so — the two groups do.
   */
  it("records a move into the same age band as repeating the year", async () => {
    const target = await nextYearGroup("MIDDLE");

    const res = await authed(
      request(server()).post(`/v1/groups/${a.group.id}/promotions`),
      adminA,
    ).send({ toGroupId: target.id });

    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe("REPEATED");

    const ended = await db.enrollment.findUniqueOrThrow({ where: { id: a.enrollment.id } });
    expect(ended.status).toBe("REPEATED");
  });

  it("moves only the children named, leaving the rest where they are", async () => {
    const staying = await createChild(a.kindergarten.id, { firstName: "Үлдэх" });
    await enrollChild(a.kindergarten.id, staying.id, a.group.id, a.schoolYear.id);
    const target = await nextYearGroup();

    const res = await authed(
      request(server()).post(`/v1/groups/${a.group.id}/promotions`),
      adminA,
    ).send({ toGroupId: target.id, childIds: [a.child.id] });

    expect(res.status).toBe(201);
    expect(res.body.movedCount).toBe(1);

    const left = await db.enrollment.findFirstOrThrow({
      where: { childId: staying.id, status: "ACTIVE", deletedAt: null },
    });
    expect(left.groupId).toBe(a.group.id);
  });

  it("leaves every child holding exactly one active enrolment", async () => {
    const target = await nextYearGroup();
    await authed(request(server()).post(`/v1/groups/${a.group.id}/promotions`), adminA).send({
      toGroupId: target.id,
    });

    const active = await db.enrollment.findMany({
      where: { childId: a.child.id, status: "ACTIVE", deletedAt: null },
    });
    expect(active).toHaveLength(1);
  });

  it("writes one audit row per child, not one for the batch", async () => {
    const target = await nextYearGroup();
    await authed(request(server()).post(`/v1/groups/${a.group.id}/promotions`), adminA).send({
      toGroupId: target.id,
    });

    const rows = await db.auditLog.findMany({
      where: { objectType: "Enrollment", childId: a.child.id },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => (r.metadata as { change?: string })?.change === "promoted")).toBe(true);
  });

  it("refuses promoting a group into itself", async () => {
    const res = await authed(
      request(server()).post(`/v1/groups/${a.group.id}/promotions`),
      adminA,
    ).send({ toGroupId: a.group.id });

    expect(res.status).toBe(400);
  });

  it("refuses a target group in another kindergarten", async () => {
    const res = await authed(
      request(server()).post(`/v1/groups/${a.group.id}/promotions`),
      adminA,
    ).send({ toGroupId: b.group.id });

    expect(res.status).toBe(400);

    // And nothing moved.
    const row = await db.enrollment.findUniqueOrThrow({ where: { id: a.enrollment.id } });
    expect(row.status).toBe("ACTIVE");
  });

  it("refuses an empty group with a message rather than a silent success", async () => {
    const empty = await createGroup(a.kindergarten.id, a.schoolYear.id, "Хоосон");
    const target = await nextYearGroup();

    const res = await authed(
      request(server()).post(`/v1/groups/${empty.id}/promotions`),
      adminA,
    ).send({ toGroupId: target.id });

    expect(res.status).toBe(400);
  });

  // ── CLAUDE.md §4.1 — the three that are mandatory for any child data ──────

  it("a teacher of the group gets 404", async () => {
    const target = await nextYearGroup();
    const res = await authed(
      request(server()).post(`/v1/groups/${a.group.id}/promotions`),
      teacherA,
    ).send({ toGroupId: target.id });

    expect(res.status).toBe(404);
  });

  it("a guardian of the child gets 404", async () => {
    const target = await nextYearGroup();
    const res = await authed(
      request(server()).post(`/v1/groups/${a.group.id}/promotions`),
      parentA,
    ).send({ toGroupId: target.id });

    expect(res.status).toBe(404);
  });

  it("a director of another kindergarten gets 404, and nothing moves", async () => {
    const target = await nextYearGroup();
    const res = await authed(
      request(server()).post(`/v1/groups/${a.group.id}/promotions`),
      adminB,
    ).send({ toGroupId: target.id });

    expect(res.status).toBe(404);
    const row = await db.enrollment.findUniqueOrThrow({ where: { id: a.enrollment.id } });
    expect(row.status).toBe("ACTIVE");
  });
});

describe("DELETE /groups/:id — archive", () => {
  it("refuses while children are still enrolled", async () => {
    // Archiving a populated group would leave its enrollments pointing at
    // something no screen shows, and the children would vanish from the roster.
    const res = await authed(request(server()).delete(`/v1/groups/${a.group.id}`), adminA);
    expect(res.status).toBe(409);
  });

  it("archives an empty group", async () => {
    const empty = await createGroup(a.kindergarten.id, a.schoolYear.id, "Хоосон бүлэг");

    const res = await authed(request(server()).delete(`/v1/groups/${empty.id}`), adminA);
    expect(res.status).toBe(200);

    // Soft delete: the row survives, the listing does not show it.
    const row = await db.group.findUnique({ where: { id: empty.id } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("refuses another kindergarten's group", async () => {
    const res = await authed(request(server()).delete(`/v1/groups/${b.group.id}`), adminA);
    expect(res.status).toBe(404);
  });
});

describe("teacher assignments", () => {
  it("assigns a teacher to a group", async () => {
    const newTeacher = await createUser({ username: uniq("t2") });
    const membership = await createMembership(newTeacher.id, a.kindergarten.id, "TEACHER");

    const res = await authed(
      request(server()).post(`/v1/groups/${a.group.id}/teachers`),
      adminA,
    ).send({ membershipId: membership.id, role: "ASSISTANT" });

    expect(res.status).toBe(201);
  });

  it("REFUSES a membership from another kindergarten", async () => {
    // The check that makes it structurally impossible to assign someone to a
    // kindergarten they have no membership in.
    const res = await authed(
      request(server()).post(`/v1/groups/${a.group.id}/teachers`),
      adminA,
    ).send({ membershipId: b.teacherMembership.id });

    expect(res.status).toBe(400);
  });

  it("refuses a PARENT membership", async () => {
    const parentMembership = await db.membership.findFirstOrThrow({
      where: { userId: a.parentUser.id, role: "PARENT" },
    });

    const res = await authed(
      request(server()).post(`/v1/groups/${a.group.id}/teachers`),
      adminA,
    ).send({ membershipId: parentMembership.id });

    expect(res.status).toBe(400);
  });

  it("refuses a duplicate active assignment", async () => {
    const res = await authed(
      request(server()).post(`/v1/groups/${a.group.id}/teachers`),
      adminA,
    ).send({ membershipId: a.teacherMembership.id });

    expect(res.status).toBe(409);
  });

  it("ending an assignment revokes access IMMEDIATELY, without re-login", async () => {
    // ★ The point of re-reading authority per request. The teacher's session is
    // still valid; their access is not.
    expect(
      (await request(server()).get(`/v1/groups/${a.group.id}`).set("Cookie", teacherA.cookies))
        .status,
    ).toBe(200);

    await authed(request(server()).delete(`/v1/group-teachers/${a.assignment.id}`), adminA);

    expect(
      (await request(server()).get(`/v1/groups/${a.group.id}`).set("Cookie", teacherA.cookies))
        .status,
    ).toBe(404);
  });

  it("ends rather than deletes, so attribution survives", async () => {
    await authed(request(server()).delete(`/v1/group-teachers/${a.assignment.id}`), adminA);

    const row = await db.groupTeacher.findUnique({ where: { id: a.assignment.id } });
    expect(row).not.toBeNull();
    expect(row?.endedOn).not.toBeNull();
  });

  it("refuses ending another kindergarten's assignment", async () => {
    const res = await authed(
      request(server()).delete(`/v1/group-teachers/${b.assignment.id}`),
      adminA,
    );
    expect(res.status).toBe(404);
  });
});

describe("CSRF on tenant writes", () => {
  it("rejects a POST with no CSRF header", async () => {
    const res = await request(server())
      .post(`/v1/kindergartens/${a.kindergarten.id}/groups`)
      .set("Cookie", adminA.cookies)
      .send({ schoolYearId: a.schoolYear.id, name: "CSRF-гүй", ageBand: "JUNIOR" });

    expect(res.status).toBe(403);
  });

  it("rejects a PATCH with no CSRF header", async () => {
    const res = await request(server())
      .patch(`/v1/kindergartens/${a.kindergarten.id}`)
      .set("Cookie", adminA.cookies)
      .send({ name: "CSRF-гүй" });

    expect(res.status).toBe(403);
  });
});

describe("group rosters reflect enrollment", () => {
  it("counts only ACTIVE enrollments", async () => {
    const extra = await createChild(a.kindergarten.id, { firstName: "Дэлгэрмаа" });
    await enrollChild(a.kindergarten.id, extra.id, a.group.id, a.schoolYear.id, "ENDED");

    const res = await request(server()).get("/v1/groups").set("Cookie", adminA.cookies);
    const group = res.body.items.find((g: { id: string }) => g.id === a.group.id);

    // One active (from the scenario) plus one ended — the ended one is history,
    // not a child in the room.
    expect(group._count.enrollments).toBe(1);
  });
});

describe("multiple kindergartens for one user", () => {
  it("an admin of two kindergartens sees both", async () => {
    await createMembership(a.adminUser.id, b.kindergarten.id, "ADMIN");
    const session = await login(app, a.adminUser.username);

    const res = await request(server()).get("/v1/kindergartens").set("Cookie", session.cookies);
    expect(res.body).toHaveLength(2);
  });

  it("a teacher in one kindergarten and a parent in another gets each role's scope", async () => {
    // The case that makes Role a property of Membership rather than User.
    const dual = await createUser({ username: uniq("dual") });
    const teacherMembership = await createMembership(dual.id, a.kindergarten.id, "TEACHER");
    await assignTeacher(a.kindergarten.id, a.group.id, teacherMembership.id);
    await createMembership(dual.id, b.kindergarten.id, "PARENT");

    const session = await login(app, dual.username);

    const kindergartens = await request(server())
      .get("/v1/kindergartens")
      .set("Cookie", session.cookies);
    expect(kindergartens.body).toHaveLength(2);

    // Teacher in A, so A's group is visible…
    expect(
      (await request(server()).get(`/v1/groups/${a.group.id}`).set("Cookie", session.cookies))
        .status,
    ).toBe(200);

    // …but only a parent in B, so B's group is not.
    expect(
      (await request(server()).get(`/v1/groups/${b.group.id}`).set("Cookie", session.cookies))
        .status,
    ).toBe(404);
  });
});

describe("isolation holds in BOTH directions", () => {
  it("admin B cannot reach any of A's tenant resources", async () => {
    // Tested from B's side as well as A's. An asymmetric bug — where the scope
    // filter happens to work one way because of fixture ordering — passes a
    // one-directional suite and fails in production the moment the second
    // kindergarten is the one making the request.
    const results = await Promise.all([
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}`).set("Cookie", adminB.cookies),
      request(server()).get(`/v1/groups/${a.group.id}`).set("Cookie", adminB.cookies),
      request(server())
        .get(`/v1/kindergartens/${a.kindergarten.id}/school-years`)
        .set("Cookie", adminB.cookies),
      authed(request(server()).patch(`/v1/groups/${a.group.id}`), adminB).send({ name: "Хулгай" }),
      authed(request(server()).delete(`/v1/groups/${a.group.id}`), adminB),
      authed(request(server()).post(`/v1/groups/${a.group.id}/teachers`), adminB).send({
        membershipId: b.teacherMembership.id,
      }),
      authed(request(server()).patch(`/v1/school-years/${a.schoolYear.id}`), adminB).send({
        isCurrent: true,
      }),
    ]);

    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404]);
  });

  it("admin B's group list contains only B's groups", async () => {
    const res = await request(server()).get("/v1/groups").set("Cookie", adminB.cookies);
    expect(res.body.items.map((g: { id: string }) => g.id)).toEqual([b.group.id]);
  });
});

describe("school year isolation", () => {
  it("filters groups by school year", async () => {
    const oldYear = await createSchoolYear(a.kindergarten.id, false);
    await createGroup(a.kindergarten.id, oldYear.id, "Хуучин бүлэг");

    const res = await request(server())
      .get(`/v1/groups?schoolYearId=${a.schoolYear.id}`)
      .set("Cookie", adminA.cookies);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(a.group.id);
  });
});
