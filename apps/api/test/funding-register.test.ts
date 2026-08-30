import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { splitBilling } from "../src/funding/funding-rules";

/**
 * The monthly register — `GET /kindergartens/:id/funding/register`.
 *
 * ★ The screen it feeds shows a figure and its justification side by side, so
 * what these assert is that the two cannot disagree.
 *
 * `undocumentedDays`, `state`, `grossAmount` and `deductionAmount` are all
 * derived on read (see `FundingService.buildRegister`). Every case below writes
 * the underlying rows — an attendance mark, a meal, an approved request — and
 * asks the real HTTP route what it now says, because a derivation tested
 * against its own inputs would pass with the register wired to nothing.
 *
 * ★★ The authorization cases are the mandatory three, adapted: this endpoint is
 * kindergarten-scoped rather than child-scoped, so "another kindergarten's
 * admin" and "a teacher of this kindergarten" are the two ways in that must
 * fail. §13 of `нэмэлт.md` is explicit that a teacher may not see the money.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let adminB: AuthSession;

/** A month in the past with no boundary subtleties. */
const MONTH = "2026-02";

function iso(day: number): string {
  return `2026-02-${String(day).padStart(2, "0")}`;
}

function date(day: number): Date {
  return new Date(`${iso(day)}T00:00:00.000Z`);
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
  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  adminB = await login(app, b.adminUser.username);
});

async function mark(day: number, status: string, scenario: Scenario = a) {
  return db.attendance.create({
    data: {
      kindergartenId: scenario.kindergarten.id,
      childId: scenario.child.id,
      enrollmentId: scenario.enrollment.id,
      date: date(day),
      status: status as never,
    },
  });
}

async function feed(day: number, kind = "LUNCH") {
  return db.mealRecord.create({
    data: {
      kindergartenId: a.kindergarten.id,
      childId: a.child.id,
      enrollmentId: a.enrollment.id,
      date: date(day),
      kind: kind as never,
      status: "TAKEN",
    },
  });
}

async function approveLeave(from: number, to: number) {
  return db.attendanceRequest.create({
    data: {
      kindergartenId: a.kindergarten.id,
      childId: a.child.id,
      enrollmentId: a.enrollment.id,
      dateFrom: date(from),
      dateTo: date(to),
      requestedStatus: "EXCUSED",
      reviewStatus: "APPROVED",
      requestedById: a.parentUser.id,
    },
  });
}

async function createRule(over: Record<string, unknown> = {}) {
  return db.fundingRule.create({
    data: {
      kindergartenId: a.kindergarten.id,
      name: "Хоолны төлбөр",
      source: "PARENT",
      effectiveFrom: date(1),
      dailyRate: "1000.00",
      dependsOnAttendance: false,
      dependsOnMeals: true,
      ...over,
    } as never,
  });
}

