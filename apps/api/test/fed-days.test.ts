import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { FundingRepository } from "../src/funding/funding.repository";
import { MealsRepository } from "../src/meals/meals.repository";

/**
 * "хооллосон өдөр" is a **day**, never a sitting.
 *
 * ★ These tests exist because a defect shipped that nothing could catch.
 *
 * `MealRecord` is unique on `(enrollmentId, date, kind)`, so a child fed
 * breakfast, lunch and a snack has three rows for one day. Both repository
 * paths counted rows, so a per-day tariff — §5's "Нэг өдрийн тариф" — was
 * multiplied by a count of sittings, overstating a claim against state funding
 * by however many meals the kindergarten serves. Measured on the demo data:
 * 2.69×.
 *
 * ★★ The arithmetic was already covered, and that is exactly why the defect
 * survived. `funding-rules.ts` is pure and its tests feed it numbers by hand
 * (`{ daysAttended: 20, daysFed: 18 }`), so they can never see a repository
 * that produces the wrong 18. Every case below therefore goes through the real
 * repository or the real HTTP route.
 *
 * ★★★ These tests fix the **unit**, not the policy. Which statuses count as
 * fed, and what `HALF_DAY` attendance is worth, are unchanged and are the
 * client's decisions — see the note at the bottom of this file.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let teacherA: AuthSession;
let adminA: AuthSession;

let meals: MealsRepository;
let funding: FundingRepository;

/** A month with no boundary subtleties, comfortably in the past. */
const MONTH = "2026-02";
const FIRST = new Date(Date.UTC(2026, 1, 1));
const LAST = new Date(Date.UTC(2026, 1, 28));

beforeAll(async () => {
  app = await createTestApp();
  meals = app.get(MealsRepository);
  funding = app.get(FundingRepository);
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  teacherA = await login(app, a.teacherUser.username);
  adminA = await login(app, a.adminUser.username);
});

/** Writes one `MealRecord` directly — the shape the register produces. */
async function feed(
  isoDate: string,
  kind: "BREAKFAST" | "LUNCH" | "AFTERNOON_SNACK" | "EXTRA",
  status: "TAKEN" | "NOT_TAKEN" | "PARTIAL" | "SPECIAL" = "TAKEN",
  { deleted = false }: { deleted?: boolean } = {},
) {
  return db.mealRecord.create({
    data: {
      kindergartenId: a.kindergarten.id,
      childId: a.child.id,
      enrollmentId: a.enrollment.id,
      date: new Date(`${isoDate}T00:00:00.000Z`),
      kind,
      status,
      deletedAt: deleted ? new Date() : null,
    },
  });
}

/** The child's fed days, straight from the repository under test. */
async function fedDaysFromMealsRepo(): Promise<number> {
  const { daysFed } = await meals.monthlyMealCounts(a.child.id, FIRST, LAST);
  return daysFed;
}

