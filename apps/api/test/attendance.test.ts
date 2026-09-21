import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { StorageService } from "../src/storage/storage.service";

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
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  parentB = await login(app, b.parentUser.username);
});

const server = () => app.getHttpServer();
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "ascii");

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

  it("★ records who dropped the child off, together with the arrival time", async () => {
    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT", arrivedWith: "MOTHER", arrivedAt: "2026-02-10T09:00:00.000Z" });

    expect(res.status).toBe(200);
    const row = await db.attendance.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.arrivedWith).toBe("MOTHER");
    expect(row.arrivedAt?.toISOString()).toBe("2026-02-10T09:00:00.000Z");
  });

  it("a plain status-only PUT never erases an arrival already recorded", async () => {
    await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT", arrivedWith: "FATHER", arrivedAt: "2026-02-10T08:30:00.000Z" });

    // The group day-sheet's own tap-to-save call — status only.
    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT" });

    expect(res.status).toBe(200);
    const row = await db.attendance.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.arrivedWith).toBe("FATHER");
    expect(row.arrivedAt).not.toBeNull();
  });

  it("★ OTHER carries a name; MOTHER/FATHER never does", async () => {
    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT", arrivedWith: "OTHER", arrivedWithName: "Авдрахаа эмээ" });

    expect(res.status).toBe(200);
    const row = await db.attendance.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.arrivedWith).toBe("OTHER");
    expect(row.arrivedWithName).toBe("Авдрахаа эмээ");
  });

  it("a name sent for MOTHER/FATHER is discarded, not stored", async () => {
    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT", arrivedWith: "MOTHER", arrivedWithName: "ignored" });

    expect(res.status).toBe(200);
    const row = await db.attendance.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.arrivedWithName).toBeNull();
  });

  it("switching from OTHER back to MOTHER clears the stale name", async () => {
    await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT", arrivedWith: "OTHER", arrivedWithName: "Жолооч" });

    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT", arrivedWith: "MOTHER" });

    expect(res.status).toBe(200);
    const row = await db.attendance.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.arrivedWith).toBe("MOTHER");
    expect(row.arrivedWithName).toBeNull();
  });

  it("★ records pickup independently, without resending status", async () => {
    await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT", arrivedWith: "MOTHER" });

    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/attendance/2026-02-10/pickup`),
      teacherA,
    ).send({ pickedUpWith: "OTHER", pickedUpAt: "2026-02-10T17:15:00.000Z" });

    expect(res.status).toBe(200);
    const row = await db.attendance.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.status).toBe("PRESENT");
    expect(row.arrivedWith).toBe("MOTHER");
    expect(row.pickedUpWith).toBe("OTHER");
    expect(row.pickedUpAt?.toISOString()).toBe("2026-02-10T17:15:00.000Z");
  });

  it("pickup on a day with no attendance record 404s — nothing to attach it to", async () => {
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/attendance/2026-02-10/pickup`),
      teacherA,
    ).send({ pickedUpWith: "MOTHER" });

    expect(res.status).toBe(404);
  });

  it("a parent cannot record a pickup", async () => {
    await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "PRESENT" });

    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/attendance/2026-02-10/pickup`),
      parentA,
    ).send({ pickedUpWith: "MOTHER" });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A guardian's own arrival claim — "Ирц мэдэгдэх"
// ═══════════════════════════════════════════════════════════════════════════

describe("arrival claims", () => {
  /*
    ★ The invariant this file opens with, kept where it still holds — 2026-09-12.

    It used to be asserted of a PRESENT claim, which was the strongest case for
    it: a guardian could not write themselves into the register. An arrival is
    no longer a claim the teacher rules on ("багшаар баталгаажиж
    зөвшөөрөгдөхгүй"), so that assertion moved to the leave request, which is
    the one thing a parent sends that is still genuinely a request. A day off
    that has not been granted must not appear in the register as if it had.
  */
  it("★ a guardian's leave request carries no Attendance row until approved", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({
      dateFrom: "2026-02-11",
      dateTo: "2026-02-11",
      requestedStatus: "EXCUSED",
      reason: "Хөдөө явна",
    });

    expect(res.status).toBe(201);
    expect(res.body.reviewStatus).toBe("PENDING");
    expect(await db.attendance.count({ where: { childId: a.child.id } })).toBe(0);
  });

  /*
    ★ Written as it is reported, not on approval — 2026-09-12.

    Approving used to be what copied the companion and the time onto the
    `Attendance` row. An arrival needs no approval now ("багшаар баталгаажиж
    зөвшөөрөгдөхгүй"), so the same write happens at the moment the parent sends
    it — otherwise the fact would be recorded nowhere and the register would sit
    empty for a child standing in the room.
  */
  it("reporting an arrival copies the companion and time onto the Attendance row", async () => {
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({
      dateFrom: "2026-02-11",
      dateTo: "2026-02-11",
      requestedStatus: "PRESENT",
      arrivedWith: "FATHER",
      arrivedAt: "2026-02-11T08:45:00.000Z",
    });

    const row = await db.attendance.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.status).toBe("PRESENT");
    expect(row.arrivedWith).toBe("FATHER");
    expect(row.arrivedAt?.toISOString()).toBe("2026-02-11T08:45:00.000Z");
    // Recorded by whoever reported it; the register stays the teacher's to
    // overwrite, which the case at the foot of this file holds down.
    expect(row.recordedById).toBe(a.parentUser.id);
  });

  it("★ a guardian's OTHER claim carries the name onto the row", async () => {
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({
      dateFrom: "2026-02-11",
      dateTo: "2026-02-11",
      requestedStatus: "PRESENT",
      arrivedWith: "OTHER",
      arrivedWithName: "Ахын найз",
    });

    const row = await db.attendance.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.arrivedWith).toBe("OTHER");
    expect(row.arrivedWithName).toBe("Ахын найз");
  });

  /*
    An arrival is a fact the family reports, not a permission they ask for, so
    there is nothing for the teacher to reject: the request is already decided
    when it is created and `reviewRequest` refuses to decide it twice. The
    register stays correctable — by the teacher, through the day sheet, which
    the case at the foot of this file holds down.
  */
  it("an arrival cannot be rejected — it was never the teacher's to decide", async () => {
    const created = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({
      dateFrom: "2026-02-11",
      dateTo: "2026-02-11",
      requestedStatus: "PRESENT",
      arrivedWith: "MOTHER",
    });

    const review = await authed(
      request(server()).post(`/v1/attendance-requests/${created.body.id}/review`),
      teacherA,
    ).send({ decision: "REJECTED" });

    expect(review.status).toBe(400);
    expect(await db.attendance.count({ where: { childId: a.child.id } })).toBe(1);
  });

  it("no arrivedAt sent means the request captures the moment it was made", async () => {
    const before = new Date();
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({
      dateFrom: "2026-02-11",
      dateTo: "2026-02-11",
      requestedStatus: "PRESENT",
      arrivedWith: "OTHER",
    });

    const row = await db.attendanceRequest.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.arrivedAt).not.toBeNull();
    expect(row.arrivedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("a leave request (EXCUSED/SICK) never carries a companion", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({
      dateFrom: "2026-02-11",
      dateTo: "2026-02-11",
      requestedStatus: "EXCUSED",
      arrivedWith: "MOTHER",
    });

    const row = await db.attendanceRequest.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.arrivedWith).toBeNull();
  });

  it("★ an afternoon pickup lands on the same day without erasing the morning's arrival", async () => {
    // First report of the day: drop-off.
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({
      dateFrom: "2026-02-11",
      dateTo: "2026-02-11",
      requestedStatus: "PRESENT",
      arrivedWith: "MOTHER",
      arrivedAt: "2026-02-11T09:00:00.000Z",
    });

    // Second, later report the same day: pickup — no arrivedWith at all.
    const pickup = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({
      dateFrom: "2026-02-11",
      dateTo: "2026-02-11",
      requestedStatus: "PRESENT",
      pickedUpWith: "FATHER",
      pickedUpAt: "2026-02-11T17:30:00.000Z",
    });

    expect(pickup.status).toBe(201);

    const row = await db.attendance.findFirstOrThrow({
      where: { childId: a.child.id, date: new Date("2026-02-11T00:00:00.000Z") },
    });
    // The point of the test: the morning's report survives the afternoon's.
    expect(row.arrivedWith).toBe("MOTHER");
    expect(row.arrivedAt?.toISOString()).toBe("2026-02-11T09:00:00.000Z");
    expect(row.pickedUpWith).toBe("FATHER");
    expect(row.pickedUpAt?.toISOString()).toBe("2026-02-11T17:30:00.000Z");
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

    /*
      ★ Every status, present at zero — asserted as a set rather than key by key.

      `attendanceSummarySchema` is `z.record(attendanceStatusSchema, …)`, and an
      enum-keyed record is exhaustive in Zod: one absent key rejects the whole
      object, so a family opening "Ирцийн нэгтгэл" got "Алдаа гарлаа" and no
      figures at all. `OTHER` was the missing one until 2026-09-12, and the three
      assertions above passed throughout — which is why this now names the shape.
    */
    expect(Object.keys(res.body).sort()).toEqual([
      "ABSENT",
      "EXCUSED",
      "HALF_DAY",
      "OTHER",
      "PRESENT",
      "SICK",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Attendance requests — guardian asks, staff decides
// ═══════════════════════════════════════════════════════════════════════════

describe("attendance requests", () => {
  it("stores a PDF doctor's note with the leave request", async () => {
    vi.spyOn(app.get(StorageService), "put").mockResolvedValue(undefined);

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    )
      .field("dateFrom", "2026-03-02")
      .field("dateTo", "2026-03-03")
      .field("requestedStatus", "SICK")
      .field("reason", "Халуурсан")
      .attach("attachment", PDF, "эмчийн-бичиг.pdf");

    expect(res.status).toBe(201);
    expect(res.body.attachment).toMatchObject({
      originalName: "эмчийн-бичиг.pdf",
      mimeType: "application/pdf",
    });

    const media = await db.mediaFile.findUniqueOrThrow({
      where: { attendanceRequestId: res.body.id },
    });
    expect(media.childId).toBe(a.child.id);
    expect(media.purpose).toBe("ATTENDANCE_ATTACHMENT");
  });

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

  /**
   * ★ The month summary answers to the same rule as the day sheet.
   *
   * Both go through `assertCanReadGroup`, which is why this is asserted through
   * the route rather than against the helper: a second endpoint on the same
   * group is exactly where a check gets forgotten, and the aggregate leaks more
   * than one day would — a whole month of one group's attendance, per child.
   */
  it("a teacher from another group gets 404 on the month summary", async () => {
    const res = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/attendance/summary?month=2026-02`),
      await login(app, b.teacherUser.username),
    );
    expect(res.status).toBe(404);
  });

  it("a user from another kindergarten gets 404 on the month summary", async () => {
    const res = await authed(
      request(server()).get(`/v1/groups/${b.group.id}/attendance/summary?month=2026-02`),
      teacherA,
    );
    expect(res.status).toBe(404);
  });

  /**
   * 404, not 403 — CLAUDE.md §1.7, and the guard answers it that way across the
   * product. A 403 would confirm that this group exists to somebody who may not
   * read it.
   */
  it("a guardian may not read a group's month summary", async () => {
    const res = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/attendance/summary?month=2026-02`),
      parentA,
    );
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The month behind the register — what the screen's own panel draws
// ═══════════════════════════════════════════════════════════════════════════

describe("group month summary", () => {
  /** Marks one child on one day, through the route a teacher actually uses. */
  async function mark(childId: string, date: string, status: string) {
    const res = await authed(
      request(server()).put(`/v1/children/${childId}/attendance/${date}`),
      teacherA,
    ).send({ status });
    if (res.status !== 200) throw new Error(`mark failed: ${res.status} ${res.text}`);
  }

  it("counts a month by day, by status and by child", async () => {
    await mark(a.child.id, "2026-02-10", "PRESENT");
    await mark(a.child.id, "2026-02-11", "SICK");
    await mark(a.child.id, "2026-02-12", "PRESENT");

    const res = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/attendance/summary?month=2026-02`),
      teacherA,
    );

    expect(res.status).toBe(200);
    expect(res.body.month).toBe("2026-02");
    expect(res.body.totals.PRESENT).toBe(2);
    expect(res.body.totals.SICK).toBe(1);
    // Three days carry a record, so three columns — not twenty-eight.
    expect(res.body.days).toHaveLength(3);
    expect(res.body.days[0].date).toBe("2026-02-10");
    expect(res.body.days[1].counts.SICK).toBe(1);

    const row = res.body.children.find((c: { child: { id: string } }) => c.child.id === a.child.id);
    expect(row.counts.PRESENT).toBe(2);
    expect(row.counts.SICK).toBe(1);
  });

  /**
   * ★ A child with nothing recorded still appears.
   *
   * They are the most interesting name on the list — the one nobody has marked
   * all month — and a summary built only from the rows that exist cannot show
   * them. `roster` counts the same people, so the two always agree.
   */
  it("lists a child who has no attendance rows at all", async () => {
    const child = await createChild(a.kindergarten.id, { firstName: "Тэмдэглээгүй" });
    await enrollChild(a.kindergarten.id, child.id, a.group.id, a.schoolYear.id);

    const res = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/attendance/summary?month=2026-02`),
      teacherA,
    );

    expect(res.status).toBe(200);
    const row = res.body.children.find((c: { child: { id: string } }) => c.child.id === child.id);
    expect(row).toBeDefined();
    expect(row.counts.PRESENT).toBe(0);
    expect(res.body.roster).toBe(res.body.children.length);
  });

  /** Another month's rows are another month's — the range is closed at both ends. */
  it("does not count a day outside the month asked for", async () => {
    await mark(a.child.id, "2026-01-31", "PRESENT");
    await mark(a.child.id, "2026-02-01", "PRESENT");
    await mark(a.child.id, "2026-03-01", "PRESENT");

    const res = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/attendance/summary?month=2026-02`),
      teacherA,
    );

    expect(res.status).toBe(200);
    expect(res.body.totals.PRESENT).toBe(1);
    expect(res.body.days).toHaveLength(1);
    expect(res.body.days[0].date).toBe("2026-02-01");
  });

  /**
   * ★ `2026-13` used to answer 200 with January 2027.
   *
   * `\d{2}` accepted it and `monthRange` rolled it over, so a typo in a URL —
   * or an off-by-one in a caller's month arithmetic — returned a different
   * month's register with nothing to say it had. Both this route and the
   * child's own month list read the same schema.
   */
  it("rejects a month that does not exist", async () => {
    const res = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/attendance/summary?month=2026-13`),
      teacherA,
    );
    expect(res.status).toBe(400);
  });

  it("an administrator may read any group in their kindergarten", async () => {
    const res = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/attendance/summary?month=2026-02`),
      await login(app, a.adminUser.username),
    );
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The register's batch save — PUT /groups/:id/attendance
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Many children, one status, one request.
 *
 * ★ Why it exists: the register used to send one `PUT /children/:id/
 * attendance/:date` per tap, so a teacher marking twenty-four children made
 * twenty-four independent writes and could end the morning with a register
 * that was half saved and looked finished. The meal register beside it has
 * taken a whole sitting in one transactional call since it shipped; these
 * assertions hold the two to the same behaviour.
 *
 * ★★ The authorization cases are the ones CLAUDE.md §4.1 requires, through
 * HTTP against the real route. A batch write is where a group check is most
 * tempting to skip — the ids are "already known to be in the group" — and
 * `recordGroupMeals` had exactly that omission for a while.
 */
