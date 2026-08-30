import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createMembership,
  createScenario,
  createUser,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Тогооч and Нягтлан — the two staff roles added on 2026-08-30.
 *
 * ★ Most of this file asserts what they **cannot** reach, and that is the
 * point of it.
 *
 * A new role is easy to add and hard to keep narrow: `assertStaff` means
 * TEACHER or ADMIN and gates the teacher's whole surface, so the tempting
 * implementation — "they work here, call them staff" — hands a cook every
 * child's development record. Neither new role passes `assertStaff`. Each has
 * one predicate of its own: `assertCanManageMeals` and
 * `assertCanReadFinance`.
 *
 * 404 throughout, never 403 — §1.7 and `RolesGuard`'s own note.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let cook: AuthSession;
let accountant: AuthSession;
/** Employed by kindergarten B — the cross-tenant case. */
let accountantB: AuthSession;

const server = () => app.getHttpServer();

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  const cookUser = await createUser({ username: uniq("cook") });
  await createMembership(cookUser.id, a.kindergarten.id, "COOK");
  cook = await login(app, cookUser.username);

  const accUser = await createUser({ username: uniq("acct") });
  await createMembership(accUser.id, a.kindergarten.id, "ACCOUNTANT");
  accountant = await login(app, accUser.username);

  const accBUser = await createUser({ username: uniq("acct-b") });
  await createMembership(accBUser.id, b.kindergarten.id, "ACCOUNTANT");
  accountantB = await login(app, accBUser.username);
});

// ═══════════════════════════════════════════════════════════════════════════
// What neither of them may reach
// ═══════════════════════════════════════════════════════════════════════════

