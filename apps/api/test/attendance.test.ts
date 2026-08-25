import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  authed,
  createChild,
  createGroup,
  enrollChild,
  createScenario,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Attendance — staff records it, guardians may only request it in advance.
 *
 * The rule under test that is easy to get backwards: a guardian's own
 * `AttendanceRequest` never becomes an `Attendance` row by itself. Only a
 * staff approval writes one, and it writes as the reviewer, not the
 * requester — `Attendance.recordedById` is always staff.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let teacherA: AuthSession;
let parentA: AuthSession;
let parentB: AuthSession;

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

  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  parentB = await login(app, b.parentUser.username);
});

const server = () => app.getHttpServer();

// ═══════════════════════════════════════════════════════════════════════════
// Recording — staff only
// ═══════════════════════════════════════════════════════════════════════════

describe("recording", () => {
  it("a teacher records a child's status for a day", async () => {
    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT" });

    expect(res.status).toBe(200);

    const row = await db.attendance.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.status).toBe("PRESENT");
    expect(row.recordedById).toBe(a.teacherUser.id);
    expect(row.enrollmentId).toBe(a.enrollment.id);
  });

  it("a second PUT for the same day updates rather than duplicates", async () => {
    await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT" });

    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "SICK", note: "Халуурч байна" });

    expect(res.status).toBe(200);

    const rows = await db.attendance.findMany({ where: { childId: a.child.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("SICK");
    expect(rows[0]!.note).toBe("Халуурч байна");
  });

  it("rejects a future date", async () => {
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 3);
    const iso = future.toISOString().slice(0, 10);

    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/${iso}`),
      teacherA,
    ).send({ status: "PRESENT" });

    expect(res.status).toBe(400);
  });

  /** Uniform 404, not 403 — docs/SECURITY.md §5.4, same as observations. */
  it("a parent cannot record attendance", async () => {
    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      parentA,
    ).send({ status: "PRESENT" });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Reading — staff and guardians alike
// ═══════════════════════════════════════════════════════════════════════════

describe("reading", () => {
  it("a guardian reads their own child's month", async () => {
    await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT" });

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/attendance?month=2026-02`),
      parentA,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("the monthly summary counts by status, not a collapsed figure", async () => {
    await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT" });
    await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-11`),
      teacherA,
    ).send({ status: "HALF_DAY" });

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/attendance/summary?month=2026-02`),
      teacherA,
    );

    expect(res.status).toBe(200);
    expect(res.body.PRESENT).toBe(1);
    expect(res.body.HALF_DAY).toBe(1);
    expect(res.body.EXCUSED).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Attendance requests — guardian asks, staff decides
// ═══════════════════════════════════════════════════════════════════════════

describe("attendance requests", () => {
  it("a guardian's request does not itself create an Attendance row", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({ dateFrom: "2026-03-02", dateTo: "2026-03-03", requestedStatus: "EXCUSED" });

    expect(res.status).toBe(201);
    expect(res.body.reviewStatus).toBe("PENDING");

    const rows = await db.attendance.findMany({ where: { childId: a.child.id } });
    expect(rows).toHaveLength(0);
  });

  it("approving a request writes Attendance for every day in the range, authored by the reviewer", async () => {
    const created = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({ dateFrom: "2026-03-02", dateTo: "2026-03-04", requestedStatus: "EXCUSED" });

    const res = await authed(
      request(server()).post(`/v1/attendance-requests/${created.body.id}/review`),
      teacherA,
    ).send({ decision: "APPROVED" });

    expect(res.status).toBe(201);

    const rows = await db.attendance.findMany({
      where: { childId: a.child.id },
      orderBy: { date: "asc" },
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "EXCUSED")).toBe(true);
    // The reviewer recorded it, not the parent who asked.
    expect(rows.every((r) => r.recordedById === a.teacherUser.id)).toBe(true);
  });

  it("rejecting a request writes no Attendance rows", async () => {
    const created = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({ dateFrom: "2026-03-02", dateTo: "2026-03-02", requestedStatus: "SICK" });

    await authed(
      request(server()).post(`/v1/attendance-requests/${created.body.id}/review`),
      teacherA,
    ).send({ decision: "REJECTED" });

    const rows = await db.attendance.findMany({ where: { childId: a.child.id } });
    expect(rows).toHaveLength(0);
  });

  it("a parent cannot review a request", async () => {
    const created = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({ dateFrom: "2026-03-02", dateTo: "2026-03-02", requestedStatus: "SICK" });

    const res = await authed(
      request(server()).post(`/v1/attendance-requests/${created.body.id}/review`),
      parentA,
    ).send({ decision: "APPROVED" });

    // The coarse @Roles("TEACHER", "ADMIN") gate is 404 too — RolesGuard is
    // uniformly 404, never 403, same reasoning as ChildAccessService.
    expect(res.status).toBe(404);
  });

  /**
   * The full `Paginated<T>` shape, not just `items`/`total`.
   *
   * The web client's `paginated()` Zod schema requires `page`, `pageSize` and
   * `totalPages` too — a response missing them fails client-side validation
   * silently (the query settles into neither a loading, error nor empty
   * state), so the review queue rendered as a blank screen for every teacher
   * until this was caught.
   */
  it("the review queue returns the full paginated shape", async () => {
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({ dateFrom: "2026-03-02", dateTo: "2026-03-02", requestedStatus: "SICK" });

    const res = await authed(
      request(server()).get("/v1/attendance-requests/review-queue?page=1&pageSize=25"),
      teacherA,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 25, total: 1, totalPages: 1 });
    expect(res.body.items).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-child and cross-kindergarten — CLAUDE.md §4.1's minimum three
// ═══════════════════════════════════════════════════════════════════════════

describe("isolation", () => {
  it("a guardian of another child gets 404", async () => {
    const res = await authed(
      request(server()).get(`/v1/children/${b.child.id}/attendance?month=2026-02`),
      parentA,
    );
    expect(res.status).toBe(404);
  });

  it("a teacher from another group gets 404", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");
    const child = await createChild(a.kindergarten.id, { firstName: "Хол" });
    await enrollChild(a.kindergarten.id, child.id, other.id, a.schoolYear.id);

    const res = await authed(
      request(server()).put(`/v1/children/${child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT" });

    expect(res.status).toBe(404);
  });

  it("cross-kindergarten recording gets 404", async () => {
    const res = await authed(
      request(server()).put(`/v1/children/${b.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT" });

    expect(res.status).toBe(404);
  });

  it("a guardian of another child cannot submit a request for it", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentB,
    ).send({ dateFrom: "2026-03-02", dateTo: "2026-03-02", requestedStatus: "SICK" });

    expect(res.status).toBe(404);
  });

  it("a teacher from another group gets 404 on the day sheet", async () => {
    const res = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/attendance?date=2026-02-10`),
      await login(app, b.teacherUser.username),
    );
    expect(res.status).toBe(404);
  });
});
