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
 * The source filter on `/finance`, and what "run the month" means.
 *
 * ★ Reported 2026-09-09 as "эх үүсвэрийн filter ажиллахгүй байна", and it was
 * two separate faults wearing one control:
 *
 *  - `GET …/funding?source=` narrowed the **rows** and not the **totals**, so
 *    choosing one source showed its children under a footer that added up all
 *    of them — a screen contradicting itself in one glance.
 *  - The screen never sent the parameter at all. The select was local state
 *    inside the run card, used only as the body of the POST.
 *
 * ★★ The third case is the one that matters most and is the least obvious:
 * running "every source" must not touch a source that has no tariff in force.
 * `replaceMonth` soft-deletes the previous rows before writing new ones, so a
 * source included and then found ruleless would silently empty a month that was
 * correct yesterday.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let adminA: AuthSession;
let accountantA: AuthSession;

const MONTH = "2026-02";
const MONTH_START = new Date("2026-02-01T00:00:00.000Z");

function date(day: number): Date {
  return new Date(`2026-02-${String(day).padStart(2, "0")}T00:00:00.000Z`);
}

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
  adminA = await login(app, a.adminUser.username);

  const acct = await createUser({ username: uniq("acct") });
  await createMembership(acct.id, a.kindergarten.id, "ACCOUNTANT");
  accountantA = await login(app, acct.username);
});

/** A tariff in force for the whole of `MONTH`, unless `over` says otherwise. */
async function rule(source: string, over: Record<string, unknown> = {}) {
  return db.fundingRule.create({
    data: {
      kindergartenId: a.kindergarten.id,
      name: `${source} тариф`,
      source: source as never,
      effectiveFrom: date(1),
      dailyRate: "1000.00",
      dependsOnAttendance: true,
      dependsOnMeals: false,
      ...over,
    } as never,
  });
}

async function mark(day: number, status = "PRESENT") {
  return db.attendance.create({
    data: {
      kindergartenId: a.kindergarten.id,
      childId: a.child.id,
      enrollmentId: a.enrollment.id,
      date: date(day),
      status: status as never,
    },
  });
}

async function calculation(source: string, over: Record<string, unknown> = {}) {
  return db.fundingCalculation.create({
    data: {
      kindergartenId: a.kindergarten.id,
      childId: a.child.id,
      source: source as never,
      month: MONTH_START,
      daysAttended: 10,
      daysFed: 10,
      dailyRate: "1000.00",
      calculatedAmount: "10000.00",
      ...over,
    } as never,
  });
}

function listMonth(session: AuthSession, source?: string) {
  const query = source ? `?month=${MONTH}&source=${source}` : `?month=${MONTH}`;
  return authed(
    request(app.getHttpServer()).get(`/v1/kindergartens/${a.kindergarten.id}/funding${query}`),
    session,
  );
}

function calculate(session: AuthSession, body: Record<string, unknown>) {
  return authed(
    request(app.getHttpServer()).post(`/v1/kindergartens/${a.kindergarten.id}/funding/calculate`),
    session,
  ).send(body);
}

describe("the source filter", () => {
  it("returns every source when none is given", async () => {
    await calculation("STATE", { calculatedAmount: "10000.00" });
    await calculation("PARENT", { calculatedAmount: "20000.00" });

    const res = await listMonth(accountantA);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.totals).toHaveLength(2);
  });

  /**
   * ★ The rows **and** the totals. Asserting only the rows is what let this
   * ship half-working: the register listed one source under a footer summing
   * every source, and the two figures on screen disagreed.
   */
  it("narrows the rows and the totals together", async () => {
    await calculation("STATE", { calculatedAmount: "10000.00" });
    await calculation("PARENT", { calculatedAmount: "20000.00" });

    const res = await listMonth(accountantA, "PARENT");

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].source).toBe("PARENT");
    expect(res.body.totals).toHaveLength(1);
    expect(res.body.totals[0].source).toBe("PARENT");
    expect(res.body.totals[0].calculated).toBe("20000");
  });

  it("returns nothing for a source with no calculations", async () => {
    await calculation("STATE");

    const res = await listMonth(accountantA, "KINDERGARTEN");

    expect(res.body.items).toEqual([]);
    expect(res.body.totals).toEqual([]);
  });

  it("still refuses a teacher, filtered or not", async () => {
    const teacher = await login(app, a.teacherUser.username);

    expect((await listMonth(teacher)).status).toBe(404);
    expect((await listMonth(teacher, "STATE")).status).toBe(404);
  });
});

describe("running the month", () => {
  it("runs one source when one is named", async () => {
    await rule("STATE");
    await rule("PARENT");
    for (const day of [2, 3, 4]) await mark(day);

    expect((await calculate(adminA, { month: MONTH, source: "STATE" })).status).toBe(201);

    const rows = await db.fundingCalculation.findMany({
      where: { kindergartenId: a.kindergarten.id, deletedAt: null },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("STATE");
  });

  /**
   * ★ An omitted `source` means "every source with a tariff in force", which is
   * what an accountant means at month end. Asking them to press once per source
   * is how the fourth claim gets forgotten.
   */
  it("runs every source in force when none is named", async () => {
    await rule("STATE");
    await rule("PARENT");
    for (const day of [2, 3, 4]) await mark(day);

    const res = await calculate(adminA, { month: MONTH });
    expect(res.status).toBe(201);

    const rows = await db.fundingCalculation.findMany({
      where: { kindergartenId: a.kindergarten.id, deletedAt: null },
    });
    expect(rows.map((row) => row.source).sort()).toEqual(["PARENT", "STATE"]);
    // Three attended days × 1 000₮, computed once per source from one read of
    // the attendance register.
    expect(rows.every((row) => row.calculatedAmount.toString() === "3000")).toBe(true);
  });

  /**
   * ★★ The safety property. `replaceMonth` soft-deletes a source's previous
   * rows before writing the new ones, so including a source that has no rule
   * would empty it rather than leave it alone.
   */
  it("leaves a source with no tariff in force untouched", async () => {
    await rule("STATE");
    // Closed before the month began — in the table, not in force.
    await rule("PARENT", { effectiveFrom: date(1), effectiveTo: new Date("2026-01-31") });
    await calculation("PARENT", { calculatedAmount: "20000.00" });
    for (const day of [2, 3]) await mark(day);

    expect((await calculate(adminA, { month: MONTH })).status).toBe(201);

    const parent = await db.fundingCalculation.findMany({
      where: { kindergartenId: a.kindergarten.id, source: "PARENT", deletedAt: null },
    });
    expect(parent).toHaveLength(1);
    expect(parent[0]!.calculatedAmount.toString()).toBe("20000");
  });

  it("refuses when no tariff is in force at all", async () => {
    const res = await calculate(adminA, { month: MONTH });

    expect(res.status).toBe(400);
    expect(res.body.detail ?? res.body.title).toContain("дүрэм алга");
  });

  it("refuses a named source that has no tariff in force", async () => {
    await rule("STATE");

    const res = await calculate(adminA, { month: MONTH, source: "PARENT" });

    expect(res.status).toBe(400);
  });

  it("writes one audit row per source it ran", async () => {
    await rule("STATE");
    await rule("PARENT");
    await mark(2);

    await calculate(accountantA, { month: MONTH });

    const entries = await db.auditLog.findMany({
      where: { objectType: "FundingCalculation", action: "CREATE" },
    });

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => (entry.metadata as { source: string }).source).sort()).toEqual([
      "PARENT",
      "STATE",
    ]);
  });
});
