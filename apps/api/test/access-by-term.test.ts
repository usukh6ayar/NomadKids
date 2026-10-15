import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { localDate } from "@kinder/contracts";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { calendarTerms } from "../src/access/access.service";
import { currentSchoolYear } from "./support/school-year";

/**
 * Child access by term as well as by the school year (#211, the user
 * 2026-10-12): 9,000₮ a term, 27,000₮ the year.
 */
process.env.ACCESS_FEE_AMOUNT = "27000.00";
process.env.ACCESS_FEE_TERM_AMOUNT = "9000.00";

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

/** The calendar term covering today, from the year's first day. */
const calendarTerm = () =>
  calendarTerms(YEAR.startsOn).find((t) => t.startsOn <= TODAY && TODAY <= t.endsOn);

describe("a term or the school year", () => {
  it("offers both prices while today is in a term", async () => {
    const res = await status(parent);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ required: true, amount: "27000.00" });
    expect(res.body.termAmount).toBe(calendarTerm() ? "9000.00" : null);
  });

  it("raises one TERM row for the term covering today, apart from the year's", async () => {
    const term = calendarTerm();
    if (!term) return; // A summer day is in no term — the next case covers that.

    const first = await ensure(parent, { period: "TERM" });
    const again = await ensure(parent, { period: "TERM" });
    const year = await ensure(parent);

    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({ period: "TERM", termNumber: term.number });
    expect(first.body.amount).toBe("9000");
    expect(first.body.expiresAt.slice(0, 10)).toBe(term.endsOn.toISOString().slice(0, 10));
    expect(again.body.id).toBe(first.body.id);
    expect(year.body.period).toBe("YEAR");
    expect(year.body.id).not.toBe(first.body.id);
  });

  it("uses the kindergarten's own terms when it has set them up — and only those", async () => {
    const covering = await db.term.create({
      data: {
        kindergartenId: a.kindergarten.id,
        schoolYearId: yearId,
        number: 2,
        name: "Намрын улирал",
        startsOn: new Date(TODAY.getTime() - 86_400_000),
        endsOn: new Date(TODAY.getTime() + 20 * 86_400_000),
      },
    });

    const res = await ensure(parent, { period: "TERM" });

    expect(res.status).toBe(201);
    expect(res.body.termNumber).toBe(2);
    expect(res.body.expiresAt.slice(0, 10)).toBe(covering.endsOn.toISOString().slice(0, 10));

    // A day between the kindergarten's terms is in no term.
    await db.term.update({
      where: { id: covering.id },
      data: { startsOn: new Date("2001-01-01"), endsOn: new Date("2001-02-01") },
    });
    await db.accessSubscription.deleteMany({ where: { childId: a.child.id } });
    const between = await ensure(parent, { period: "TERM" });
    expect(between.status).toBe(400);
  });

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