/** The child's fed days as the funding calculation sees them. */
async function fedDaysFromFundingRepo(): Promise<number> {
  const { meals: rows } = await funding.monthInputs(a.kindergarten.id, FIRST, LAST);
  return rows.find((row) => row.childId === a.child.id)?.daysFed ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// The defect itself
// ═══════════════════════════════════════════════════════════════════════════

describe("fed days count calendar dates, not meal sittings", () => {
  it("2 days x 3 sittings is 2 fed days, not 6", async () => {
    for (const date of ["2026-02-10", "2026-02-11"]) {
      await feed(date, "BREAKFAST");
      await feed(date, "LUNCH");
      await feed(date, "AFTERNOON_SNACK");
    }

    // Six rows exist. The old code returned 6 from both paths.
    expect(await db.mealRecord.count({ where: { childId: a.child.id } })).toBe(6);

    expect(await fedDaysFromMealsRepo()).toBe(2);
    expect(await fedDaysFromFundingRepo()).toBe(2);
  });

  it("breakfast and lunch on the same date is 1 fed day", async () => {
    await feed("2026-02-10", "BREAKFAST");
    await feed("2026-02-10", "LUNCH");

    expect(await fedDaysFromMealsRepo()).toBe(1);
    expect(await fedDaysFromFundingRepo()).toBe(1);
  });

  it("all four sittings on one date is still 1 fed day", async () => {
    await feed("2026-02-10", "BREAKFAST");
    await feed("2026-02-10", "LUNCH");
    await feed("2026-02-10", "AFTERNOON_SNACK");
    await feed("2026-02-10", "EXTRA");

    expect(await fedDaysFromMealsRepo()).toBe(1);
    expect(await fedDaysFromFundingRepo()).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Which statuses qualify — unchanged, asserted so a later edit cannot drift
// ═══════════════════════════════════════════════════════════════════════════

describe("status meanings are unchanged", () => {
  it("NOT_TAKEN alone is 0 fed days", async () => {
    await feed("2026-02-10", "BREAKFAST", "NOT_TAKEN");
    await feed("2026-02-10", "LUNCH", "NOT_TAKEN");

    expect(await fedDaysFromMealsRepo()).toBe(0);
    expect(await fedDaysFromFundingRepo()).toBe(0);
  });

  it("PARTIAL alone is 1 fed day", async () => {
    await feed("2026-02-10", "LUNCH", "PARTIAL");

    expect(await fedDaysFromMealsRepo()).toBe(1);
    expect(await fedDaysFromFundingRepo()).toBe(1);
  });

  it("SPECIAL alone is 1 fed day", async () => {
    await feed("2026-02-10", "LUNCH", "SPECIAL");

    expect(await fedDaysFromMealsRepo()).toBe(1);
    expect(await fedDaysFromFundingRepo()).toBe(1);
  });

  it("one qualifying sitting carries a date whose other sittings are NOT_TAKEN", async () => {
    await feed("2026-02-10", "BREAKFAST", "NOT_TAKEN");
    await feed("2026-02-10", "LUNCH", "TAKEN");
    await feed("2026-02-10", "AFTERNOON_SNACK", "NOT_TAKEN");

    // The date counts once, on the strength of the one meal actually eaten.
    expect(await fedDaysFromMealsRepo()).toBe(1);
    expect(await fedDaysFromFundingRepo()).toBe(1);
  });

  it("a child with no meal record at all has 0 fed days", async () => {
    expect(await fedDaysFromMealsRepo()).toBe(0);
    expect(await fedDaysFromFundingRepo()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Soft delete and month boundary
// ═══════════════════════════════════════════════════════════════════════════

describe("soft-deleted rows and month boundaries", () => {
  it("a soft-deleted row does not make its date count", async () => {
    await feed("2026-02-10", "LUNCH", "TAKEN", { deleted: true });

    expect(await fedDaysFromMealsRepo()).toBe(0);
    expect(await fedDaysFromFundingRepo()).toBe(0);
  });

  it("a date survives on a live sitting when another on the same date is deleted", async () => {
    await feed("2026-02-10", "BREAKFAST", "TAKEN", { deleted: true });
    await feed("2026-02-10", "LUNCH", "TAKEN");

    expect(await fedDaysFromMealsRepo()).toBe(1);
    expect(await fedDaysFromFundingRepo()).toBe(1);
  });

  it("meals outside the month are excluded, and both ends are inclusive", async () => {
    await feed("2026-01-31", "LUNCH"); // the day before
    await feed("2026-02-01", "LUNCH"); // first day, counts
    await feed("2026-02-28", "LUNCH"); // last day, counts
    await feed("2026-03-01", "LUNCH"); // the day after

    expect(await fedDaysFromMealsRepo()).toBe(2);
    expect(await fedDaysFromFundingRepo()).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The consumers — the money, and the screen
// ═══════════════════════════════════════════════════════════════════════════

describe("the corrected count reaches its consumers", () => {
  it("the funding calculation bills fed days, not sittings", async () => {
    // Two days, three sittings each. A per-day rate of 1000 must produce 2000.
    for (const date of ["2026-02-10", "2026-02-11"]) {
      await feed(date, "BREAKFAST");
      await feed(date, "LUNCH");
      await feed(date, "AFTERNOON_SNACK");
    }

    // A rule that depends on meals alone, so nothing masks the count. With
    // `dependsOnAttendance` the `min()` in `billableDays` would hide it.
    const rule = await authed(
      request(app.getHttpServer()).post(`/v1/kindergartens/${a.kindergarten.id}/funding/rules`),
      adminA,
    ).send({
      name: "Хоолны хөнгөлөлт",
      source: "STATE",
      effectiveFrom: "2026-01-01",
      dailyRate: "1000.00",
      dependsOnAttendance: false,
      dependsOnMeals: true,
    });
    expect(rule.status).toBe(201);

    const run = await authed(
      request(app.getHttpServer()).post(`/v1/kindergartens/${a.kindergarten.id}/funding/calculate`),
      adminA,
    ).send({ month: MONTH, source: "STATE" });
    expect(run.status).toBe(201);

    const row = run.body.find((entry: { childId: string }) => entry.childId === a.child.id);

    expect(row.daysFed).toBe(2);
    // 2 x 1000, not 6 x 1000. This is the assertion the defect would fail.
    expect(row.calculatedAmount).toBe("2000");
  });

  it("the child meal summary reports days while keeping the per-sitting breakdown", async () => {
    await feed("2026-02-10", "BREAKFAST");
    await feed("2026-02-10", "LUNCH");
    await feed("2026-02-11", "LUNCH", "PARTIAL");
    await feed("2026-02-12", "LUNCH", "NOT_TAKEN");

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/children/${a.child.id}/meals/summary?month=${MONTH}`),
      teacherA,
    );

    expect(res.status).toBe(200);
    // Three qualifying rows across two dates.
    expect(res.body.daysFed).toBe(2);

    // ★ The breakdown must survive the fix: §6 reports it, and a tariff that
    // prices PARTIAL differently is the reason it is kept per sitting.
    const total = res.body.counts.reduce(
      (sum: number, row: { count: number }) => sum + row.count,
      0,
    );
    expect(total).toBe(4);
    expect(res.body.counts).toContainEqual({ kind: "LUNCH", status: "PARTIAL", count: 1 });
    expect(res.body.counts).toContainEqual({ kind: "LUNCH", status: "NOT_TAKEN", count: 1 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tenant isolation — the count must not cross a kindergarten
// ═══════════════════════════════════════════════════════════════════════════

describe("tenant isolation", () => {
  it("another kindergarten's meals never reach this one's funding input", async () => {
    const b = await createScenario("b");

    await db.mealRecord.create({
      data: {
        kindergartenId: b.kindergarten.id,
        childId: b.child.id,
        enrollmentId: b.enrollment.id,
        date: new Date("2026-02-10T00:00:00.000Z"),
        kind: "LUNCH",
        status: "TAKEN",
      },
    });

    const { meals: rows } = await funding.monthInputs(a.kindergarten.id, FIRST, LAST);
    expect(rows.find((row) => row.childId === b.child.id)).toBeUndefined();
  });
});

/*
 * ★ Deliberately NOT asserted here, because they are the client's decisions
 * and asserting them would freeze a guess into the suite:
 *
 *   - what `HALF_DAY` attendance is worth (currently a full funded day — the
 *     Django reference warns explicitly against hard-coding this)
 *   - whether EXCUSED or SICK days are fundable
 *   - whether a `PARTIAL`-only day should earn the full daily rate
 *   - the food-cost tariff and its four-way source split
 *
 * This file fixes the unit. It does not decide the policy.
 */
