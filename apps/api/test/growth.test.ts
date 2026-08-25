import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Growth measurements and the chart — RFP §7.
 *
 * The two behaviours worth pinning: a **guardian may record** (RFP §2.3 lists
 * "Өсөлтийн мэдээлэл оруулах" under what a parent does, so this is deliberately
 * wider than observations) but may **not delete**, and the reference band never
 * ships without the source and the "not a medical diagnosis" notice §7.2
 * requires beside it.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let teacherA: AuthSession;
let parentA: AuthSession;
let parentB: AuthSession;

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

  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  parentB = await login(app, b.parentUser.username);
});

/** A date in the past, as YYYY-MM-DD — measurements may not be in the future. */
function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function record(
  session: AuthSession,
  childId: string,
  date: string,
  body: Record<string, unknown>,
) {
  return authed(request(server()).put(`/v1/children/${childId}/growth/${date}`), session).send(
    body,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Authorization — CLAUDE.md §4.1
// ═══════════════════════════════════════════════════════════════════════════

describe("authorization", () => {
  it("a teacher from another kindergarten gets 404 on the chart", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/growth`), teacherB);
    expect(res.status).toBe(404);
  });

  it("a guardian of another child gets 404 on the chart", async () => {
    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/growth`), parentB);
    expect(res.status).toBe(404);
  });

  it("a user from another kindergarten cannot record", async () => {
    const res = await record(parentB, a.child.id, daysAgo(1), { heightCm: 100 });
    expect(res.status).toBe(404);

    const rows = await db.growthMeasurement.findMany({ where: { childId: a.child.id } });
    expect(rows).toHaveLength(0);
  });

  it("a revoked guardian gets 404", async () => {
    await db.guardianship.update({
      where: { id: a.guardianship.id },
      data: { canView: false },
    });

    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/growth`), parentA);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Recording — RFP §7.1
// ═══════════════════════════════════════════════════════════════════════════

describe("recording", () => {
  it("a teacher records height and weight", async () => {
    const res = await record(teacherA, a.child.id, daysAgo(10), {
      heightCm: 102.5,
      weightKg: 16.4,
      note: "Улирлын хэмжилт",
    });

    expect(res.status).toBe(200);
    const row = await db.growthMeasurement.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(Number(row.heightCm)).toBe(102.5);
    expect(Number(row.weightKg)).toBe(16.4);
    expect(row.recordedById).toBe(a.teacherUser.id);
  });

  /**
   * ★ RFP §2.3: "Өсөлтийн мэдээлэл оруулах" is listed under what a parent does.
   *
   * This is deliberately wider than observations or assessments, which are
   * staff-only. A family measuring their child at home is the ordinary case.
   */
  it("a guardian records for their own child", async () => {
    const res = await record(parentA, a.child.id, daysAgo(5), { heightCm: 103, weightKg: 16.8 });
    expect(res.status).toBe(200);

    const row = await db.growthMeasurement.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.recordedById).toBe(a.parentUser.id);
  });

  /**
   * ★★ One row per child per day, enforced by a **partial** unique index.
   *
   * A second measurement on the same date corrects the first rather than adding
   * a second point — a chart with two points on one date has no defined order.
   */
  it("a second PUT for the same day updates rather than duplicating", async () => {
    const date = daysAgo(3);
    await record(teacherA, a.child.id, date, { heightCm: 100 });
    await record(teacherA, a.child.id, date, { heightCm: 101.5 });

    const rows = await db.growthMeasurement.findMany({
      where: { childId: a.child.id, deletedAt: null },
    });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.heightCm)).toBe(101.5);
  });

  /**
   * ★★★ The partial index is what makes this possible.
   *
   * A plain unique constraint counts a soft-deleted row as still occupying the
   * day — Postgres treats NULLs as distinct — so a day deleted once could never
   * be recorded again, failing against a row nobody can see.
   */
  it("a day can be recorded again after its measurement is deleted", async () => {
    const date = daysAgo(4);
    const first = await record(teacherA, a.child.id, date, { heightCm: 100 });

    const removed = await authed(
      request(server()).delete(`/v1/growth-measurements/${first.body.id}`),
      teacherA,
    );
    expect(removed.status).toBe(200);

    const again = await record(teacherA, a.child.id, date, { heightCm: 101 });
    expect(again.status).toBe(200);
  });

  it("refuses a measurement with no measurement in it", async () => {
    const res = await record(teacherA, a.child.id, daysAgo(1), { note: "Зөвхөн тэмдэглэл" });
    expect(res.status).toBe(400);
  });

  it("refuses an implausible value — a slipped decimal point", async () => {
    expect((await record(teacherA, a.child.id, daysAgo(1), { heightCm: 17 })).status).toBe(400);
    expect((await record(teacherA, a.child.id, daysAgo(1), { weightKg: 850 })).status).toBe(400);
  });

  it("refuses a future date", async () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const res = await record(teacherA, a.child.id, tomorrow.toISOString().slice(0, 10), {
      heightCm: 100,
    });
    expect(res.status).toBe(400);
  });

  it("refuses a date before the child was born", async () => {
    const res = await record(teacherA, a.child.id, "2019-01-01", { heightCm: 100 });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The chart — RFP §7.2
// ═══════════════════════════════════════════════════════════════════════════

describe("the chart", () => {
  it("returns the series oldest first, which is the order a chart is drawn in", async () => {
    await record(teacherA, a.child.id, daysAgo(60), { heightCm: 100 });
    await record(teacherA, a.child.id, daysAgo(30), { heightCm: 101 });
    await record(teacherA, a.child.id, daysAgo(1), { heightCm: 102 });

    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/growth`), teacherA);

    expect(res.status).toBe(200);
    const dates = (res.body.points as { measuredOn: string }[]).map((p) => p.measuredOn);
    expect(dates).toEqual([...dates].sort());
  });

  /** RFP §7.2 — "өмнөх хэмжилттэй харьцуулах". */
  it("reports the change since the previous measurement, and null for the first", async () => {
    await record(teacherA, a.child.id, daysAgo(60), { heightCm: 100, weightKg: 15 });
    await record(teacherA, a.child.id, daysAgo(30), { heightCm: 101.8, weightKg: 16 });

    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/growth`), teacherA);
    const [first, second] = res.body.points as {
      heightChangeCm: number | null;
      weightChangeKg: number | null;
    }[];

    expect(first!.heightChangeCm).toBeNull();
    // 1.8, not 1.7999999999999998 — the delta is rounded to the precision the
    // measurements themselves carry.
    expect(second!.heightChangeCm).toBe(1.8);
    expect(second!.weightChangeKg).toBe(1);
  });

  /**
   * ★ A delta against a measurement nobody took is a fabricated fact.
   *
   * If the earlier row carried only a weight, the later row's *height* change
   * has no predecessor to compare against and must be null — not zero, and not
   * a comparison with some older row the family never saw beside it.
   */
  it("does not invent a change when the previous row lacked that quantity", async () => {
    await record(teacherA, a.child.id, daysAgo(60), { weightKg: 15 });
    await record(teacherA, a.child.id, daysAgo(30), { heightCm: 101 });

    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/growth`), teacherA);
    const points = res.body.points as { heightChangeCm: number | null }[];
    expect(points[1]!.heightChangeCm).toBeNull();
  });

  /**
   * ★★ RFP §7.2 requires the source, its version, its date **and** a notice
   * that this is not a medical diagnosis. They travel inside the reference
   * object so a screen cannot render the band without them.
   */
  it("ships the reference band with its source and the medical disclaimer", async () => {
    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/growth`), teacherA);

    expect(res.body.reference).not.toBeNull();
    expect(res.body.reference.source.name).toContain("WHO");
    expect(res.body.reference.source.version).toBeTruthy();
    expect(res.body.reference.source.publishedOn).toBeTruthy();
    expect(res.body.reference.source.disclaimer).toContain("онош биш");

    // A band, not a percentile curve: median with a low and high edge.
    const band = res.body.reference.height[0];
    expect(band.median).toBeGreaterThan(band.low);
    expect(band.high).toBeGreaterThan(band.median);
  });

  it("filters to a date range", async () => {
    await record(teacherA, a.child.id, daysAgo(200), { heightCm: 98 });
    await record(teacherA, a.child.id, daysAgo(2), { heightCm: 102 });

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/growth?from=${daysAgo(30)}`),
      teacherA,
    );
    expect(res.body.points).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Deleting