describe("neither role is staff", () => {
  /**
   * ★ The assertion the whole change turns on.
   *
   * Every route here is `assertStaff` or `canAccessChild`. If a future edit
   * adds COOK to `assertStaff` "so they can see the kitchen screen", this is
   * what fails — before a cook can read a child's observations.
   */
  const childSurface = () => [
    { label: "a child", path: `/v1/children/${a.child.id}` },
    { label: "a child's observations", path: `/v1/children/${a.child.id}/observations` },
    { label: "a child's portfolio", path: `/v1/children/${a.child.id}/portfolio` },
    { label: "a child's guardians", path: `/v1/children/${a.child.id}/guardians` },
    { label: "the group meal register", path: `/v1/groups/${a.group.id}/meals` },
    { label: "the group's assessment", path: `/v1/groups/${a.group.id}/assessment` },
  ];

  it.each([
    ["a cook", () => cook],
    ["an accountant", () => accountant],
  ])("refuses %s the whole child surface, with 404", async (_label, session) => {
    for (const route of childSurface()) {
      const res = await authed(request(server()).get(route.path), session());
      expect([404, 400], `${route.label} → ${route.path}`).toContain(res.status);
    }
  });

  /**
   * ★ The roster answers 200 with nothing in it, and that is correct.
   *
   * A list endpoint scopes by the kindergartens the actor may read children in
   * and neither role has any, so the scope is empty and the list is empty —
   * `adminKindergartenIds` makes the same argument about why an empty scope
   * must never be "optimised" into omitting the filter. Asserting emptiness
   * rather than 404 is what pins the distinction: the leak this guards against
   * is a row appearing, not a status code.
   */
  it.each([
    ["a cook", () => cook],
    ["an accountant", () => accountant],
  ])("shows %s an empty roster rather than anyone else's children", async (_label, session) => {
    const res = await authed(request(server()).get("/v1/children"), session());

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it.each([
    ["a cook", () => cook],
    ["an accountant", () => accountant],
  ])("refuses %s writing a notice", async (_label, session) => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      session(),
    ).send({ body: "Туршилт", targets: [] });

    expect(res.status).toBe(404);
  });

  it.each([
    ["a cook", () => cook],
    ["an accountant", () => accountant],
  ])("refuses %s the administration screens", async (_label, session) => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/users`),
      session(),
    );

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Тогооч — the kitchen
// ═══════════════════════════════════════════════════════════════════════════

describe("Тогооч", () => {
  const week = () => {
    const today = new Date().toISOString().slice(0, 10);
    return `from=${today}&to=${today}`;
  };

  it("reads the weekly menu with its allergy warnings", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/menu/with-warnings?${week()}`),
      cook,
    );

    expect(res.status).toBe(200);
  });

  it("writes a day of the menu", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/${today}`),
      cook,
    ).send({ dishes: [{ name: "Гурилтай шөл", kind: "LUNCH" }] });

    expect([200, 201]).toContain(res.status);
  });

  /** The kitchen is one kindergarten's. A cook cannot cook for another. */
  it("cannot read another kindergarten's menu", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${b.kindergarten.id}/menu/with-warnings?${week()}`),
      cook,
    );

    expect(res.status).toBe(404);
  });

  /** Money is not the kitchen's. */
  it("cannot read the funding rules", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/funding/rules`),
      cook,
    );

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Нягтлан — the ledger
// ═══════════════════════════════════════════════════════════════════════════

describe("Нягтлан", () => {
  it("reads their kindergarten's funding rules", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/funding/rules`),
      accountant,
    );

    expect(res.status).toBe(200);
  });

  it("reads the month's calculation", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/funding?month=2026-08`),
      accountant,
    );

    expect(res.status).toBe(200);
  });

  /**
   * ★ The check a `@Roles` decorator alone would not make.
   *
   * `@Roles("ADMIN", "ACCOUNTANT")` passes for any accountant anywhere. What
   * refuses this is `assertCanReadFinance` reading the membership against the
   * kindergarten in the URL — an accountant employed by B changing the id to
   * A's would otherwise read A's ledger.
   */
  it("cannot read another kindergarten's funding", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/funding/rules`),
      accountantB,
    );

    expect(res.status).toBe(404);
  });

  /**
   * ★★ The platform's money is not theirs either.
   *
   * `/platform/revenue` is the operator's income across every kindergarten and
   * how the partners divide it. It is behind `isSuperAdmin`, and an accountant
   * employed by one kindergarten has no business reading another's takings —
   * let alone the platform's.
   */
  it("cannot read the platform's revenue", async () => {
    const res = await authed(
      request(server()).get("/v1/platform/revenue?month=2026-08"),
      accountant,
    );

    expect(res.status).toBe(404);
  });

  /** The kitchen is not the ledger's. */
  it("cannot write the menu", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/${today}`),
      accountant,
    ).send({ dishes: [{ name: "Гурилтай шөл", kind: "LUNCH" }] });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chat
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ★ `roomsFor`'s one deliberate departure from `assertStaff`.
 *
 * The two answer different questions. `assertStaff` asks "may this person do
 * the teaching work" and correctly excludes both new roles. The staff room asks
 * "does this person work here", and the client listed "Бүх ажилтан" for both by
 * name.
 *
 * A group room is still out of reach: neither teaches a group nor guards a
 * child in one, so `roomsFor` returns no group for them without a special case.
 */
describe("chat", () => {
  it.each([
    ["a cook", () => cook],
    ["an accountant", () => accountant],
  ])("puts %s in the staff room and no group room", async (_label, session) => {
    const res = await authed(request(server()).get("/v1/chat/rooms"), session());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].kind).toBe("STAFF");
    expect(res.body[0].key).toBe(`staff:${a.kindergarten.id}`);
  });

  it("refuses a cook a group room they guessed the key of", async () => {
    const res = await authed(
      request(server()).get(`/v1/chat/rooms/group:${a.group.id}/messages`),
      cook,
    );

    expect(res.status).toBe(404);
  });

  it("refuses a cook another kindergarten's staff room", async () => {
    const res = await authed(
      request(server()).get(`/v1/chat/rooms/staff:${b.kindergarten.id}/messages`),
      cook,
    );

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Inviting one
// ═══════════════════════════════════════════════════════════════════════════

describe("an administrator hands out the roles", () => {
  let adminA: AuthSession;

  beforeEach(async () => {
    adminA = await login(app, a.adminUser.username);
  });

  const staff = (role: string, username: string) => ({
    username,
    lastName: "Дорж",
    firstName: "Болд",
    role,
  });

  it.each([["COOK"], ["ACCOUNTANT"]])("creates a %s", async (role) => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/users`),
      adminA,
    ).send(staff(role, uniq("new")));

    expect([200, 201]).toContain(res.status);

    const membership = await db.membership.findFirst({
      where: { kindergartenId: a.kindergarten.id, role: role as "COOK" },
    });
    expect(membership).not.toBeNull();
  });

  it("refuses a role that is not one of the five", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/users`),
      adminA,
    ).send(staff("CHEF", uniq("new")));

    expect(res.status).toBe(400);
  });
});