// ═══════════════════════════════════════════════════════════════════════════
// The week grid behind the teacher's register
// ═══════════════════════════════════════════════════════════════════════════

describe("group range sheet", () => {
  async function mark(childId: string, date: string, status: string) {
    const res = await authed(
      request(server()).put(`/v1/children/${childId}/attendance/${date}`),
      teacherA,
    ).send({ status });
    if (res.status !== 200) throw new Error(`mark failed: ${res.status} ${res.text}`);
  }

  const range = (from: string, to: string) =>
    authed(
      request(server()).get(`/v1/groups/${a.group.id}/attendance/range?from=${from}&to=${to}`),
      teacherA,
    );

  it("returns every day in the span, in order, marked or not", async () => {
    await mark(a.child.id, "2026-02-10", "PRESENT");
    await mark(a.child.id, "2026-02-12", "SICK");

    const res = await range("2026-02-09", "2026-02-13");

    expect(res.status).toBe(200);
    // Five columns, including the two nobody marked — the register draws a
    // week, not only the days that happen to carry a row.
    expect(res.body.days).toEqual([
      "2026-02-09",
      "2026-02-10",
      "2026-02-11",
      "2026-02-12",
      "2026-02-13",
    ]);

    const row = res.body.rows.find((r: { child: { id: string } }) => r.child.id === a.child.id);
    expect(row.records["2026-02-10"].status).toBe("PRESENT");
    expect(row.records["2026-02-12"].status).toBe("SICK");
    // Absent from the map, not present-and-null: "nobody marked this day" and
    // "marked as absent" are different facts and the grid draws them apart.
    expect(row.records["2026-02-11"]).toBeUndefined();
  });

  it("lists a child with nothing recorded at all", async () => {
    const res = await range("2026-02-09", "2026-02-13");

    const row = res.body.rows.find((r: { child: { id: string } }) => r.child.id === a.child.id);
    expect(row).toBeDefined();
    expect(row.records).toEqual({});
  });

  it("never reaches another group's records", async () => {
    await mark(a.child.id, "2026-02-10", "PRESENT");

    const res = await authed(
      request(server()).get(
        `/v1/groups/${b.group.id}/attendance/range?from=2026-02-09&to=2026-02-13`,
      ),
      teacherA,
    );
    expect(res.status).toBe(404);
  });

  it("refuses a span wider than a month, rather than answering unbounded", () => {
    // §3.4 — no endpoint returns an unbounded set.
    return range("2026-01-01", "2026-06-30").expect(400);
  });

  it("refuses a range that ends before it starts", () => {
    return range("2026-02-13", "2026-02-09").expect(400);
  });

  /** 404, not 403 — §1.7, and the same answer the day sheet beside it gives. */
  /*
   * ★ The teacher's own download — a sibling of `/attendance/register/export`,
   * not a widening of it. That one is the whole kindergarten behind
   * `assertCanReadFinance`; this one is the one group `assertCanReadGroup`
   * already allows.
   */
  it("answers the same span as a spreadsheet, with the marks in it", async () => {
    await mark(a.child.id, "2026-02-10", "PRESENT");
    await mark(a.child.id, "2026-02-11", "SICK");

    const res = await authed(
      request(server()).get(
        `/v1/groups/${a.group.id}/attendance/range/export?from=2026-02-09&to=2026-02-13`,
      ),
      teacherA,
    )
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain("attachment");

    /*
     * ★ Read back, not weighed. §4.3's rule about PDFs is the same rule here:
     * a generator returning an empty workbook passes every "did it produce a
     * file" check, and the thing worth asserting is that the day the teacher
     * marked is the day the spreadsheet carries.
     */
    const ExcelJS = (await import("exceljs")).default;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body);
    const summary = book.worksheets.map((sheet) => sheet.name);
    expect(summary.length).toBeGreaterThan(0);

    const text = JSON.stringify(book.worksheets.map((sheet) => sheet.getSheetValues()));
    expect(text).toContain("Ирсэн");
    expect(text).toContain("Өвчтэй");

    /*
     * ★ 2026-09-12: "татаж авахаар нийт бодолтууд ерөөсөө орохгүй байна."
     *
     * The teacher's file is built by the same function as the director's, so
     * it gains the same two things: the totals the screen shows under and
     * beside the grid, and a sheet for the class's own figures.
     */
    expect(book.worksheets.map((sheet) => sheet.name)).toContain("Ангийн дүн");

    const grid = book.getWorksheet("Өдөр тутмын ирц")!;
    const headers = grid.getRow(3).values as unknown[];
    expect(headers.map(String)).toContain("Нийт");

    const classTotals = book.getWorksheet("Ангийн дүн")!;
    expect(String(classTotals.getRow(2).getCell(1).value)).toBe(a.group.name);
    // One child, one present day and one sick day — two marks recorded.
    expect(classTotals.getRow(2).getCell(9).value).toBe(2);
  });

  it("a teacher cannot export another group's register", async () => {
    const res = await authed(
      request(server()).get(
        `/v1/groups/${b.group.id}/attendance/range/export?from=2026-02-09&to=2026-02-13`,
      ),
      teacherA,
    );
    expect(res.status).toBe(404);
  });

  it("a guardian cannot read the group's register", async () => {
    const res = await authed(
      request(server()).get(
        `/v1/groups/${a.group.id}/attendance/range?from=2026-02-09&to=2026-02-13`,
      ),
      parentA,
    );
    expect(res.status).toBe(404);
  });
});