// ═══════════════════════════════════════════════════════════════════════════

describe("deleting", () => {
  it("soft-deletes rather than removing the row", async () => {
    const created = await record(teacherA, a.child.id, daysAgo(1), { heightCm: 100 });
    await authed(request(server()).delete(`/v1/growth-measurements/${created.body.id}`), teacherA);

    const row = await db.growthMeasurement.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.deletedAt).not.toBeNull();
  });

  /**
   * ★ A guardian may add a measurement and may not remove one — the same shape
   * as the photo album. Adding is contributing a fact; deleting edits the
   * record the kindergarten keeps, and a wrong value is corrected by writing
   * the day again.
   */
  it("a guardian cannot delete their own measurement", async () => {
    const created = await record(parentA, a.child.id, daysAgo(1), { heightCm: 100 });
    expect(created.status).toBe(200);

    const res = await authed(
      request(server()).delete(`/v1/growth-measurements/${created.body.id}`),
      parentA,
    );
    expect(res.status).toBe(404);

    const row = await db.growthMeasurement.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.deletedAt).toBeNull();
  });

  it("a teacher from another kindergarten cannot delete", async () => {
    const created = await record(teacherA, a.child.id, daysAgo(1), { heightCm: 100 });
    const teacherB = await login(app, b.teacherUser.username);

    const res = await authed(
      request(server()).delete(`/v1/growth-measurements/${created.body.id}`),
      teacherB,
    );
    expect(res.status).toBe(404);
  });

  it("a deleted measurement leaves the chart", async () => {
    const created = await record(teacherA, a.child.id, daysAgo(1), { heightCm: 100 });
    await authed(request(server()).delete(`/v1/growth-measurements/${created.body.id}`), teacherA);

    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/growth`), teacherA);
    expect(res.body.points).toHaveLength(0);
  });
});
