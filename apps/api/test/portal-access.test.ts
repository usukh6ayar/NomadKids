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
 * The portal access fee's gate — client instruction, 2026-09-01: QPay charges
 * parents for the right to use the site, and nothing else.
 *
 * ★ This file is where the one decision that departs from `docs/SECURITY.md`
 * §5.4 is held to account. Everywhere else in the product an unauthorized
 * child is a 404; here an unpaid guardian is a **402**, because they are the
 * right person asking about the right child and a 404 would hide the one fact
 * that lets them fix it. The tests below prove that the 402 is reachable only
 * *after* authorization has already succeeded — a stranger still gets 404, so
 * the status difference can never be used to ask "does this child exist".
 */

// The gate only exists when a price is set. `test/setup.ts` pins "0" for the
// rest of the suite; this file is one of two that turn it on.
process.env.ACCESS_FEE_AMOUNT = "15000.00";

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let parent: AuthSession;
let teacher: AuthSession;
let admin: AuthSession;
let accountant: AuthSession;

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

  const accUser = await createUser({ username: uniq("acct") });
  await createMembership(accUser.id, a.kindergarten.id, "ACCOUNTANT");
  accountant = await login(app, accUser.username);

  parent = await login(app, a.parentUser.username);
  teacher = await login(app, a.teacherUser.username);
  admin = await login(app, a.adminUser.username);
});

/** The kindergarten's current school year, which a subscription hangs off. */
async function currentYearId(scenario: Scenario): Promise<string> {
  const year = await db.schoolYear.findFirstOrThrow({
    where: { kindergartenId: scenario.kindergarten.id, isCurrent: true, deletedAt: null },
  });
  return year.id;
}

async function paidSubscription(scenario: Scenario, over: Record<string, unknown> = {}) {
  return db.accessSubscription.create({
    data: {
      kindergartenId: scenario.kindergarten.id,
      childId: scenario.child.id,
      schoolYearId: await currentYearId(scenario),
      amount: "15000.00",
      status: "ACTIVE",
      paidAt: new Date(),
      expiresAt: new Date("2099-05-31"),
      ...over,
    } as never,
  });
}

const readChild = (childId: string, actor: AuthSession) =>
  authed(request(server()).get(`/v1/children/${childId}`), actor);

describe("the gate", () => {
  it("refuses an unpaid guardian with 402, not 404 — they must be told what to do", async () => {
    const res = await readChild(a.child.id, parent);

    expect(res.status).toBe(402);
    expect(res.body.detail).toContain("хандалтын төлбөр");
  });

  it("lets the same guardian through once the fee is paid", async () => {
    await paidSubscription(a);

    const res = await readChild(a.child.id, parent);

    expect(res.status).toBe(200);
  });

  it("refuses again once the school year the fee was paid for has ended", async () => {
    // ★ `expiresAt` is frozen from the school year at issue, so this is what
    // "one child, one school year" actually means at the gate.
    await paidSubscription(a, { expiresAt: new Date("2020-05-31") });

    expect((await readChild(a.child.id, parent)).status).toBe(402);
  });

  it("ignores a subscription that was raised but never paid", async () => {
    await paidSubscription(a, { status: "UNPAID", paidAt: null });

    expect((await readChild(a.child.id, parent)).status).toBe(402);
  });
});

describe("who the gate does NOT apply to", () => {
  it("lets a teacher work regardless — a family's unpaid fee must not break the classroom", async () => {
    expect((await readChild(a.child.id, teacher)).status).toBe(200);
  });

  it("lets an admin through", async () => {
    expect((await readChild(a.child.id, admin)).status).toBe(200);
  });
});

describe("the 402 never becomes an oracle", () => {
  it("still answers 404 to a stranger, paid or not — the fee cannot confirm a child exists", async () => {
    // ★★ The discriminating case for the whole design. If the gate ran before
    // authorization, another family's guardian would get 402 here and learn
    // that `a.child.id` is a real child. Authorization first, always.
    const otherParent = await login(app, b.parentUser.username);

    expect((await readChild(a.child.id, otherParent)).status).toBe(404);

    await paidSubscription(a);
    expect((await readChild(a.child.id, otherParent)).status).toBe(404);
  });

  it("answers 404 for a child that does not exist, not 402", async () => {
    const res = await readChild("00000000-0000-0000-0000-000000000000", parent);
    expect(res.status).toBe(404);
  });
});

describe("the unlock screen stays reachable", () => {
  it("tells an unpaid guardian what they owe rather than refusing them", async () => {
    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/access`), parent);

    expect(res.status).toBe(200);
    expect(res.body.required).toBe(true);
    expect(res.body.active).toBe(false);
    expect(res.body.amount).toBe("15000.00");
  });

  it("reports an active subscription with the school year it covers", async () => {
    await paidSubscription(a);

    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/access`), parent);

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.subscription.status).toBe("ACTIVE");
  });

  it("refuses a teacher — a family's subscription is not classroom business", async () => {
    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/access`), teacher);
    expect(res.status).toBe(404);
  });

  it("admits the accountant, who may take a payment on a family's behalf", async () => {
    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/access`),
      accountant,
    );
    expect(res.status).toBe(200);
  });

  it("raises exactly one subscription per child per school year, however often it is asked", async () => {
    const first = await authed(request(server()).post(`/v1/children/${a.child.id}/access`), parent);
    const second = await authed(
      request(server()).post(`/v1/children/${a.child.id}/access`),
      parent,
    );

    expect(first.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await db.accessSubscription.count({ where: { childId: a.child.id } })).toBe(1);
  });
});
