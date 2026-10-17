import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { localDate } from "@kinder/contracts";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { currentSchoolYear } from "./support/school-year";

/**
 * Child access by term as well as by the school year (#211, the user
 * 2026-10-12) — and since 2026-10-18 the term is «I-р улирал», sold through
 * 2026-11-30 and ending on that day whenever it is bought. The prices are the
 * sheet's (`@kinder/contracts` `CHILD_PRICES`): 5,000₮ a term, 22,000₮ a year.
 */
process.env.ACCESS_FEE_AMOUNT = "22000.00";
process.env.ACCESS_FEE_TERM_AMOUNT = "5000.00";

let app: INestApplication;
const db = testDb();
const server = () => app.getHttpServer();

let a: Scenario;
let b: Scenario;
let parent: AuthSession;
let teacher: AuthSession;
let otherParent: AuthSession;
let yearId: string;

const TODAY = new Date(`${localDate()}T00:00:00.000Z`);
const YEAR = currentSchoolYear(TODAY);

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
  // The fixture's year is a fixed past one; a term has to cover today.
  const year = await db.schoolYear.update({
    where: { id: a.schoolYear.id },
    data: { startsOn: YEAR.startsOn, endsOn: YEAR.endsOn },
  });
  yearId = year.id;
  parent = await login(app, a.parentUser.username);
  teacher = await login(app, a.teacherUser.username);
  otherParent = await login(app, b.parentUser.username);
});

const ensure = (who: AuthSession, body?: Record<string, unknown>) =>
  authed(request(server()).post(`/v1/children/${a.child.id}/access`), who).send(body);
const status = (who: AuthSession) =>
  authed(request(server()).get(`/v1/children/${a.child.id}/access`), who);

/**
 * Runs `body` with the clock at `iso` (Date only), signed in on that clock —
 * a session from the real "now" would be from the future.
 */
async function at<T>(iso: string, body: (session: AuthSession) => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });
  try {
    return await body(await login(app, a.parentUser.username));
  } finally {
    vi.useRealTimers();
  }
}

/** The 2026–2027 school year, which the promotion falls in, made current. */
async function promoYear() {
  await db.schoolYear.update({
    where: { id: yearId },
    data: { startsOn: new Date("2026-09-01"), endsOn: new Date("2027-05-31"), isCurrent: true },
  });
}

describe("«I-р улирал» — a fixed last day, 2026-11-30", () => {
  beforeEach(promoYear);

  it.each([
    ["18 October", "2026-10-18T03:00:00.000Z"],
    ["29 November", "2026-11-29T03:00:00.000Z"],
    // 23:30 on 30 November in Ulaanbaatar — the last day is inclusive.
    ["the last evening, 30 November", "2026-11-30T15:30:00.000Z"],
  ])("bought on %s, it charges 5,000₮ and ends on 2026-11-30", async (_label, now) => {
    const res = await at(now, (session) => ensure(session, { period: "TERM" }));

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ period: "TERM", termNumber: 1, amount: "5000" });
    expect(res.body.expiresAt.slice(0, 10)).toBe("2026-11-30");
  });

  it("offers the term beside the year until the cutoff, and only the year after it", async () => {
    const before = await at("2026-11-30T15:30:00.000Z", (session) => status(session));
    const after = await at("2026-11-30T16:30:00.000Z", (session) => status(session));

    expect(before.body).toMatchObject({ amount: "22000.00", termAmount: "5000.00" });
    expect(after.body).toMatchObject({ amount: "22000.00", termAmount: null });
  });

  it("refuses to sell the term from 1 December, by the API as by the screen", async () => {
    // 00:30 on 1 December in Ulaanbaatar.
    const res = await at("2026-11-30T16:30:00.000Z", (session) =>
      ensure(session, { period: "TERM" }),
    );

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/2026\.11\.30/);
    expect(await db.accessSubscription.count({ where: { period: "TERM" } })).toBe(0);
  });

  it("refuses an unpaid term raised before the cutoff, rather than letting it be paid after", async () => {
    const early = await at("2026-11-20T03:00:00.000Z", (session) =>
      ensure(session, { period: "TERM" }),
    );
    expect(early.status).toBe(201);

    const late = await at("2026-12-02T03:00:00.000Z", (session) =>
      ensure(session, { period: "TERM" }),
    );
    expect(late.status).toBe(400);
  });

  it("raises one TERM row however often it is asked, apart from the year's", async () => {
    const [first, again, year] = await at("2026-10-18T03:00:00.000Z", async (session) => [
      await ensure(session, { period: "TERM" }),
      await ensure(session, { period: "TERM" }),
      await ensure(session),
    ]);

    expect(again!.body.id).toBe(first!.body.id);
    expect(year!.body).toMatchObject({ period: "YEAR", amount: "22000" });
    expect(year!.body.id).not.toBe(first!.body.id);
    // The year keeps its own policy: the school year's last day.
    expect(year!.body.expiresAt.slice(0, 10)).toBe("2027-05-31");
  });

  it("keeps a term already paid open to its own recorded day after the cutoff", async () => {
    await db.accessSubscription.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        schoolYearId: yearId,
        period: "TERM",
        termNumber: 1,
        amount: "5000.00",
        status: "ACTIVE",
        paidAt: new Date("2026-10-20T00:00:00.000Z"),
        expiresAt: new Date("2026-11-30T00:00:00.000Z"),
      },
    });

    const lastDay = await at("2026-11-30T10:00:00.000Z", (session) =>
      authed(request(server()).get(`/v1/children/${a.child.id}`), session),
    );
    const nextDay = await at("2026-12-01T02:00:00.000Z", (session) =>
      authed(request(server()).get(`/v1/children/${a.child.id}`), session),
    );

    expect([lastDay.status, nextDay.status]).toEqual([200, 402]);
  });
});

