import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
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
 * Нягтлангийн самбар — client request, 2026-09-09.
 *
 * ★ The figure worth reading twice is income: it is what **arrived**, never
 * what was billed. A month that counted its invoices as income would report
 * money the kindergarten is still chasing, which is exactly the mistake the
 * spreadsheet this screen replaces makes.
 *
 * ★★ Every authorization case goes through the real HTTP route (§4.1). The
 * predicate is checked in the service, and a test that called the predicate
 * directly would pass even if a controller forgot to.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let accountantA: AuthSession;
let parentA: AuthSession;
let adminB: AuthSession;
let accountantB: AuthSession;

const MONTH = "2026-03";
const MONTH_START = new Date("2026-03-01T00:00:00.000Z");

function date(day: number): Date {
  return new Date(`2026-03-${String(day).padStart(2, "0")}T00:00:00.000Z`);
}

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  // ★ Six logins per case against a 60-per-15-minutes limiter — CLAUDE.md §4.4
  // names this as the one reproducible cause of a "flaky" full run.
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  const acctA = await createUser({ username: `acct-a-${Date.now()}` });
  await createMembership(acctA.id, a.kindergarten.id, "ACCOUNTANT");
  const acctB = await createUser({ username: `acct-b-${Date.now()}` });
  await createMembership(acctB.id, b.kindergarten.id, "ACCOUNTANT");

  [adminA, teacherA, accountantA, parentA, adminB, accountantB] = await Promise.all([
    login(app, a.adminUser.username),
    login(app, a.teacherUser.username),
    login(app, acctA.username),
    login(app, a.parentUser.username),
    login(app, b.adminUser.username),
    login(app, acctB.username),
  ]);
});

function board(session: AuthSession, month = MONTH, kindergartenId = a.kindergarten.id) {
  return authed(
    request(app.getHttpServer()).get(
      `/v1/kindergartens/${kindergartenId}/finance/board?month=${month}`,
    ),
    session,
  );
}

async function calculation(over: Record<string, unknown> = {}) {
  return db.fundingCalculation.create({
    data: {
      kindergartenId: a.kindergarten.id,
      childId: a.child.id,
      source: "STATE",
      month: MONTH_START,
      daysAttended: 20,
      daysFed: 20,
      dailyRate: "1000.00",
      calculatedAmount: "20000.00",
      ...over,
    } as never,
  });
}

async function invoice(over: Record<string, unknown> = {}) {
  return db.invoice.create({
    data: {
      kindergartenId: a.kindergarten.id,
      childId: a.child.id,
      month: MONTH_START,
      number: `2026-${String(Math.floor(Math.random() * 900000) + 100000)}`,
      baseAmount: "50000.00",
      totalDue: "50000.00",
      balance: "50000.00",
      dueDate: new Date("2099-01-01T00:00:00.000Z"),
      ...over,
    } as never,
  });
}

async function payment(invoiceId: string, amount: string) {
  return db.payment.create({
    data: {
      kindergartenId: a.kindergarten.id,
      invoiceId,
      amount,
      method: "CASH",
      createdAt: date(10),
    } as never,
  });
}

describe("board authorization — §1.7, нэмэлт.md §13", () => {
  it("refuses a teacher with 404", async () => {
    expect((await board(teacherA)).status).toBe(404);
  });

  it("refuses a guardian with 404", async () => {
    expect((await board(parentA)).status).toBe(404);
  });

  it("refuses an accountant from another kindergarten with 404", async () => {
    expect((await board(accountantB)).status).toBe(404);
  });

  it("refuses an admin from another kindergarten with 404", async () => {
    expect((await board(adminB)).status).toBe(404);
  });

  it("admits this kindergarten's accountant and administrator", async () => {
    expect((await board(accountantA)).status).toBe(200);
    expect((await board(adminA)).status).toBe(200);
  });
});

