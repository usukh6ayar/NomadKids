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
 * A month's invoices, generated from the `PARENT` tariffs — `нэмэлт.md` §3, §7.
 *
 * ★ This route exists because the surviving invoice implementation could only
 * bill one child from hand-typed lines. A forty-child kindergarten would have
 * been forty requests and forty chances to mistype a rate that `FundingRule`
 * already records. The capability was ported across the 2026-09-01 merge, and
 * these tests are what say it arrived intact.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let accountant: AuthSession;
let accountantB: AuthSession;
let teacher: AuthSession;
let parent: AuthSession;

const server = () => app.getHttpServer();

const MONTH = "2026-08";
const DUE = "2026-09-05";

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

  const accUser = await createUser({ username: uniq("acct") });
  await createMembership(accUser.id, a.kindergarten.id, "ACCOUNTANT");
  accountant = await login(app, accUser.username);

  const accBUser = await createUser({ username: uniq("acct-b") });
  await createMembership(accBUser.id, b.kindergarten.id, "ACCOUNTANT");
  accountantB = await login(app, accBUser.username);

  teacher = await login(app, a.teacherUser.username);
  parent = await login(app, a.parentUser.username);
});

async function tariff(over: Record<string, unknown> = {}) {
  return db.fundingRule.create({
    data: {
      kindergartenId: a.kindergarten.id,
      name: "Сургалтын төлбөр",
      source: "PARENT",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      monthlyRate: "150000.00",
      dependsOnAttendance: false,
      dependsOnMeals: false,
      invoiceItemKind: "TUITION",
      ...over,
    } as never,
  });
}

/** One meal taken, on one date. `kind` is what makes three of these one day. */
async function meal(date: string, kind: "BREAKFAST" | "LUNCH" | "AFTERNOON_SNACK") {
  return db.mealRecord.create({
    data: {
      kindergartenId: a.kindergarten.id,
      childId: a.child.id,
      enrollmentId: a.enrollment.id,
      date: new Date(`${date}T00:00:00.000Z`),
      kind,
      status: "TAKEN",
    } as never,
  });
}

async function generateMonth(
  session: AuthSession,
  kindergartenId: string,
  body: Record<string, unknown> = {},
) {
  return authed(
    request(server()).post(`/v1/kindergartens/${kindergartenId}/invoices/generate-month`),
    session,
  ).send({ month: MONTH, dueDate: DUE, ...body });
}

describe("who may bill a month", () => {
  it("refuses a teacher — §13's exclusion, not just a role gate", async () => {
    expect((await generateMonth(teacher, a.kindergarten.id)).status).toBe(404);
  });

  it("refuses a guardian", async () => {
    expect((await generateMonth(parent, a.kindergarten.id)).status).toBe(404);
  });

  it("refuses an accountant employed by a different kindergarten", async () => {
    // The role gate would let this through; `assertCanReadFinance` reads the
    // membership against the kindergarten in the URL, and that is what refuses.
    await tariff();
    expect((await generateMonth(accountantB, a.kindergarten.id)).status).toBe(404);
  });
});

describe("generating from the tariffs", () => {
  it("refuses with something an administrator can act on when no tariff exists", async () => {
    // The rule table ships empty by §4's own instruction, so this is the
    // expected first-run state rather than an error condition.
    const res = await generateMonth(accountant, a.kindergarten.id);

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("тариф");
  });

  it("bills a flat monthly tariff to every enrolled child", async () => {
    await tariff();

    const res = await generateMonth(accountant, a.kindergarten.id);

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);

    const invoice = await db.invoice.findFirstOrThrow({
      where: { childId: a.child.id },
      include: { lineItems: true },
    });
    expect(invoice.baseAmount.toString()).toBe("150000");
    expect(invoice.totalDue.toString()).toBe("150000");
    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.lineItems[0]!.type).toBe("TUITION");
  });

  it("gives the invoice a number a parent can quote", async () => {
    await tariff();
    await generateMonth(accountant, a.kindergarten.id);

    const invoice = await db.invoice.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(invoice.number).toMatch(/^2026-\d{6}$/);
  });

  it("counts one fed day per date, not one per sitting", async () => {
    // ★ The discriminating case. A child who ate breakfast, lunch and a snack
    // on one day owes for one day. Grouping by child alone would charge three.
    await tariff({
      name: "Хоолны мөнгө",
      monthlyRate: null,
      dailyRate: "3500.00",
      dependsOnAttendance: false,
      dependsOnMeals: true,
      invoiceItemKind: "MEAL",
    });
    await meal("2026-08-03", "BREAKFAST");
    await meal("2026-08-03", "LUNCH");
    await meal("2026-08-03", "AFTERNOON_SNACK");
    await meal("2026-08-04", "LUNCH");

    const res = await generateMonth(accountant, a.kindergarten.id);

    expect(res.status).toBe(201);
    const invoice = await db.invoice.findFirstOrThrow({
      where: { childId: a.child.id },
      include: { lineItems: true },
    });
    // Two days × 3,500₮, not four sittings.
    expect(invoice.mealAmount.toString()).toBe("7000");
    expect(invoice.lineItems[0]!.description).toContain("2 × 3500.00");
  });

  it("bills nothing for a meal tariff in a month the child never ate", async () => {
    await tariff({
      name: "Хоолны мөнгө",
      monthlyRate: null,
      dailyRate: "3500.00",
      dependsOnAttendance: false,
      dependsOnMeals: true,
      invoiceItemKind: "MEAL",
    });

    const res = await generateMonth(accountant, a.kindergarten.id);

    expect(res.body.created).toBe(0);
    expect(res.body.skipped).toContainEqual({ childId: a.child.id, reason: "nothing_to_bill" });
  });

  it("skips a child who already has an invoice for the month rather than rewriting it", async () => {
    // §14: a bill with money against it gets a correction, never a quiet
    // rewrite — and a bulk run is the last place to make that call implicitly.
    await tariff();
    await generateMonth(accountant, a.kindergarten.id);

    const res = await generateMonth(accountant, a.kindergarten.id);

    expect(res.body.created).toBe(0);
    expect(res.body.skipped).toContainEqual({ childId: a.child.id, reason: "already_invoiced" });
    expect(await db.invoice.count({ where: { childId: a.child.id } })).toBe(1);
  });

  it("ignores another kindergarten's children", async () => {
    await tariff();

    await generateMonth(accountant, a.kindergarten.id);

    expect(await db.invoice.count({ where: { childId: b.child.id } })).toBe(0);
  });

  it("bills only the children asked for when given a list", async () => {
    await tariff();

    const res = await generateMonth(accountant, a.kindergarten.id, {
      childIds: [b.child.id],
    });

    expect(res.body.created).toBe(0);
  });

  it("uses the rates in force at the end of the month, not today's", async () => {
    // Billing August in September must use August's prices, or a rate change
    // silently rewrites a month that has already happened.
    await tariff({ effectiveTo: new Date("2026-07-31T00:00:00.000Z") });

    const res = await generateMonth(accountant, a.kindergarten.id);

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("тариф");
  });
});
