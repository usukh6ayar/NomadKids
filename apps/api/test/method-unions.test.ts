import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  authed,
  createMembership,
  createScenario,
  createSchoolYear,
  createUser,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { uniq } from "./support/db";

/**
 * «Заах аргын нэгдэл» — teaching-method unions.
 *
 * What these pin: administrator-only, another kindergarten's union or seat is
 * a 404 (CLAUDE.md §1.7), and a lead or member has to be an active teacher of
 * the union's own kindergarten — the id is a client's claim, and a foreign one
 * must never be stored.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let adminB: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;

const server = () => app.getHttpServer();

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  adminA = await login(app, a.adminUser.username);
  adminB = await login(app, b.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
});

function createUnion(session: AuthSession, body: Record<string, unknown> = {}) {
  return authed(
    request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/method-unions`),
    session,
  ).send({
    name: "Хэл ярианы нэгдэл",
    schoolYearId: a.schoolYear.id,
    leadMembershipId: a.teacherMembership.id,
    startsOn: "2025-09-01",
    ...body,
  });
}

async function unionWithMember() {
  const union = await createUnion(adminA);
  expect(union.status).toBe(201);
  const seat = await authed(
    request(server()).post(`/v1/method-unions/${union.body.id}/members`),
    adminA,
  ).send({ membershipId: a.teacherMembership.id });
  expect(seat.status).toBe(201);
  return { union: union.body, seat: seat.body };
}

describe("the administrator's own kindergarten", () => {
  it("creates a union with a lead, adds a member, and audits both", async () => {
    const { union, seat } = await unionWithMember();

    expect(union.lead).toMatchObject({ membershipId: a.teacherMembership.id });
    expect(union.schoolYear.id).toBe(a.schoolYear.id);

    const detail = await authed(request(server()).get(`/v1/method-unions/${union.id}`), adminA);
    expect(detail.status).toBe(200);
    expect(detail.body.memberCount).toBe(1);
    expect(detail.body.members).toEqual([
      expect.objectContaining({ id: seat.id, membershipId: a.teacherMembership.id }),
    ]);

    const audits = await db.auditLog.findMany({
      where: { objectType: { in: ["MethodUnion", "MethodUnionMember"] } },
      select: { action: true, objectType: true },
    });
    expect(audits).toEqual(
      expect.arrayContaining([
        { action: "CREATE", objectType: "MethodUnion" },
        { action: "CREATE", objectType: "MethodUnionMember" },
      ]),
    );
  });

  it("refuses the same teacher twice, and takes them back after removal", async () => {
    const { union, seat } = await unionWithMember();
    const add = () =>
      authed(request(server()).post(`/v1/method-unions/${union.id}/members`), adminA).send({
        membershipId: a.teacherMembership.id,
      });

    expect((await add()).status).toBe(409);

    const removed = await authed(
      request(server()).delete(`/v1/method-union-members/${seat.id}`),
      adminA,
    );
    expect(removed.status).toBe(200);

    // The partial unique index is what lets a soft-deleted seat be filled again.
    expect((await add()).status).toBe(201);
  });

  it("paginates, and filters by name and by school year", async () => {
    const otherYear = await createSchoolYear(a.kindergarten.id, false);
    for (const name of ["Математик", "Хэл яриа", "Урлаг"]) {
      expect((await createUnion(adminA, { name, leadMembershipId: null })).status).toBe(201);
    }
    expect(
      (await createUnion(adminA, { name: "Хэл зохиол", schoolYearId: otherYear.id })).status,
    ).toBe(201);

    const list = (query: string) =>
      authed(
        request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/method-unions?${query}`),
        adminA,
      );

    const page = await list("pageSize=2&page=2");
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ total: 4, totalPages: 2, page: 2 });
    expect(page.body.items).toHaveLength(2);

    const byName = await list("q=хэл");
    expect(byName.body.items.map((u: { name: string }) => u.name).sort()).toEqual([
      "Хэл зохиол",
      "Хэл яриа",
    ]);

    const byYear = await list(`schoolYearId=${otherYear.id}`);
    expect(byYear.body.items.map((u: { name: string }) => u.name)).toEqual(["Хэл зохиол"]);
  });

  it("drops a deleted union from the list and from its own route", async () => {
    const { union } = await unionWithMember();

    expect(
      (await authed(request(server()).delete(`/v1/method-unions/${union.id}`), adminA)).status,
    ).toBe(200);

    expect(
      (await authed(request(server()).get(`/v1/method-unions/${union.id}`), adminA)).status,
    ).toBe(404);
    const list = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/method-unions`),
      adminA,
    );
    expect(list.body.total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Authorization — CLAUDE.md §4.1
// ═══════════════════════════════════════════════════════════════════════════

describe("authorization", () => {
  it("another kindergarten's administrator gets 404 on every route", async () => {
    const { union, seat } = await unionWithMember();

    const responses = await Promise.all([
      authed(request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/method-unions`), adminB),
      authed(
        request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/method-unions`),
        adminB,
      ).send({ name: "x", schoolYearId: a.schoolYear.id, startsOn: "2025-09-01" }),
      authed(request(server()).get(`/v1/method-unions/${union.id}`), adminB),
      authed(request(server()).patch(`/v1/method-unions/${union.id}`), adminB).send({
        name: "Өөр",
      }),
      authed(request(server()).post(`/v1/method-unions/${union.id}/members`), adminB).send({
        membershipId: b.teacherMembership.id,
      }),
      authed(request(server()).delete(`/v1/method-union-members/${seat.id}`), adminB),
      authed(request(server()).delete(`/v1/method-unions/${union.id}`), adminB),
    ]);

    expect(responses.map((res) => res.status)).toEqual([404, 404, 404, 404, 404, 404, 404]);
    expect(await db.methodUnion.findUniqueOrThrow({ where: { id: union.id } })).toMatchObject({
      name: "Хэл ярианы нэгдэл",
      deletedAt: null,
    });
  });

  it("a teacher and a guardian of the same kindergarten get 404", async () => {
    const { union } = await unionWithMember();

    for (const session of [teacherA, parentA]) {
      const list = await authed(
        request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/method-unions`),
        session,
      );
      const detail = await authed(request(server()).get(`/v1/method-unions/${union.id}`), session);
      const create = await createUnion(session);
      expect([list.status, detail.status, create.status]).toEqual([404, 404, 404]);
    }
  });

  it("refuses another kindergarten's teacher as a member or as the lead", async () => {
    const { union } = await unionWithMember();

    const member = await authed(
      request(server()).post(`/v1/method-unions/${union.id}/members`),
      adminA,
    ).send({ membershipId: b.teacherMembership.id });
    expect(member.status).toBe(400);

    const lead = await authed(
      request(server()).patch(`/v1/method-unions/${union.id}`),
      adminA,
    ).send({ leadMembershipId: b.teacherMembership.id });
    expect(lead.status).toBe(400);

    expect(
      await db.methodUnionMember.count({ where: { membershipId: b.teacherMembership.id } }),
    ).toBe(0);
  });

  it("refuses a membership here that is not an active teacher", async () => {
    const { union } = await unionWithMember();
    const former = await createMembership(
      (await createUser({ username: uniq("former") })).id,
      a.kindergarten.id,
      "TEACHER",
    );
    await db.membership.update({ where: { id: former.id }, data: { isActive: false } });

    for (const membershipId of [a.adminMembership.id, former.id]) {
      const res = await authed(
        request(server()).post(`/v1/method-unions/${union.id}/members`),
        adminA,
      ).send({ membershipId });
      expect(res.status).toBe(400);
    }
  });
});
