import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  authed,
  createScenario,
  createUser,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * The platform operator's income and its distribution.
 *
 * ★ The security property under test is narrower than "superadmin only", and
 * it is the one worth writing down: **the platform sees totals, never the rows
 * behind them.**
 *
 * `platform-access.service.ts` records that `isSuperAdmin` grants registering
 * kindergartens and nothing else — a platform operator does not read children.
 * A `FundingCalculation` carries a child's id, how many days they attended and
 * what they were billed, so an endpoint that returned those would be child data
 * arriving through a money-shaped door. The aggregate is the platform's
 * business; the rows are the kindergarten's, and `/kindergartens/:id/funding`
 * is where its administrator reads them.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let operator: AuthSession;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;

const server = () => app.getHttpServer();
const MONTH = "2026-08";
const FIRST = new Date(Date.UTC(2026, 7, 1));

/**
 * A funding row, as `calculateMonth` would have written it.
 *
 * ★ This is the **kindergarten's** money — what the state paid them. It is
 * deliberately not what a revenue share is computed from; `payAccessFee` below
 * is. See the correction note on `distribution` further down.
 */
async function fund(
  scenario: Scenario,
  amounts: { calculated: string; approved?: string; received?: string },
) {
  return db.fundingCalculation.create({
    data: {
      kindergartenId: scenario.kindergarten.id,
      childId: scenario.child.id,
      source: "STATE",
      month: FIRST,
      daysAttended: 20,
      daysFed: 20,
      dailyRate: "2500",
      calculatedAmount: amounts.calculated,
      approvedAmount: amounts.approved ?? null,
      receivedAmount: amounts.received ?? null,
    },
  });
}

/**
 * A paid portal access fee — the **platform's** own income.
 *
 * ★ `paidAt` inside the month under test, and `status` left as whatever the
 * subscription's school year implies. The aggregate filters on `paidAt`, not
 * on status, precisely so that an `EXPIRED` subscription still counts towards
 * the month its money actually arrived in.
 */
async function payAccessFee(
  scenario: Scenario,
  amount: string,
  paidAt = new Date(Date.UTC(2026, 7, 15)),
) {
  return db.accessSubscription.create({
    data: {
      kindergartenId: scenario.kindergarten.id,
      childId: scenario.child.id,
      schoolYearId: scenario.schoolYear.id,
      amount,
      status: "ACTIVE",
      paidAt,
      expiresAt: new Date(Date.UTC(2027, 5, 30)),
    },
  });
}

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData(db);
  // Four logins per test against a limiter that counts by identifier — the
  // same reset `artwork.test.ts` and `chat.test.ts` do, and for the same reason.
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  const superUser = await createUser({ username: "platform-money", isSuperAdmin: true });
  operator = await login(app, superUser.username);
  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
});

// ═══════════════════════════════════════════════════════════════════════════
// Who may look
// ═══════════════════════════════════════════════════════════════════════════