describe("a term or the school year", () => {
  it("a paid term opens the gate until its own end", async () => {
    await db.accessSubscription.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        schoolYearId: yearId,
        period: "TERM",
        termNumber: 1,
        amount: "9000.00",
        status: "ACTIVE",
        paidAt: new Date(),
        expiresAt: new Date(TODAY.getTime() + 86_400_000),
      },
    });
    const open = await authed(request(server()).get(`/v1/children/${a.child.id}`), parent);

    await db.accessSubscription.updateMany({
      where: { childId: a.child.id },
      data: { expiresAt: new Date(TODAY.getTime() - 86_400_000) },
    });
    const closed = await authed(request(server()).get(`/v1/children/${a.child.id}`), parent);

    expect([open.status, closed.status]).toEqual([200, 402]);
  });

  it("closes at Ulaanbaatar's midnight, not at UTC's", async () => {
    // ★ 2026-10-16: `expiresAt` is a DATE and the gate compared it with
    // `new Date()`, which Prisma keys by its UTC day — yesterday in Ulaanbaatar
    // until 08:00. A fee that ended yesterday stayed open till morning, and this
    // file failed in CI whenever it ran in those hours.
    await db.accessSubscription.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        schoolYearId: yearId,
        period: "TERM",
        termNumber: 1,
        amount: "9000.00",
        status: "ACTIVE",
        paidAt: new Date("2026-10-01T00:00:00.000Z"),
        expiresAt: new Date("2026-10-15T00:00:00.000Z"),
      },
    });

    // 01:00 on 16 October in Ulaanbaatar; still the 15th in UTC.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-15T17:00:00.000Z") });
    try {
      // Signed in on the same clock, or the session would be from the future.
      const session = await login(app, a.parentUser.username);
      const res = await authed(request(server()).get(`/v1/children/${a.child.id}`), session);
      expect(res.status).toBe(402);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the database keeps one YEAR row per child per year, and one per term", async () => {
    const row = {
      kindergartenId: a.kindergarten.id,
      childId: a.child.id,
      schoolYearId: yearId,
      amount: "1.00",
      expiresAt: YEAR.endsOn,
    };
    await db.accessSubscription.create({ data: row });
    await db.accessSubscription.create({ data: { ...row, period: "TERM", termNumber: 1 } });

    await expect(db.accessSubscription.create({ data: row })).rejects.toThrow();
    await expect(
      db.accessSubscription.create({ data: { ...row, period: "TERM", termNumber: 1 } }),
    ).rejects.toThrow();
    // A TERM row must name its term.
    await expect(
      db.accessSubscription.create({ data: { ...row, period: "TERM", termNumber: null } }),
    ).rejects.toThrow();
  });

  it("is 404 to the child's teacher and to another family", async () => {
    const byTeacher = await ensure(teacher, { period: "TERM" });
    const byStranger = await ensure(otherParent, { period: "TERM" });

    expect([byTeacher.status, byStranger.status]).toEqual([404, 404]);
  });
});