function getRegister(session: AuthSession, query = "", kindergartenId = a.kindergarten.id) {
  return authed(
    request(app.getHttpServer()).get(
      `/v1/kindergartens/${kindergartenId}/funding/register?month=${MONTH}${query}`,
    ),
    session,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Authorization — CLAUDE.md §4.1
// ═══════════════════════════════════════════════════════════════════════════

describe("who may read the register", () => {
  it("an administrator of the kindergarten may", async () => {
    const res = await getRegister(adminA);
    expect(res.status).toBe(200);
  });

  /**
   * ★ A teacher is refused even for their **own** kindergarten, with a 404.
   *
   * `нэмэлт.md` §13: "Багш санхүүгийн бүрэн мэдээллийг харах эрхгүй байна". The
   * attendance half of this response would be fine for them to see; the money
   * beside it is not, and one response cannot be half-authorized.
   *
   * ★★ 404 rather than 403, from `TenantAccessService.assertAdmin` — the
   * product's uniform rule (CLAUDE.md §1.7, docs/SECURITY.md §5.4). A 403 here
   * would confirm the kindergarten exists to somebody who may not read it.
   */
  it("a teacher of the same kindergarten may not", async () => {
    const res = await getRegister(teacherA);
    expect(res.status).toBe(404);
  });

  it("a guardian may not", async () => {
    const res = await getRegister(parentA);
    expect(res.status).toBe(404);
  });

  it("an administrator of another kindergarten may not", async () => {
    const res = await getRegister(adminB);
    expect(res.status).toBe(404);
  });

  it("nobody may without a session", async () => {
    const res = await request(app.getHttpServer()).get(
      `/v1/kindergartens/${a.kindergarten.id}/funding/register?month=${MONTH}`,
    );
    expect(res.status).toBe(401);
  });

  /** The export is the same data in another format, so it is the same door. */
  it("the spreadsheet is behind the same check", async () => {
    const res = await authed(
      request(app.getHttpServer()).get(
        `/v1/kindergartens/${a.kindergarten.id}/funding/register/export?month=${MONTH}`,
      ),
      teacherA,
    );
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The counts
// ═══════════════════════════════════════════════════════════════════════════

describe("attendance counts", () => {
  it("counts each status separately, including OTHER", async () => {
    await mark(2, "PRESENT");
    await mark(3, "PRESENT");
    await mark(4, "HALF_DAY");
    await mark(5, "SICK");
    await mark(6, "OTHER");

    const res = await getRegister(adminA);
    const row = res.body.items.find((r: { child: { id: string } }) => r.child.id === a.child.id);

    expect(row.counts).toEqual({
      PRESENT: 2,
      HALF_DAY: 1,
      EXCUSED: 0,
      SICK: 1,
      ABSENT: 0,
      OTHER: 1,
    });
  });

  /**
   * ★ Working days come from the register, not from a calendar.
   *
   * Three marked dates is a three-day month here, however many weekdays
   * February 2026 has. A holiday nobody registered must not inflate the full
   * month a deduction is measured against.
   */
  it("counts working days as the dates anybody was marked on", async () => {
    await mark(2, "PRESENT");
    await mark(3, "PRESENT");
    await mark(4, "ABSENT");

    const res = await getRegister(adminA);
    expect(res.body.workingDays).toBe(3);
  });

  it("counts a fed day once however many sittings it had", async () => {
    await feed(2, "BREAKFAST");
    await feed(2, "LUNCH");
    await feed(2, "AFTERNOON_SNACK");
    await feed(3, "LUNCH");

    const res = await getRegister(adminA);
    const row = res.body.items.find((r: { child: { id: string } }) => r.child.id === a.child.id);

    expect(row.mealDays).toBe(2);
  });

  it("keeps another kindergarten's rows out", async () => {
    await mark(2, "PRESENT");
    await mark(2, "PRESENT", b);

    const res = await getRegister(adminA);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].child.id).toBe(a.child.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The paperwork behind an absence — §6's "акт"
// ═══════════════════════════════════════════════════════════════════════════

describe("undocumented absences", () => {
  it("flags an absence with no approved request", async () => {
    await mark(10, "ABSENT");
    await mark(11, "SICK");

    const res = await getRegister(adminA);
    const row = res.body.items[0];

    expect(row.undocumentedDays).toBe(2);
    expect(row.state).toBe("MISSING_DOCUMENT");
    expect(res.body.totals.missingDocuments).toBe(1);
  });

  it("clears the flag once a request covering the days is approved", async () => {
    await mark(10, "ABSENT");
    await mark(11, "SICK");
    await approveLeave(10, 11);

    const res = await getRegister(adminA);
    expect(res.body.items[0].undocumentedDays).toBe(0);
    expect(res.body.totals.missingDocuments).toBe(0);
  });

  it("a pending request documents nothing", async () => {
    await mark(10, "ABSENT");
    await db.attendanceRequest.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        enrollmentId: a.enrollment.id,
        dateFrom: date(10),
        dateTo: date(10),
        requestedStatus: "EXCUSED",
        reviewStatus: "PENDING",
        requestedById: a.parentUser.id,
      },
    });

    const res = await getRegister(adminA);
    expect(res.body.items[0].undocumentedDays).toBe(1);
  });

  /**
   * ★ Attendance is never undocumented.
   *
   * A present day needs no акт, and neither does `OTHER` — see
   * `ABSENCE_STATUSES` in the service for why the sixth status asks for nothing
   * rather than asking for paperwork about a day nobody has classified.
   */
  it("asks for no document for a present, half or OTHER day", async () => {
    await mark(2, "PRESENT");
    await mark(3, "HALF_DAY");
    await mark(4, "OTHER");

    const res = await getRegister(adminA);
    expect(res.body.items[0].undocumentedDays).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The money
// ═══════════════════════════════════════════════════════════════════════════

describe("the funding column", () => {
  /** Runs the month the way the screen's button does. */
  async function calculate(source = "PARENT") {
    return authed(
      request(app.getHttpServer()).post(`/v1/kindergartens/${a.kindergarten.id}/funding/calculate`),
      adminA,
    ).send({ month: MONTH, source });
  }

  it("shows no figure before the month is run, and says so", async () => {
    await mark(2, "PRESENT");

    const res = await getRegister(adminA);
    expect(res.body.items[0].funding).toBeNull();
    expect(res.body.items[0].state).toBe("PENDING");
  });

  /**
   * ★ `gross − deduction === net`, and `net` is the stored figure.
   *
   * The engine computes one number and this endpoint derives two more around
   * it. If the derivation ever drifted, the register would show a total that
   * does not decompose — which an accountant would find before we did.
   */
  it("decomposes the stored amount into gross, deduction and net", async () => {
    for (const day of [2, 3, 4, 5]) await mark(day, "PRESENT");
    for (const day of [2, 3, 4]) await feed(day);
    await createRule();

    expect((await calculate()).status).toBe(201);

    const res = await getRegister(adminA);
    const funding = res.body.items[0].funding;

    // Four marked dates → four working days; the child ate on three of them.
    expect(res.body.workingDays).toBe(4);
    expect(funding.daysFed).toBe(3);
    expect(funding.netAmount).toBe("3000");
    expect(funding.grossAmount).toBe("4000");
    expect(funding.deductionAmount).toBe("1000");
    expect(Number(funding.grossAmount) - Number(funding.deductionAmount)).toBe(
      Number(funding.netAmount),
    );
  });

  /**
   * ★ A flat monthly rule has no deduction.
   *
   * §5's "Сарын тариф" does not vary with attendance, so showing a deduction
   * against it would invent a discount the rule does not offer.
   */
  it("shows no deduction against a flat monthly rule", async () => {
    await mark(2, "PRESENT");
    await createRule({
      name: "Сарын хураамж",
      source: "KINDERGARTEN",
      dailyRate: null,
      monthlyRate: "45000.00",
      dependsOnAttendance: false,
      dependsOnMeals: false,
    });

    expect((await calculate("KINDERGARTEN")).status).toBe(201);

    const res = await getRegister(adminA);
    const funding = res.body.items[0].funding;

    expect(funding.netAmount).toBe("45000");
    expect(funding.grossAmount).toBe("45000");
    expect(funding.deductionAmount).toBe("0");
  });

  it("totals the money over the whole filter", async () => {
    for (const day of [2, 3]) await mark(day, "PRESENT");
    for (const day of [2, 3]) await feed(day);
    await createRule();
    await calculate();

    const res = await getRegister(adminA);
    expect(res.body.totals.netAmount).toBe("2000");
    expect(res.body.totals.grossAmount).toBe("2000");
  });

  it("carries the tariffs the month was priced under", async () => {
    await createRule();

    const res = await getRegister(adminA);
    expect(res.body.rules).toHaveLength(1);
    expect(res.body.rules[0].dailyRate).toBe("1000");
    // Projected field by field — a spread would ship the tenant id.
    expect(res.body.rules[0].kindergartenId).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The row's state
// ═══════════════════════════════════════════════════════════════════════════

describe("the state each row reports", () => {
  /**
   * ★ Fed on more days than attended is a register error, and it outranks
   * everything else the row could say.
   *
   * `funding-rules.ts` names this case: the minimum of the two counts is used
   * so a claim is never overstated, and the discrepancy itself is "worth
   * surfacing rather than silently pricing". This is that surface.
   */
  it("reports CHECK when the kitchen fed more days than the register attended", async () => {
    await mark(2, "PRESENT");
    await feed(2);
    await feed(3);
    await feed(4);

    const res = await getRegister(adminA);
    expect(res.body.items[0].state).toBe("CHECK");
    expect(res.body.totals.needingCheck).toBe(1);
  });

  it("CHECK outranks a missing document", async () => {
    await mark(2, "PRESENT");
    await mark(3, "ABSENT");
    await feed(2);
    await feed(3);
    await feed(4);

    const res = await getRegister(adminA);
    expect(res.body.items[0].undocumentedDays).toBe(1);
    expect(res.body.items[0].state).toBe("CHECK");
  });

  it("reports SETTLED once an amount has been approved", async () => {
    await mark(2, "PRESENT");
    await feed(2);
    await createRule();

    await authed(
      request(app.getHttpServer()).post(`/v1/kindergartens/${a.kindergarten.id}/funding/calculate`),
      adminA,
    ).send({ month: MONTH, source: "PARENT" });

    const calculation = await db.fundingCalculation.findFirst({
      where: { childId: a.child.id, deletedAt: null },
    });

    await authed(
      request(app.getHttpServer()).patch(`/v1/funding-calculations/${calculation!.id}`),
      adminA,
    ).send({ approvedAmount: "1000.00" });

    const res = await getRegister(adminA);
    expect(res.body.items[0].state).toBe("SETTLED");
    expect(res.body.items[0].funding.approvedAmount).toBe("1000");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Filters and paging
// ═══════════════════════════════════════════════════════════════════════════

describe("filters", () => {
  it("narrows to one group", async () => {
    await mark(2, "PRESENT");

    const mine = await getRegister(adminA, `&groupId=${a.group.id}`);
    expect(mine.body.items).toHaveLength(1);

    const theirs = await getRegister(adminA, `&groupId=${b.group.id}`);
    expect(theirs.body.items).toHaveLength(0);
  });

  it("searches by name", async () => {
    await mark(2, "PRESENT");

    const hit = await getRegister(adminA, `&q=${encodeURIComponent(a.child.lastName)}`);
    expect(hit.body.items).toHaveLength(1);

    const miss = await getRegister(adminA, "&q=zzzzzz");
    expect(miss.body.items).toHaveLength(0);
  });

  /** A status filter picks children, and never edits the row it returns. */
  it("keeps every count on a row a status filter selected", async () => {
    await mark(2, "PRESENT");
    await mark(3, "SICK");

    const res = await getRegister(adminA, "&status=SICK");
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].counts.PRESENT).toBe(1);
    expect(res.body.items[0].counts.SICK).toBe(1);
  });

  it("accepts several statuses in one filter", async () => {
    await mark(2, "SICK");

    const res = await getRegister(adminA, "&status=ABSENT,SICK");
    expect(res.body.items).toHaveLength(1);
  });

  it("rejects a status it does not know", async () => {
    const res = await getRegister(adminA, "&status=NAPPING");
    expect(res.status).toBe(400);
  });

  it("rejects a month it cannot parse", async () => {
    const res = await authed(
      request(app.getHttpServer()).get(
        `/v1/kindergartens/${a.kindergarten.id}/funding/register?month=2026`,
      ),
      adminA,
    );
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The arithmetic on its own
// ═══════════════════════════════════════════════════════════════════════════

describe("splitBilling", () => {
  it("prices a full month with no deduction", () => {
    expect(splitBilling(1000, 20000, 20)).toEqual({ gross: 20000, deduction: 0, net: 20000 });
  });

  it("charges the missing days as the deduction", () => {
    expect(splitBilling(1000, 15000, 20)).toEqual({ gross: 20000, deduction: 5000, net: 15000 });
  });

  /**
   * ★ Never a negative deduction.
   *
   * A child billed for more days than the kindergarten opened is the `CHECK`
   * case above — a register error, not a surcharge shown as a negative
   * discount.
   */
  it("clamps a deduction at zero rather than showing a negative one", () => {
    expect(splitBilling(1000, 25000, 20)).toEqual({ gross: 20000, deduction: 0, net: 25000 });
  });

  it("leaves a flat monthly amount alone", () => {
    expect(splitBilling(null, 45000, 20)).toEqual({ gross: 45000, deduction: 0, net: 45000 });
  });
});