describe("access", () => {
  const routes = [
    { method: "get" as const, path: `/v1/platform/revenue?month=${MONTH}` },
    { method: "get" as const, path: `/v1/platform/revenue/distribution?month=${MONTH}` },
    { method: "get" as const, path: "/v1/platform/partners" },
  ];

  it.each([
    ["a kindergarten admin", () => adminA],
    ["a teacher", () => teacherA],
    ["a parent", () => parentA],
  ])("refuses %s with 404", async (_label, session) => {
    for (const route of routes) {
      const res = await authed(request(server())[route.method](route.path), session());
      expect(res.status, route.path).toBe(404);
    }
  });

  it("refuses an unauthenticated request", async () => {
    const res = await request(server()).get(`/v1/platform/revenue?month=${MONTH}`);
    expect(res.status).toBe(401);
  });

  it("lets the operator through", async () => {
    for (const route of routes) {
      const res = await authed(request(server())[route.method](route.path), operator);
      expect(res.status, route.path).toBe(200);
    }
  });

  /** Writing a share is the operator's alone, as reading is. */
  it("refuses a kindergarten admin creating a partner", async () => {
    const res = await authed(request(server()).post("/v1/platform/partners"), adminA).send({
      name: "Тест",
      sharePercent: "50",
      effectiveFrom: "2026-01-01",
    });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Income
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /platform/revenue", () => {
  it("reports the two pots separately — the platform's own income, and the state's", async () => {
    await fund(a, { calculated: "500000", approved: "500000", received: "500000" });
    await fund(b, { calculated: "900000", approved: "900000", received: "900000" });
    await payAccessFee(a, "15000");
    await payAccessFee(b, "9000");

    const res = await authed(
      request(server()).get(`/v1/platform/revenue?month=${MONTH}`),
      operator,
    );

    expect(res.status).toBe(200);
    expect(res.body.kindergartens).toHaveLength(2);

    /*
      ★★★ The correction of 2026-09-02.

      `state` is what the state paid the kindergartens — their money.
      `platform` is what the platform itself earned — access fees. They used to
      be one set of figures called `totals`, and the payout list divided the
      state's. A partner was being shown a share of income the platform never
      receives, while the income it does receive was on no screen at all.
    */
    expect(res.body.state.received).toBe("1400000.00");
    expect(res.body.platform.accessFees).toBe("24000.00");
    expect(res.body.platform.accessPayments).toBe(2);

    // Ordered by what each kindergarten paid **us**, not by their state transfer.
    expect(res.body.kindergartens[0].name).toBe(a.kindergarten.name);
    expect(res.body.kindergartens[0].accessFees).toBe("15000");
    /*
      ★ Two decimals, always — the totals and the distribution now agree.

      They did not before: the totals came from Prisma's `Decimal.toString()`
      ("1400000") while the distribution used `toFixed(2)` ("1400000.00"), so
      one screen showed money two ways. Both go through `common/money.ts` now,
      which exists because §2.2 refuses a Prisma import in a service — see its
      own note. The client's `money()` trims the fraction for display.
    */
  });

  /**
   * ★ The assertion this file exists for.
   *
   * Not "the response happens not to include a child today" — that a
   * `childId`, a name or an attendance count cannot appear in it at all. The
   * repository's `groupBy` never selects them, so this fails the day somebody
   * widens the query rather than the day somebody notices.
   */
  it("never exposes a child, or anything about one", async () => {
    await fund(a, { calculated: "500000", received: "500000" });

    const res = await authed(
      request(server()).get(`/v1/platform/revenue?month=${MONTH}`),
      operator,
    );

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(a.child.id);
    expect(body).not.toContain(a.child.firstName);
    expect(body).not.toContain("daysAttended");
    expect(body).not.toContain("childId");
  });

  it("reports a month with nothing in it as zero, not as an error", async () => {
    const res = await authed(request(server()).get("/v1/platform/revenue?month=2026-01"), operator);

    expect(res.status).toBe(200);
    expect(res.body.kindergartens).toEqual([]);
    expect(res.body.state.received).toBe("0.00");
    expect(res.body.platform.accessFees).toBe("0.00");
    expect(res.body.platform.accessPayments).toBe(0);
  });

  it("refuses a malformed month", async () => {
    const res = await authed(request(server()).get("/v1/platform/revenue?month=август"), operator);
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Shares
// ═══════════════════════════════════════════════════════════════════════════

describe("partners", () => {
  const partner = (over: Record<string, unknown> = {}) => ({
    name: "Ганбат",
    sharePercent: "60",
    effectiveFrom: "2026-01-01",
    ...over,
  });

  it("creates and lists a share", async () => {
    const created = await authed(request(server()).post("/v1/platform/partners"), operator).send(
      partner(),
    );

    expect(created.status).toBe(201);
    expect(created.body.sharePercent).toBe("60");

    const list = await authed(request(server()).get("/v1/platform/partners"), operator);
    expect(list.body).toHaveLength(1);
  });

  /**
   * ★ The check that stops a month paying out more than it received.
   *
   * Accepting it and warning is the alternative, and it is how a distribution
   * screen ends up handing out 115% of the income.
   */
  it("refuses a share that takes the total past 100%", async () => {
    await authed(request(server()).post("/v1/platform/partners"), operator)
      .send(partner({ name: "Ганбат", sharePercent: "60" }))
      .expect(201);

    const second = await authed(request(server()).post("/v1/platform/partners"), operator).send(
      partner({ name: "Сараа", sharePercent: "50" }),
    );

    expect(second.status).toBe(400);
    expect(second.body.detail ?? second.body.title).toMatch(/100/);
  });

  it("allows a replacement share the day the old one closes", async () => {
    const first = await authed(request(server()).post("/v1/platform/partners"), operator)
      .send(partner({ sharePercent: "60" }))
      .expect(201);

    await authed(request(server()).patch(`/v1/platform/partners/${first.body.id}`), operator)
      .send({ effectiveTo: "2026-05-31" })
      .expect(200);

    // 60% + 70% would break the rule while both ran; the first one has ended.
    const replacement = await authed(
      request(server()).post("/v1/platform/partners"),
      operator,
    ).send(partner({ name: "Ганбат", sharePercent: "70", effectiveFrom: "2026-06-01" }));

    expect(replacement.status).toBe(201);
  });

  /**
   * ★ The percentage is not editable, by construction.
   *
   * `updatePartnerSchema` is `.strict()`, so the field is rejected rather than
   * silently ignored — which is the difference between a rule and a hope. A
   * month's distribution is evidence of the split it was paid under.
   */
  it("refuses to edit a percentage in place", async () => {
    const created = await authed(request(server()).post("/v1/platform/partners"), operator)
      .send(partner())
      .expect(201);

    const res = await authed(
      request(server()).patch(`/v1/platform/partners/${created.body.id}`),
      operator,
    ).send({ sharePercent: "90" });

    expect(res.status).toBe(400);
  });

  it("soft-deletes rather than removing the record", async () => {
    const created = await authed(request(server()).post("/v1/platform/partners"), operator)
      .send(partner())
      .expect(201);

    await authed(
      request(server()).delete(`/v1/platform/partners/${created.body.id}`),
      operator,
    ).expect(204);

    const row = await db.revenuePartner.findUnique({ where: { id: created.body.id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();

    const list = await authed(request(server()).get("/v1/platform/partners"), operator);
    expect(list.body).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The split
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /platform/revenue/distribution", () => {
  async function share(name: string, percent: string) {
    return authed(request(server()).post("/v1/platform/partners"), operator)
      .send({ name, sharePercent: percent, effectiveFrom: "2026-01-01" })
      .expect(201);
  }

  it("divides the platform's access-fee income by the agreed shares", async () => {
    await payAccessFee(a, "600000");
    await payAccessFee(b, "400000");
    await share("Ганбат", "60");
    await share("Сараа", "40");

    const res = await authed(
      request(server()).get(`/v1/platform/revenue/distribution?month=${MONTH}`),
      operator,
    );

    expect(res.status).toBe(200);
    expect(res.body.accessFees).toBe("1000000.00");
    expect(res.body.accessPayments).toBe(2);
    expect(res.body.shares).toHaveLength(2);
    expect(res.body.shares.find((s: { name: string }) => s.name === "Ганбат").amount).toBe(
      "600000.00",
    );
    expect(res.body.shares.find((s: { name: string }) => s.name === "Сараа").amount).toBe(
      "400000.00",
    );
    expect(res.body.unallocated).toBe("0.00");
  });

  /**
   * ★★★ The whole correction, as one assertion.
   *
   * A kindergarten that received a million in state funding and has paid the
   * platform nothing produces a payout of **zero**. Before 2026-09-02 this
   * test would have paid the partner 500,000₮ out of money the platform never
   * touched.
   */
  it("does not divide the state's funding — that is the kindergarten's money", async () => {
    await fund(a, { calculated: "1000000", approved: "1000000", received: "1000000" });
    await share("Ганбат", "50");

    const res = await authed(
      request(server()).get(`/v1/platform/revenue/distribution?month=${MONTH}`),
      operator,
    );

    expect(res.body.accessFees).toBe("0.00");
    expect(res.body.shares[0].amount).toBe("0.00");
  });

  /**
   * ★ Only money that has arrived.
   *
   * An `UNPAID` subscription is a fee that was raised, not one that was paid —
   * `нэмэлт.md` §8's own rule that a QR nobody has scanned is not money that
   * moved. `paidAt` is null on one, and the aggregate filters on `paidAt`.
   */
  it("ignores an access fee that was raised but never paid", async () => {
    await db.accessSubscription.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        schoolYearId: a.schoolYear.id,
        amount: "1000000",
        status: "UNPAID",
        paidAt: null,
        expiresAt: new Date(Date.UTC(2027, 5, 30)),
      },
    });
    await share("Ганбат", "50");

    const res = await authed(
      request(server()).get(`/v1/platform/revenue/distribution?month=${MONTH}`),
      operator,
    );

    expect(res.body.accessFees).toBe("0.00");
    expect(res.body.shares[0].amount).toBe("0.00");
  });

  /**
   * ★★ Filtered on `paidAt`, never on `status`.
   *
   * A subscription becomes `EXPIRED` when its school year ends. Filtering on
   * `ACTIVE` would make last year's income vanish out of last year's report
   * the moment the year turned over — a partner's past payout silently
   * rewritten by the passage of time.
   */
  it("still counts a fee whose subscription has since expired", async () => {
    await db.accessSubscription.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        schoolYearId: a.schoolYear.id,
        amount: "50000",
        status: "EXPIRED",
        paidAt: new Date(Date.UTC(2026, 7, 10)),
        expiresAt: new Date(Date.UTC(2026, 7, 20)),
      },
    });
    await share("Ганбат", "100");

    const res = await authed(
      request(server()).get(`/v1/platform/revenue/distribution?month=${MONTH}`),
      operator,
    );

    expect(res.body.accessFees).toBe("50000.00");
    expect(res.body.shares[0].amount).toBe("50000.00");
  });

  /**
   * ★ What the shares do not cover is reported, not hidden.
   *
   * A split that quietly loses 30% of a month is the failure this screen exists
   * to prevent — the operator should see the remainder and decide, rather than
   * find it missing from a bank reconciliation later.
   */
  it("reports the unallocated remainder when the shares are under 100%", async () => {
    await payAccessFee(a, "1000000");
    await share("Ганбат", "70");

    const res = await authed(
      request(server()).get(`/v1/platform/revenue/distribution?month=${MONTH}`),
      operator,
    );

    expect(res.body.allocatedPercent).toBe("70");
    expect(res.body.shares[0].amount).toBe("700000.00");
    expect(res.body.unallocated).toBe("300000.00");
  });

  it("has nothing to divide, and says so, when no share is agreed", async () => {
    await payAccessFee(a, "500000");

    const res = await authed(
      request(server()).get(`/v1/platform/revenue/distribution?month=${MONTH}`),
      operator,
    );

    expect(res.body.shares).toEqual([]);
    expect(res.body.unallocated).toBe("500000.00");
  });

  /** A share that had already ended does not take a cut of a later month. */
  it("excludes a share that closed before the month", async () => {
    await payAccessFee(a, "500000");
    const created = await share("Ганбат", "50");
    await authed(request(server()).patch(`/v1/platform/partners/${created.body.id}`), operator)
      .send({ effectiveTo: "2026-07-31" })
      .expect(200);

    const res = await authed(
      request(server()).get(`/v1/platform/revenue/distribution?month=${MONTH}`),
      operator,
    );

    expect(res.body.shares).toEqual([]);
  });
});