describe("group batch recording", () => {
  const DATE = "2026-02-10";
  const url = (groupId: string) => `/v1/groups/${groupId}/attendance`;

  it("an assigned teacher records the whole group in one request", async () => {
    const second = await createChild(a.kindergarten.id, { firstName: "Хоёрдугаар" });
    await enrollChild(a.kindergarten.id, second.id, a.group.id, a.schoolYear.id);

    const res = await authed(request(server()).put(url(a.group.id)), teacherA).send({
      date: DATE,
      entries: [
        { childId: a.child.id, status: "PRESENT" },
        { childId: second.id, status: "SICK" },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const rows = await db.attendance.findMany({
      where: { date: new Date(`${DATE}T00:00:00.000Z`), deletedAt: null },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.recordedById === a.teacherUser.id)).toBe(true);
    expect(rows.find((r) => r.childId === second.id)?.status).toBe("SICK");
  });

  it("an admin records without being assigned to the group", async () => {
    const res = await authed(
      request(server()).put(url(a.group.id)),
      await login(app, a.adminUser.username),
    ).send({ date: DATE, entries: [{ childId: a.child.id, status: "PRESENT" }] });

    expect(res.status).toBe(200);
  });

  /** A correction pass is the second half of what the register is for. */
  it("a second save updates in place rather than duplicating", async () => {
    const put = () => authed(request(server()).put(url(a.group.id)), teacherA);

    await put().send({ date: DATE, entries: [{ childId: a.child.id, status: "PRESENT" }] });
    const res = await put().send({
      date: DATE,
      entries: [{ childId: a.child.id, status: "ABSENT" }],
    });

    expect(res.status).toBe(200);

    const rows = await db.attendance.findMany({
      where: { childId: a.child.id, date: new Date(`${DATE}T00:00:00.000Z`), deletedAt: null },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("ABSENT");
  });

  /**
   * ★ The batch carries no `arrivedWith`, so a drop-off recorded earlier the
   * same day must survive it — the guard `upsertForChild` spells out one field
   * at a time, held here for the path that sends none of them.
   */
  it("leaves a drop-off already recorded that morning alone", async () => {
    await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/${DATE}`),
      teacherA,
    ).send({ status: "PRESENT", arrivedWith: "MOTHER" });

    await authed(request(server()).put(url(a.group.id)), teacherA).send({
      date: DATE,
      entries: [{ childId: a.child.id, status: "HALF_DAY" }],
    });

    const row = await db.attendance.findFirst({
      where: { childId: a.child.id, date: new Date(`${DATE}T00:00:00.000Z`), deletedAt: null },
    });
    expect(row?.status).toBe("HALF_DAY");
    expect(row?.arrivedWith).toBe("MOTHER");
  });

  /**
   * ★ A stale id is skipped, not fatal.
   *
   * The roster can change between the sheet being drawn and save being pressed.
   * Failing the call would discard every good mark over one transferred child.
   */
  it("skips a child who is not enrolled in this group and saves the rest", async () => {
    const res = await authed(request(server()).put(url(a.group.id)), teacherA).send({
      date: DATE,
      entries: [
        { childId: a.child.id, status: "PRESENT" },
        { childId: b.child.id, status: "PRESENT" },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    // ★★ And the skip is the isolation guarantee, not a convenience: the other
    // kindergarten's child must have no row at all.
    const foreign = await db.attendance.findMany({ where: { childId: b.child.id } });
    expect(foreign).toHaveLength(0);
  });

  it("rejects a batch in which no entry is enrolled here", async () => {
    const res = await authed(request(server()).put(url(a.group.id)), teacherA).send({
      date: DATE,
      entries: [{ childId: b.child.id, status: "PRESENT" }],
    });

    expect(res.status).toBe(400);
  });

  it("rejects a future date", async () => {
    const res = await authed(request(server()).put(url(a.group.id)), teacherA).send({
      date: "2099-01-01",
      entries: [{ childId: a.child.id, status: "PRESENT" }],
    });

    expect(res.status).toBe(400);
  });

  it("rejects an empty batch", async () => {
    const res = await authed(request(server()).put(url(a.group.id)), teacherA).send({
      date: DATE,
      entries: [],
    });

    expect(res.status).toBe(400);
  });

  // ── Authorization — CLAUDE.md §4.1 ────────────────────────────────────────

  it("a teacher not assigned to the group gets 404", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");
    const child = await createChild(a.kindergarten.id, { firstName: "Хол" });
    await enrollChild(a.kindergarten.id, child.id, other.id, a.schoolYear.id);

    const res = await authed(request(server()).put(url(other.id)), teacherA).send({
      date: DATE,
      entries: [{ childId: child.id, status: "PRESENT" }],
    });

    expect(res.status).toBe(404);
  });

  it("a teacher from another kindergarten gets 404", async () => {
    const res = await authed(
      request(server()).put(url(a.group.id)),
      await login(app, b.teacherUser.username),
    ).send({ date: DATE, entries: [{ childId: a.child.id, status: "PRESENT" }] });

    expect(res.status).toBe(404);
  });

  /**
   * ★ 404, not 403 — CLAUDE.md §1.7, and the same answer the meal register
   * gives a parent (`meal-register.test.ts`: "a parent can neither read nor
   * write the group register").
   *
   * A 403 here would confirm that this group id names a real group, which is
   * the oracle the rule closes. The route is `@Roles("TEACHER", "ADMIN")` and
   * a guardian holds neither, so `RolesGuard` refuses it before the service
   * runs — and that guard throws `NotFoundException` rather than a forbidden,
   * which is where the uniform 404 actually comes from.
   */
  it("a guardian gets 404, and writes nothing", async () => {
    const res = await authed(request(server()).put(url(a.group.id)), parentA).send({
      date: DATE,
      entries: [{ childId: a.child.id, status: "PRESENT" }],
    });

    expect(res.status).toBe(404);
    expect(await db.attendance.count()).toBe(0);
  });

  /**
   * ★ One row for the batch, not one per child — the act the teacher performed.
   * `recordGroupMeals` made the same choice; a per-child loop would describe
   * the loop rather than the decision.
   */
  it("writes a single audit row naming the group and the count", async () => {
    const second = await createChild(a.kindergarten.id, { firstName: "Хоёрдугаар" });
    await enrollChild(a.kindergarten.id, second.id, a.group.id, a.schoolYear.id);

    await authed(request(server()).put(url(a.group.id)), teacherA).send({
      date: DATE,
      entries: [
        { childId: a.child.id, status: "PRESENT" },
        { childId: second.id, status: "PRESENT" },
      ],
    });

    const rows = await db.auditLog.findMany({
      where: { objectType: "Attendance", objectId: a.group.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toMatchObject({ date: DATE, count: 2 });
  });
});

/**
 * What a teacher is asked to decide, and what they are merely told.
 *
 * ★ 2026-09-12, at the client's instruction: "хүүхдийн ирлээ, явлаа … багшаар
 * баталгаажиж зөвшөөрөгдөхгүй; зөвхөн чөлөөний хүсэлт л багшаар
 * баталгаажуулна."
 *
 * A parent saying "I dropped him off at 08:40" is reporting a fact about a
 * morning the teacher was present for. A leave request asks for a day that has
 * not happened yet.
 */
describe("which parent reports need a decision", () => {
  it("an arrival needs none, and stays out of the review queue", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({
      dateFrom: "2026-02-10",
      dateTo: "2026-02-10",
      requestedStatus: "PRESENT",
      arrivedWith: "MOTHER",
    });

    expect(res.status).toBe(201);
    expect(res.body.reviewStatus).toBe("APPROVED");

    const queue = await authed(
      request(server()).get("/v1/attendance-requests/review-queue"),
      teacherA,
    );
    expect(queue.body.items).toHaveLength(0);
  });

  it("a pickup needs none either", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({
      dateFrom: "2026-02-10",
      dateTo: "2026-02-10",
      requestedStatus: "PRESENT",
      pickedUpWith: "FATHER",
    });

    expect(res.body.reviewStatus).toBe("APPROVED");
  });

  /** The one that is genuinely a request: a day off that has not happened. */
  it("★ a leave request still waits for the teacher", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({
      dateFrom: "2026-02-12",
      dateTo: "2026-02-13",
      requestedStatus: "EXCUSED",
      reason: "Эмчид үзүүлнэ",
    });

    expect(res.body.reviewStatus).toBe("PENDING");

    const queue = await authed(
      request(server()).get("/v1/attendance-requests/review-queue"),
      teacherA,
    );
    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0].requestedStatus).toBe("EXCUSED");
  });

  /* The register stays the teacher's: their mark overwrites what was reported. */
  it("a teacher still corrects what a parent reported", async () => {
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/attendance-requests`),
      parentA,
    ).send({
      dateFrom: "2026-02-10",
      dateTo: "2026-02-10",
      requestedStatus: "PRESENT",
      arrivedWith: "MOTHER",
    });

    const marked = await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-02-10`),
      teacherA,
    ).send({ status: "SICK" });

    expect(marked.status).toBe(200);
    expect(marked.body.status).toBe("SICK");
  });
});
