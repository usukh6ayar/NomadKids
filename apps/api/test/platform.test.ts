import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createScenario,
  createUser,
  login,
  TEST_PASSWORD,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Platform routes — through HTTP.
 *
 * Two things are under test and the second matters more than the first: that a
 * platform operator can register a kindergarten, and that being one grants
 * *nothing else*. CLAUDE.md §4.1.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
// A second, independent kindergarten. Task 6 asserts on it; declared now so the
// fixture setup below is final.
let b: Scenario;
let superadmin: AuthSession;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;

/** A valid create body, with unique identifiers so cases never collide. */
function createBody(overrides: Record<string, unknown> = {}) {
  return {
    name: `Цэцэрлэг ${uniq()}`,
    address: "Улаанбаатар, Сүхбаатар дүүрэг",
    phone: "99112233",
    email: null,
    description: null,
    admin: {
      username: uniq("director"),
      email: null,
      phone: null,
      lastName: "Дорж",
      firstName: "Болд",
    },
    ...overrides,
  };
}

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

  const operator = await createUser({ username: uniq("super"), isSuperAdmin: true });
  superadmin = await login(app, operator.username);
  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
});

describe("POST /platform/kindergartens", () => {
  it("registers a kindergarten with its first director", async () => {
    const body = createBody();

    const res = await authed(
      request(app.getHttpServer()).post("/v1/platform/kindergartens"),
      superadmin,
    ).send(body);

    expect(res.status).toBe(201);
    expect(res.body.kindergarten.name).toBe(body.name);
    expect(res.body.admin.username).toBe(body.admin.username);
    expect(typeof res.body.invitationToken).toBe("string");

    const membership = await db.membership.findFirst({
      where: { kindergartenId: res.body.kindergarten.id },
    });
    expect(membership?.role).toBe("ADMIN");
    expect(membership?.userId).toBe(res.body.admin.id);

    const token = await db.authToken.findFirst({ where: { userId: res.body.admin.id } });
    expect(token?.purpose).toBe("INVITATION");
  });

  it("lets the invited director set a password and log in as an ADMIN", async () => {
    const body = createBody();
    const created = await authed(
      request(app.getHttpServer()).post("/v1/platform/kindergartens"),
      superadmin,
    ).send(body);

    const accepted = await request(app.getHttpServer())
      .post("/v1/auth/invitation/accept")
      .send({ token: created.body.invitationToken, password: TEST_PASSWORD });
    expect(accepted.status).toBeLessThan(300);

    const director = await login(app, body.admin.username);
    const groups = await request(app.getHttpServer())
      .get(`/v1/groups?kindergartenId=${created.body.kindergarten.id}`)
      .set("Cookie", director.cookies);

    expect(groups.status).toBe(200);
  });

  it("refuses a duplicate username with 409 and creates no kindergarten", async () => {
    const body = createBody({ admin: { ...createBody().admin, username: a.adminUser.username } });

    const res = await authed(
      request(app.getHttpServer()).post("/v1/platform/kindergartens"),
      superadmin,
    ).send(body);

    expect(res.status).toBe(409);
    expect(await db.kindergarten.findFirst({ where: { name: body.name } })).toBeNull();
  });

  it.each([
    ["a kindergarten admin", () => adminA],
    ["a teacher", () => teacherA],
    ["a parent", () => parentA],
  ])("refuses %s with 404", async (_label, session) => {
    const res = await authed(
      request(app.getHttpServer()).post("/v1/platform/kindergartens"),
      session(),
    ).send(createBody());

    expect(res.status).toBe(404);
  });

  it("refuses an unauthenticated request", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/platform/kindergartens")
      .send(createBody());

    expect(res.status).toBe(401);
  });
});

describe("GET /platform/kindergartens", () => {
  it("lists every kindergarten, not just the operator's", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/platform/kindergartens")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((k: { id: string }) => k.id);
    expect(ids).toContain(a.kindergarten.id);
    expect(ids).toContain(b.kindergarten.id);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it("filters by name", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/platform/kindergartens?q=${encodeURIComponent(a.kindergarten.name)}`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(a.kindergarten.id);
  });

  it("filters by isActive, and ?isActive=false means inactive", async () => {
    await db.kindergarten.update({
      where: { id: b.kindergarten.id },
      data: { isActive: false },
    });

    const res = await request(app.getHttpServer())
      .get("/v1/platform/kindergartens?isActive=false")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    expect(res.body.items.map((k: { id: string }) => k.id)).toEqual([b.kindergarten.id]);
  });

  it.each([
    ["a kindergarten admin", () => adminA],
    ["a teacher", () => teacherA],
    ["a parent", () => parentA],
  ])("refuses %s with 404", async (_label, session) => {
    const res = await request(app.getHttpServer())
      .get("/v1/platform/kindergartens")
      .set("Cookie", session().cookies);

    expect(res.status).toBe(404);
  });
});

describe("GET /platform/kindergartens/:id", () => {
  it("returns the kindergarten with its live counts", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/platform/kindergartens/${a.kindergarten.id}`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(a.kindergarten.id);
    // createScenario builds one group, one active enrollment and three
    // memberships (admin, teacher, parent).
    expect(res.body._count).toEqual({ groups: 1, enrollments: 1, memberships: 3 });
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/platform/kindergartens/00000000-0000-4000-8000-000000000000")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(404);
  });

  it("refuses a kindergarten admin with 404 — even for their own kindergarten", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/platform/kindergartens/${a.kindergarten.id}`)
      .set("Cookie", adminA.cookies);

    expect(res.status).toBe(404);
  });
});

describe("PATCH /platform/kindergartens/:id", () => {
  it("deactivates a kindergarten without deleting it", async () => {
    const res = await authed(
      request(app.getHttpServer()).patch(`/v1/platform/kindergartens/${b.kindergarten.id}`),
      superadmin,
    ).send({ isActive: false });

    expect(res.status).toBe(200);

    const row = await db.kindergarten.findUnique({ where: { id: b.kindergarten.id } });
    expect(row?.isActive).toBe(false);
    expect(row?.deletedAt).toBeNull();
  });

  it("refuses a kindergarten admin with 404", async () => {
    const res = await authed(
      request(app.getHttpServer()).patch(`/v1/platform/kindergartens/${a.kindergarten.id}`),
      adminA,
    ).send({ name: "Дур мэдэн өөрчилсөн" });

    expect(res.status).toBe(404);

    const row = await db.kindergarten.findUnique({ where: { id: a.kindergarten.id } });
    expect(row?.name).toBe(a.kindergarten.name);
  });
});

describe("unauthenticated access", () => {
  it("refuses every platform route with 401", async () => {
    const server = request(app.getHttpServer());
    const id = a.kindergarten.id;

    const responses = await Promise.all([
      server.get("/v1/platform/kindergartens"),
      server.get(`/v1/platform/kindergartens/${id}`),
      request(app.getHttpServer()).patch(`/v1/platform/kindergartens/${id}`).send({ name: "X" }),
    ]);

    expect(responses.map((r) => r.status)).toEqual([401, 401, 401]);
  });
});