describe("the board's figures", () => {
  it("counts income as what arrived, never as what was billed", async () => {
    const bill = await invoice({ totalDue: "50000.00" });
    await payment(bill.id, "30000.00");
    await calculation({ approvedAmount: "80000.00", receivedAmount: "60000.00" });

    const res = await board(accountantA);

    expect(res.body.income.parents).toBe("30000.00");
    expect(res.body.income.state).toBe("60000.00");
    expect(res.body.income.total).toBe("90000.00");
    // Billed but unpaid is a debt, not income.
    expect(res.body.unpaid.amount).toBe("20000.00");
  });

  /**
   * ★ Funding the state has approved but not yet transferred is reported
   * beside the income, never inside it. It is the difference between "we have
   * been paid" and "we are owed", and the tile that blurred them would be the
   * one an accountant stops trusting first.
   */
  it("keeps approved-but-unreceived funding out of the income total", async () => {
    await calculation({ approvedAmount: "80000.00", receivedAmount: "60000.00" });

    const res = await board(accountantA);

    expect(res.body.income.state).toBe("60000.00");
    expect(res.body.income.total).toBe("60000.00");
    expect(res.body.income.statePending).toBe("20000.00");
  });

  it("never reports a negative pending amount", async () => {
    // An overpayment is a reconciliation question, not "−5 000₮ pending".
    await calculation({ approvedAmount: "20000.00", receivedAmount: "25000.00" });

    expect((await board(accountantA)).body.income.statePending).toBe("0.00");
  });

  it("prices the meals from the register, per child who actually ate", async () => {
    const rule = await db.fundingRule.create({
      data: {
        kindergartenId: a.kindergarten.id,
        name: "Хоолны мөнгө",
        source: "PARENT",
        effectiveFrom: date(1),
        dailyRate: "2500.00",
        dependsOnAttendance: false,
        dependsOnMeals: true,
      } as never,
    });
    await calculation({
      source: "PARENT",
      fundingRuleId: rule.id,
      daysFed: 20,
      calculatedAmount: "50000.00",
    });

    const res = await board(accountantA);

    expect(res.body.meals.total).toBe("50000.00");
    expect(res.body.meals.fedDays).toBe(20);
    expect(res.body.meals.children).toBe(1);
    expect(res.body.meals.perChild).toBe("50000.00");
  });

  it("counts each child owing only once, across every month", async () => {
    await invoice({ month: MONTH_START, balance: "50000.00" });
    await invoice({
      month: new Date("2026-02-01T00:00:00.000Z"),
      balance: "20000.00",
    });

    expect((await board(accountantA)).body.unpaid.children).toBe(1);
  });

  it("ignores another kindergarten's invoices", async () => {
    await db.invoice.create({
      data: {
        kindergartenId: b.kindergarten.id,
        childId: b.child.id,
        month: MONTH_START,
        number: "2026-777777",
        baseAmount: "88888.00",
        totalDue: "88888.00",
        balance: "88888.00",
        dueDate: new Date("2099-01-01T00:00:00.000Z"),
      } as never,
    });

    const res = await board(accountantA);

    expect(res.body.income.total).toBe("0.00");
    expect(res.body.unpaid.amount).toBe("0.00");
    expect(res.body.unpaid.children).toBe(0);
  });
});

describe("анхаарах зүйлс", () => {
  it("names an unconfigured tariff before anything else", async () => {
    const res = await board(accountantA);

    expect(res.body.alerts.map((alert: { key: string }) => alert.key)).toContain("no-rules");
  });

  it("names an unrun month once a tariff exists", async () => {
    await db.fundingRule.create({
      data: {
        kindergartenId: a.kindergarten.id,
        name: "Улсын тариф",
        source: "STATE",
        effectiveFrom: date(1),
        dailyRate: "1000.00",
        dependsOnAttendance: true,
        dependsOnMeals: false,
      } as never,
    });

    const keys = (await board(accountantA)).body.alerts.map((alert: { key: string }) => alert.key);

    expect(keys).toContain("month-not-run");
    expect(keys).not.toContain("no-rules");
  });

  it("raises an overdue invoice, unscoped by month", async () => {
    await invoice({
      month: new Date("2026-01-01T00:00:00.000Z"),
      dueDate: new Date("2026-01-20T00:00:00.000Z"),
      balance: "50000.00",
    });

    const overdue = (await board(accountantA)).body.alerts.find(
      (alert: { key: string }) => alert.key === "overdue",
    );

    expect(overdue).toBeDefined();
    expect(overdue.tone).toBe("warn");
  });

  it("raises funding the state approved but has not transferred", async () => {
    await calculation({ approvedAmount: "80000.00", receivedAmount: "60000.00" });

    const pending = (await board(accountantA)).body.alerts.find(
      (alert: { key: string }) => alert.key === "state-pending",
    );

    expect(pending).toBeDefined();
    expect(pending.tone).toBe("info");
  });

  it("stays quiet once the state has transferred in full", async () => {
    await calculation({ approvedAmount: "80000.00", receivedAmount: "80000.00" });

    const keys = (await board(accountantA)).body.alerts.map((alert: { key: string }) => alert.key);

    expect(keys).not.toContain("state-pending");
  });
});
