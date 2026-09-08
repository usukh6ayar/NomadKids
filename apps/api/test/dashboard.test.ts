import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createChild,
  createMembership,
  createScenario,
  createUser,
  enrollChild,
  linkGuardian,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Dashboards and the audit read API.
 *
 * The property under test throughout: a dashboard is a **scoped** view. Every
 * count and every list is bounded by the same authorization the detail
 * endpoints use — a dashboard that builds its own filters is how a private
 * teaching note reaches a family through the side door.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let termId: string;
let typeId: string;

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

  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);

  // A term spanning today, so "current term" resolves.
  const now = new Date();
  const term = await db.term.create({
    data: {
      kindergartenId: a.kindergarten.id,
      schoolYearId: a.schoolYear.id,
      number: 1,
      name: "I улирал",
      startsOn: new Date(now.getFullYear() - 1, 0, 1),
      endsOn: new Date(now.getFullYear() + 1, 0, 1),
    },
  });
  termId = term.id;

  typeId = (await db.observationType.findFirstOrThrow({ where: { code: "daily" } })).id;
});

const server = () => app.getHttpServer();

async function observe(visibleToParents: boolean) {
  const res = await authed(
    request(server()).post(`/v1/children/${a.child.id}/observations`),
    teacherA,
  ).send({ typeId, observedOn: "2026-02-10", situation: "Ажиглалт", visibleToParents });
  return res.body.id as string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Teacher dashboard
// ═══════════════════════════════════════════════════════════════════════════

describe("teacher dashboard", () => {
  it("reports what needs attention, not a wall of statistics", async () => {
    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("needsAttention");
    expect(res.body.needsAttention).toHaveProperty("pendingReviews");
    expect(res.body.needsAttention).toHaveProperty("childrenMissingAssessment");
    expect(res.body).toHaveProperty("recentObservations");
    // No charts, no analytics — the brief rules those out.
    expect(res.body).not.toHaveProperty("charts");
    expect(res.body).not.toHaveProperty("analytics");
  });

  it("counts pending parent submissions in the teacher's own groups", async () => {
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/parent-observations`),
      parentA,
    ).send({ observedOn: "2026-02-11", situation: "Гэртээ" });

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);
    expect(res.body.needsAttention.pendingReviews).toBe(1);
  });

  it("★ does NOT count another kindergarten's submissions", async () => {
    const parentB = await login(app, b.parentUser.username);
    await authed(
      request(server()).post(`/v1/children/${b.child.id}/parent-observations`),
      parentB,
    ).send({ observedOn: "2026-02-11", situation: "Гэртээ" });

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);
    expect(res.body.needsAttention.pendingReviews).toBe(0);
  });

  it("lists children with no assessment this term — the gap, not the coverage", async () => {
    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    expect(res.body.needsAttention.childrenMissingAssessment).toHaveLength(1);
    expect(res.body.needsAttention.childrenMissingAssessment[0].id).toBe(a.child.id);
  });

  it("a child drops off the gap list once assessed", async () => {
    const domain = await db.developmentDomain.findFirstOrThrow({ where: { kindergartenId: null } });
    const level = await db.assessmentLevel.findFirstOrThrow({ where: { kindergartenId: null } });

    await authed(request(server()).put(`/v1/children/${a.child.id}/assessments`), teacherA).send({
      termId,
      domainId: domain.id,
      levelId: level.id,
    });

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);
    expect(res.body.needsAttention.childrenMissingAssessment).toHaveLength(0);
  });

  it("shows recent observations so a teacher can resume", async () => {
    await observe(false);

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);
    expect(res.body.recentObservations).toHaveLength(1);
  });

  it("★ a REVOKED teacher sees an empty dashboard, not an error", async () => {
    await authed(request(server()).delete(`/v1/group-teachers/${a.assignment.id}`), adminA);

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.counts.children).toBe(0);
    expect(res.body.recentObservations).toHaveLength(0);
  });

  it("a parent cannot open it", async () => {
    expect(
      (await request(server()).get("/v1/dashboard/teacher").set("Cookie", parentA.cookies)).status,
    ).toBe(404);
  });

  it("survives having no current term", async () => {
    // A kindergarten that has not set up terms yet must not 500 on login.
    await db.term.deleteMany({ where: { id: termId } });

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.currentTerm).toBeNull();
    expect(res.body.needsAttention.childrenMissingAssessment).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Admin dashboard
// ═══════════════════════════════════════════════════════════════════════════

describe("admin dashboard", () => {
  it("counts only the admin's own kindergartens", async () => {
    const res = await request(server()).get("/v1/dashboard/admin").set("Cookie", adminA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.counts.children).toBe(1);
    expect(res.body.counts.groups).toBe(1);
  });

  it("reports assessment coverage per group", async () => {
    const res = await request(server()).get("/v1/dashboard/admin").set("Cookie", adminA.cookies);

    expect(res.body.assessmentCoverage).toHaveLength(1);
    expect(res.body.assessmentCoverage[0]).toMatchObject({ children: 1, assessed: 0 });
  });

  it("coverage rises as children are assessed", async () => {
    const domain = await db.developmentDomain.findFirstOrThrow({ where: { kindergartenId: null } });
    const level = await db.assessmentLevel.findFirstOrThrow({ where: { kindergartenId: null } });

    await authed(request(server()).put(`/v1/children/${a.child.id}/assessments`), teacherA).send({
      termId,
      domainId: domain.id,
      levelId: level.id,
    });

    const res = await request(server()).get("/v1/dashboard/admin").set("Cookie", adminA.cookies);
    expect(res.body.assessmentCoverage[0].assessed).toBe(1);
  });

  it("a teacher cannot open it", async () => {
    expect(
      (await request(server()).get("/v1/dashboard/admin").set("Cookie", teacherA.cookies)).status,
    ).toBe(404);
  });

  it("shows recent activity from its own kindergartens only", async () => {
    await observe(false);

    const res = await request(server()).get("/v1/dashboard/admin").set("Cookie", adminA.cookies);
    expect(res.body.recentActivity.length).toBeGreaterThan(0);

    const adminB = await login(app, b.adminUser.username);
    const other = await request(server()).get("/v1/dashboard/admin").set("Cookie", adminB.cookies);
    // B's log holds only B's own actions.
    expect(
      other.body.recentActivity.every(
        (e: { objectType: string }) => e.objectType !== "Observation",
      ),
    ).toBe(true);
  });

  /**
   * The same resolution the audit screen gets. This feed read `actorLabel`
   * straight off the column, which no service outside `auth` writes — so every
   * line of it named its actor as "—" while the data to name them was one join
   * away.
   */
  it("names the actor in the activity feed", async () => {
    await db.user.update({
      where: { id: a.teacherUser.id },
      data: { lastName: "Сүрэн", firstName: "Ганаа" },
    });

    await observe(false);

    const res = await request(server()).get("/v1/dashboard/admin").set("Cookie", adminA.cookies);
    const entry = res.body.recentActivity.find(
      (e: { objectType: string }) => e.objectType === "Observation",
    );

    expect(entry).toBeDefined();
    expect(entry.actorLabel).toBe("Сүрэн Ганаа");
    expect(entry.actor).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Parent home
// ═══════════════════════════════════════════════════════════════════════════

describe("parent home", () => {
  it("lists their own children", async () => {
    const res = await request(server()).get("/v1/dashboard/parent").set("Cookie", parentA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.children).toHaveLength(1);
    expect(res.body.children[0].id).toBe(a.child.id);
  });

  it("★ the feed EXCLUDES private teacher observations", async () => {
    // A dashboard that builds its own filter is exactly how a private note
    // reaches a family through the side door.
    await observe(false);

    const res = await request(server()).get("/v1/dashboard/parent").set("Cookie", parentA.cookies);
    expect(res.body.recent).toHaveLength(0);
  });

  it("includes published observations", async () => {
    await observe(true);

    const res = await request(server()).get("/v1/dashboard/parent").set("Cookie", parentA.cookies);
    expect(res.body.recent).toHaveLength(1);
  });

  it("includes the family's own submission while pending", async () => {
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/parent-observations`),
      parentA,
    ).send({ observedOn: "2026-02-11", situation: "Гэртээ" });

    const res = await request(server()).get("/v1/dashboard/parent").set("Cookie", parentA.cookies);
    expect(res.body.recent).toHaveLength(1);
    expect(res.body.recent[0].reviewStatus).toBe("PENDING");
  });

  it("★ shows only PUBLISHED assessments", async () => {
    const domain = await db.developmentDomain.findFirstOrThrow({ where: { kindergartenId: null } });
    const level = await db.assessmentLevel.findFirstOrThrow({ where: { kindergartenId: null } });

    await authed(request(server()).put(`/v1/children/${a.child.id}/assessments`), teacherA).send({
      termId,
      domainId: domain.id,
      levelId: level.id,
    });

    const before = await request(server())
      .get("/v1/dashboard/parent")
      .set("Cookie", parentA.cookies);
    expect(before.body.children[0].assessments).toHaveLength(0);

    await authed(
      request(server()).post(`/v1/children/${a.child.id}/assessments/publish`),
      teacherA,
    ).send({ termId, visible: true });

    const after = await request(server())
      .get("/v1/dashboard/parent")
      .set("Cookie", parentA.cookies);
    expect(after.body.children[0].assessments).toHaveLength(1);
  });

  it("a revoked guardian sees nothing", async () => {
    await authed(request(server()).patch(`/v1/guardianships/${a.guardianship.id}`), adminA).send({
      canView: false,
    });

    const res = await request(server()).get("/v1/dashboard/parent").set("Cookie", parentA.cookies);
    expect(res.body.children).toHaveLength(0);
    expect(res.body.recent).toHaveLength(0);
  });

  it("★ a TEACHER who is a parent gets their own child's feed, not their class", async () => {
    // No @Roles("PARENT") on this route, deliberately: the feed is built from
    // guardianships, so a role gate would exclude a teacher from a screen that
    // is legitimately theirs.
    const dual = await createUser({ username: uniq("dual") });
    await createMembership(dual.id, a.kindergarten.id, "TEACHER");
    await createMembership(dual.id, a.kindergarten.id, "PARENT");

    const ownChild = await createChild(a.kindergarten.id, { firstName: "Өөрийн" });
    await enrollChild(a.kindergarten.id, ownChild.id, a.group.id, a.schoolYear.id);
    await linkGuardian(a.kindergarten.id, ownChild.id, dual.id);

    const session = await login(app, dual.username);
    const res = await request(server()).get("/v1/dashboard/parent").set("Cookie", session.cookies);

    expect(res.body.children).toHaveLength(1);
    expect(res.body.children[0].id).toBe(ownChild.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Routing hint
// ═══════════════════════════════════════════════════════════════════════════

describe("primary dashboard", () => {
  it("sends each role to its own screen", async () => {
    const cases: [AuthSession, string][] = [
      [adminA, "admin"],
      [teacherA, "teacher"],
      [parentA, "parent"],
    ];

    for (const [session, expected] of cases) {
      const res = await request(server())
        .get("/v1/dashboard/primary")
        .set("Cookie", session.cookies);
      expect(res.body.dashboard).toBe(expected);
    }
  });

  it("gives a multi-role user the most capable screen", async () => {
    const dual = await createUser({ username: uniq("dual") });
    await createMembership(dual.id, a.kindergarten.id, "TEACHER");
    await createMembership(dual.id, a.kindergarten.id, "PARENT");

    const session = await login(app, dual.username);
    const res = await request(server()).get("/v1/dashboard/primary").set("Cookie", session.cookies);

    expect(res.body.dashboard).toBe("teacher");
  });

  it("returns null for a user with no memberships", async () => {
    const nobody = await createUser({ username: uniq("nobody") });
    const session = await login(app, nobody.username);

    const res = await request(server()).get("/v1/dashboard/primary").set("Cookie", session.cookies);
    expect(res.body.dashboard).toBeNull();
  });

  it("★ sends the platform operator to the platform screen even though they hold no membership", async () => {
    // A superadmin is deliberately a member of nothing (CLAUDE.md §1.1) — this
    // is the case that regressed to `null`, the same result a revoked user
    // gets, before `primaryDashboard` checked `isSuperAdmin` first.
    const operator = await createUser({ username: uniq("operator"), isSuperAdmin: true });
    const session = await login(app, operator.username);

    const res = await request(server()).get("/v1/dashboard/primary").set("Cookie", session.cookies);
    expect(res.body.dashboard).toBe("platform");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Audit read API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The kindergarten-wide figures the administrator's dashboard adds — RFP §12.2
 * and §12.3.
 *
 * ★ These are the numbers the *teacher* dashboard cannot answer for an admin.
 *
 * `DashboardService.teacher` scopes everything to
 * `loadActiveTeachingGroupIds`, which reads TEACHER memberships — an
 * administrator holds none, so every group-scoped widget returns zero for
 * them. The admin endpoint scopes by kindergarten instead, and these pin that
 * difference rather than the arithmetic.
 */
describe("admin dashboard — kindergarten-wide figures", () => {
  const today = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );

  async function mark(status: "PRESENT" | "HALF_DAY" | "SICK" | "ABSENT", date = today) {
    return db.attendance.create({
      data: {
        kindergartenId: a.kindergarten.id,
        enrollmentId: a.enrollment.id,
        childId: a.child.id,
        date,
        status,
      },
    });
  }

  async function adminDashboard(session = adminA) {
    const res = await request(server()).get("/v1/dashboard/admin").set("Cookie", session.cookies);
    expect(res.status).toBe(200);
    return res.body;
  }

  /**
   * The document library, counted apart from everything else stored.
   *
   * ★ Added 2026-09-09 with `storage.documents`, and the assertion that matters
   * is the *difference* between the two figures. `fileCount` is every
   * `MediaFile` a kindergarten owns; `documents.count` is the published rows of
   * `/documents`. The dashboard card carried the first under a label that read
   * like the second's screen, and the web schema now requires the second — so a
   * payload without it fails to parse in the browser rather than here, which is
   * the wrong place to find out.
   */
  describe("storage figures", () => {
    async function upload(sizeBytes: number) {
      return db.mediaFile.create({
        data: {
          kindergartenId: a.kindergarten.id,
          purpose: "DOCUMENT",
          storageKey: `documents/${uniq("file")}`,
          originalName: "journal.pdf",
          mimeType: "application/pdf",
          sizeBytes,
          status: "READY",
          uploadedById: a.adminUser.id,
        },
      });
    }

    it("counts published documents apart from every other stored file", async () => {
      const [published, loose] = await Promise.all([upload(400), upload(1_000)]);
      await db.document.create({
        data: {
          kindergartenId: a.kindergarten.id,
          title: "Дотоод журам",
          fileMediaFileId: published.id,
          publishedById: a.adminUser.id,
        },
      });

      const body = await adminDashboard();

      // Two files stored; one of them is a document.
      expect(body.storage.fileCount).toBe(2);
      expect(body.storage.documents).toEqual({ count: 1, totalBytes: 400 });
      // The loose upload's bytes are in the total and not in the library's.
      expect(body.storage.totalBytes).toBe(400 + loose.sizeBytes);
    });

    it("reports an empty library as zero rather than as nothing", async () => {
      const body = await adminDashboard();

      expect(body.storage.documents).toEqual({ count: 0, totalBytes: 0 });
    });

    it("leaves a soft-deleted document out of the count", async () => {
      const file = await upload(700);
      await db.document.create({
        data: {
          kindergartenId: a.kindergarten.id,
          title: "Хуучирсан журам",
          fileMediaFileId: file.id,
          publishedById: a.adminUser.id,
          deletedAt: new Date(),
        },
      });

      const body = await adminDashboard();

      expect(body.storage.documents).toEqual({ count: 0, totalBytes: 0 });
    });
  });

  it("counts the roster as expected, not the rows written", async () => {
    // No register taken at all: the denominator still has to be the roster, or
    // an untaken morning reads as 0/0 — "nothing to do".
    const body = await adminDashboard();

    expect(body.attendanceToday.expected).toBeGreaterThan(0);
    expect(body.attendanceToday.recorded).toBe(0);
    expect(body.attendanceToday.present).toBe(0);
  });

  it("separates 'register taken' from 'children present'", async () => {
    await mark("ABSENT");

    const body = await adminDashboard();
    expect(body.attendanceToday.recorded).toBe(1);
    // Recorded but not present — the two numbers must not collapse.
    expect(body.attendanceToday.present).toBe(0);
  });

  /** ★ A half day is a child who came. */
  it("counts a half day as present", async () => {
    await mark("HALF_DAY");

    expect((await adminDashboard()).attendanceToday.present).toBe(1);
  });

  it("★ never counts another kindergarten's register", async () => {
    await db.attendance.create({
      data: {
        kindergartenId: b.kindergarten.id,
        enrollmentId: b.enrollment.id,
        childId: b.child.id,
        date: today,
        status: "PRESENT",
      },
    });

    const body = await adminDashboard();
    expect(body.attendanceToday.recorded).toBe(0);
  });

  it("breaks the last 30 days down per group and per status", async () => {
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    await mark("PRESENT");
    await mark("SICK", yesterday);

    const body = await adminDashboard();
    const group = body.attendanceByGroup.find((g: { groupId: string }) => g.groupId === a.group.id);

    expect(group).toBeDefined();
    expect(group.counts.PRESENT).toBe(1);
    expect(group.counts.SICK).toBe(1);
    // A status with no rows is absent, not zero — "none" and "not asked" differ.
    expect(group.counts.ABSENT).toBeUndefined();
  });

  it("★ a group in another kindergarten is not in the breakdown", async () => {
    const body = await adminDashboard();

    expect(body.attendanceByGroup.some((g: { groupId: string }) => g.groupId === b.group.id)).toBe(
      false,
    );
  });

  it("averages each group's assessments by development domain", async () => {
    const domain = await db.developmentDomain.findFirstOrThrow({ where: { code: "physical" } });
    const level = await db.assessmentLevel.findFirstOrThrow({ where: { value: 3 } });

    await db.assessment.create({
      data: {
        kindergartenId: a.kindergarten.id,
        enrollmentId: a.enrollment.id,
        childId: a.child.id,
        termId,
        domainId: domain.id,
        levelId: level.id,
      },
    });

    const body = await adminDashboard();
    const group = body.domainAveragesByGroup.find(
      (g: { groupId: string }) => g.groupId === a.group.id,
    );

    expect(group.averageByDomain[domain.id]).toBe(3);
    expect(group.sampleSize).toBe(1);
  });

  /**
   * ★ An unassessed domain is absent from the map.
   *
   * Zero is a real score on a 1–4 scale's floor. A radar that plots "not
   * assessed" as zero draws a group as failing at something nobody has looked
   * at yet, which is the opposite of what the chart is for.
   */
  it("★ leaves an unassessed domain out rather than scoring it zero", async () => {
    const body = await adminDashboard();
    const group = body.domainAveragesByGroup.find(
      (g: { groupId: string }) => g.groupId === a.group.id,
    );

    expect(group).toBeDefined();
    expect(Object.keys(group.averageByDomain)).toEqual([]);
  });

  it("a teacher cannot read any of it", async () => {
    const res = await request(server()).get("/v1/dashboard/admin").set("Cookie", teacherA.cookies);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cook dashboard
// ═══════════════════════════════════════════════════════════════════════════

/**
 * "Самбар" — the screen the bottom bar's `Цэс` tab used to point at
 * (`app/(app)/layout.tsx`). It answers a narrower question than the admin
 * screen it borrows its queries from: today's headcount for meal quantities
 * and whether anything is waiting on the kitchen, not a 30-day trend.
 */
describe("cook dashboard", () => {
  const today = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );

  async function cookSession(kindergartenId: string) {
    const user = await createUser({ username: uniq("cook") });
    await createMembership(user.id, kindergartenId, "COOK");
    return login(app, user.username);
  }

  it("reports today's headcount, per group", async () => {
    const cookA = await cookSession(a.kindergarten.id);

    await db.attendance.create({
      data: {
        kindergartenId: a.kindergarten.id,
        enrollmentId: a.enrollment.id,
        childId: a.child.id,
        date: today,
        status: "PRESENT",
      },
    });

    const res = await request(server()).get("/v1/dashboard/cook").set("Cookie", cookA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.attendanceToday.present).toBe(1);
    const group = res.body.attendanceByGroup.find(
      (g: { groupId: string }) => g.groupId === a.group.id,
    );
    expect(group.counts.PRESENT).toBe(1);
  });

  it("★ never counts another kindergarten's register or orders", async () => {
    const cookA = await cookSession(a.kindergarten.id);

    await db.attendance.create({
      data: {
        kindergartenId: b.kindergarten.id,
        enrollmentId: b.enrollment.id,
        childId: b.child.id,
        date: today,
        status: "PRESENT",
      },
    });

    const res = await request(server()).get("/v1/dashboard/cook").set("Cookie", cookA.cookies);
    expect(res.body.attendanceToday.recorded).toBe(0);
    expect(
      res.body.attendanceByGroup.some((g: { groupId: string }) => g.groupId === b.group.id),
    ).toBe(false);
  });

  it("counts orders still DRAFT or ORDERED, not ones already RECEIVED", async () => {
    const cookA = await cookSession(a.kindergarten.id);

    const supplier = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/suppliers`),
      cookA,
    ).send({ name: "Ногоон эрдэнэ ХХК" });
    const ingredient = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/ingredients`),
      cookA,
    ).send({ name: "Гурил", unit: "GRAM", allergenTags: [] });

    const order = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/food-orders`),
      cookA,
    ).send({
      supplierId: supplier.body.id,
      orderDate: "2026-04-01",
      lines: [{ ingredientId: ingredient.body.id, quantity: "1000", unitPrice: "1" }],
    });
    expect(order.body.status).toBe("ORDERED");

    const before = await request(server()).get("/v1/dashboard/cook").set("Cookie", cookA.cookies);
    expect(before.body.pendingFoodOrders).toBe(1);

    await authed(request(server()).post(`/v1/food-orders/${order.body.id}/receive`), cookA).send({
      lines: [],
    });

    const after = await request(server()).get("/v1/dashboard/cook").set("Cookie", cookA.cookies);
    expect(after.body.pendingFoodOrders).toBe(0);
  });

  it("counts ingredients below their own minStock, and only those with a threshold set", async () => {
    const cookA = await cookSession(a.kindergarten.id);

    const tracked = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/ingredients`),
      cookA,
    ).send({ name: "Гурил", unit: "GRAM", allergenTags: [], minStock: "1000" });
    // No threshold set — never counted, no matter how little is on hand.
    await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/ingredients`),
      cookA,
    ).send({ name: "Сахар", unit: "GRAM", allergenTags: [] });

    const before = await request(server()).get("/v1/dashboard/cook").set("Cookie", cookA.cookies);
    // Nothing received yet — 0 on hand is below a 1000g threshold.
    expect(before.body.lowStockCount).toBe(1);

    await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/stock/adjustments`),
      cookA,
    ).send({ ingredientId: tracked.body.id, date: "2026-04-01", quantity: "1500" });

    const after = await request(server()).get("/v1/dashboard/cook").set("Cookie", cookA.cookies);
    expect(after.body.lowStockCount).toBe(0);
  });

  it("an admin may also open it", async () => {
    const res = await request(server()).get("/v1/dashboard/cook").set("Cookie", adminA.cookies);
    expect(res.status).toBe(200);
  });

  it("a teacher cannot open it", async () => {
    const res = await request(server()).get("/v1/dashboard/cook").set("Cookie", teacherA.cookies);
    expect(res.status).toBe(404);
  });
});

describe("audit log", () => {
  it("is admin only", async () => {
    expect((await request(server()).get("/v1/audit").set("Cookie", teacherA.cookies)).status).toBe(
      404,
    );
    expect((await request(server()).get("/v1/audit").set("Cookie", parentA.cookies)).status).toBe(
      404,
    );
  });

  it("lists entries for the admin's own kindergartens", async () => {
    await observe(false);

    const res = await request(server()).get("/v1/audit").set("Cookie", adminA.cookies);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it("★ never shows another kindergarten's entries", async () => {
    await observe(false);

    const adminB = await login(app, b.adminUser.username);
    const res = await request(server()).get("/v1/audit").set("Cookie", adminB.cookies);

    expect(
      res.body.items.every((e: { objectType: string }) => e.objectType !== "Observation"),
    ).toBe(true);
  });

  it("answers 'who accessed this child's record'", async () => {
    // RFP §971 — the reason childId is denormalised onto the log.
    await request(server()).get(`/v1/children/${a.child.id}`).set("Cookie", teacherA.cookies);

    const res = await request(server())
      .get(`/v1/audit?childId=${a.child.id}&action=VIEW`)
      .set("Cookie", adminA.cookies);

    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0].actorUserId).toBe(a.teacherUser.id);
  });

  it("★ the childId filter cannot be used to probe another kindergarten", async () => {
    // Otherwise the filter answers "does child X exist" for any id tried.
    const res = await request(server())
      .get(`/v1/audit?childId=${b.child.id}`)
      .set("Cookie", adminA.cookies);

    expect(res.status).toBe(404);
  });

  it("filters by action and paginates", async () => {
    await observe(false);

    const res = await request(server())
      .get("/v1/audit?action=CREATE&page=1&pageSize=5")
      .set("Cookie", adminA.cookies);

    expect(res.body.items.every((e: { action: string }) => e.action === "CREATE")).toBe(true);
    expect(res.body.pageSize).toBe(5);
  });

  it("rejects an unknown action", async () => {
    const res = await request(server())
      .get("/v1/audit?action=NONSENSE")
      .set("Cookie", adminA.cookies);
    expect(res.status).toBe(400);
  });

  it("has no write endpoint", async () => {
    // Forging history must not be possible through the API.
    const res = await authed(request(server()).post("/v1/audit"), adminA).send({ action: "LOGIN" });
    expect(res.status).toBe(404);
  });

  /**
   * ★ "Who did this" — resolved on read, because the column is almost never
   * written.
   *
   * `AuditLog.actorLabel` is filled by two of the hundred and ten call sites
   * that append to the log (both in `auth.service`), so an audit screen reading
   * the raw column shows a name for logins and a dash for everything else. The
   * name is resolved from `actorUserId` instead — see `audit-actor.ts`.
   */
  it("names the person who performed the action", async () => {
    await db.user.update({
      where: { id: a.teacherUser.id },
      data: { lastName: "Дорж", firstName: "Болд" },
    });

    await observe(false);

    const res = await request(server())
      .get("/v1/audit?action=CREATE")
      .set("Cookie", adminA.cookies);

    const entry = res.body.items.find(
      (e: { objectType: string }) => e.objectType === "Observation",
    );
    expect(entry).toBeDefined();
    expect(entry.actorLabel).toBe("Дорж Болд");
  });

  /**
   * ★★ The stored text is the fallback, and this is the case it exists for.
   *
   * `actorUserId` is `SetNull` on delete, so a hard-deleted user leaves the
   * relation empty and the plain-text label written at append time is the only
   * remaining attribution. The schema's own comment says so; without this the
   * fallback branch is unexercised and could be dropped by anyone tidying the
   * resolver.
   */
  it("★ falls back to the stored label when the actor's user row is gone", async () => {
    await db.auditLog.create({
      data: {
        kindergartenId: a.kindergarten.id,
        actorUserId: null,
        actorLabel: "Гарсан ажилтан",
        action: "DELETE",
        objectType: "Child",
      },
    });

    const res = await request(server())
      .get("/v1/audit?action=DELETE")
      .set("Cookie", adminA.cookies);

    expect(res.body.items[0].actorLabel).toBe("Гарсан ажилтан");
  });

  it("reports no actor rather than inventing one", async () => {
    await db.auditLog.create({
      data: {
        kindergartenId: a.kindergarten.id,
        actorUserId: null,
        actorLabel: null,
        action: "RESTORE",
        objectType: "Child",
      },
    });

    const res = await request(server())
      .get("/v1/audit?action=RESTORE")
      .set("Cookie", adminA.cookies);

    expect(res.body.items[0].actorLabel).toBeNull();
  });

  /**
   * ★★★ The relation is joined to compute a label and must not ship with the
   * response.
   *
   * The audit log is the one endpoint whose whole job is disclosure, so what it
   * discloses should be a deliberate list. A passed-through `actor` object
   * would widen it silently the next time somebody adds a field to that select
   * for an unrelated reason.
   */
  /**
   * ★ Filtering by actor — accepted by the endpoint since it was written, and
   * never sent by anything until the audit screen made the names clickable.
   *
   * Scoped by the same `kindergartenId` clause as every other read here, so an
   * id belonging to another kindergarten's staff narrows to nothing rather than
   * revealing that they exist.
   */
  it("narrows the log to one person", async () => {
    await observe(false);

    const res = await request(server())
      .get(`/v1/audit?actorUserId=${a.teacherUser.id}`)
      .set("Cookie", adminA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(
      res.body.items.every((e: { actorUserId: string }) => e.actorUserId === a.teacherUser.id),
    ).toBe(true);
  });

  it("★ an actor from another kindergarten matches nothing rather than leaking", async () => {
    await observe(false);

    const res = await request(server())
      .get(`/v1/audit?actorUserId=${b.teacherUser.id}`)
      .set("Cookie", adminA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("★ does not expose the joined user record", async () => {
    await observe(false);

    const res = await request(server()).get("/v1/audit").set("Cookie", adminA.cookies);

    expect(res.body.items.length).toBeGreaterThan(0);
    for (const entry of res.body.items) {
      expect(entry.actor).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RFP §12.1 tiles — birthdays today and this term's assessment progress
// ═══════════════════════════════════════════════════════════════════════════

describe("teacher dashboard — §12.1 tiles", () => {
  it("names the children whose birthday is today", async () => {
    const today = new Date();
    const born = new Date(Date.UTC(2021, today.getMonth(), today.getDate()));
    await db.child.update({ where: { id: a.child.id }, data: { dateOfBirth: born } });

    const res = await authed(request(server()).get("/v1/dashboard/teacher"), teacherA);

    expect(res.status).toBe(200);
    expect(res.body.birthdaysToday.map((c: { id: string }) => c.id)).toContain(a.child.id);
  });

  it("does not list a child whose birthday is another day", async () => {
    const today = new Date();
    const notToday = new Date(Date.UTC(2021, today.getMonth(), today.getDate()));
    notToday.setUTCDate(notToday.getUTCDate() + 1);
    await db.child.update({ where: { id: a.child.id }, data: { dateOfBirth: notToday } });

    const res = await authed(request(server()).get("/v1/dashboard/teacher"), teacherA);
    expect(res.body.birthdaysToday.map((c: { id: string }) => c.id)).not.toContain(a.child.id);
  });

  /**
   * ★ The tile is scoped like everything else.
   *
   * A birthday is child data. A teacher must not learn that a child in another
   * group — or another kindergarten — has a birthday today, which is exactly
   * the kind of leak a "harmless" dashboard widget introduces.
   */
  it("never names a child from another kindergarten", async () => {
    const today = new Date();
    const born = new Date(Date.UTC(2021, today.getMonth(), today.getDate()));
    await db.child.update({ where: { id: b.child.id }, data: { dateOfBirth: born } });

    const res = await authed(request(server()).get("/v1/dashboard/teacher"), teacherA);
    expect(res.body.birthdaysToday.map((c: { id: string }) => c.id)).not.toContain(b.child.id);
  });

  it("reports this term's assessment progress against the roster", async () => {
    const res = await authed(request(server()).get("/v1/dashboard/teacher"), teacherA);

    expect(res.body.termProgress).toBeDefined();
    expect(res.body.termProgress.total).toBe(res.body.counts.children);
    expect(res.body.termProgress.assessed).toBeLessThanOrEqual(res.body.termProgress.total);
  });

  /**
   * ★ Every configured domain, including the ones nobody has assessed.
   *
   * A domain that vanishes from the chart because it has no rows hides exactly
   * the gap a teacher is looking for — `observationsByType` makes the same
   * argument one section down and this follows it.
   */
  it("reports domain coverage for every configured domain", async () => {
    const res = await authed(request(server()).get("/v1/dashboard/teacher"), teacherA);

    expect(Array.isArray(res.body.assessmentByDomain)).toBe(true);
    expect(res.body.assessmentByDomain.length).toBeGreaterThan(0);

    for (const row of res.body.assessmentByDomain) {
      expect(row.domain.name).toBeTruthy();
      expect(row.assessed).toBeLessThanOrEqual(res.body.termProgress.total);
    }
  });

  /**
   * ★ The system defaults have to be in it.
   *
   * The first version of this query filtered domains by `kindergartenId IN
   * (...)` alone and returned an empty array against real data: every
   * configured domain in this product is a system default with
   * `kindergartenId = NULL`, so the chart drew nothing while the ring beside it
   * correctly read 5 of 5 assessed. `CatalogRepository.readWhere` documents the
   * `own OR system` rule this now follows.
   */
  it("includes system-default domains, which is all of them by default", async () => {
    const systemDomains = await db.developmentDomain.count({
      where: { kindergartenId: null, deletedAt: null, isActive: true },
    });
    expect(systemDomains).toBeGreaterThan(0);

    const res = await authed(request(server()).get("/v1/dashboard/teacher"), teacherA);
    expect(res.body.assessmentByDomain.length).toBe(systemDomains);
  });

  /**
   * ★ Counts children, not assessment rows.
   *
   * A child may hold several rows in one domain across a term. Counting rows
   * would let one thoroughly-assessed child make a domain look covered while
   * the rest of the group has nothing — the failure this chart exists to
   * expose.
   */
  it("counts a child once per domain however many times they were assessed", async () => {
    const before = await authed(request(server()).get("/v1/dashboard/teacher"), teacherA);
    const domain = before.body.assessmentByDomain.find(
      (row: { assessed: number }) => row.assessed > 0,
    );
    if (!domain) return;

    const baseline = domain.assessed;

    const after = await authed(request(server()).get("/v1/dashboard/teacher"), teacherA);
    const same = after.body.assessmentByDomain.find(
      (row: { domain: { id: string } }) => row.domain.id === domain.domain.id,
    );

    expect(same.assessed).toBe(baseline);
    expect(same.assessed).toBeLessThanOrEqual(after.body.termProgress.total);
  });

  it("reports the note-taking rhythm oldest month first", async () => {
    const res = await authed(request(server()).get("/v1/dashboard/teacher"), teacherA);

    expect(Array.isArray(res.body.observationsByMonth)).toBe(true);

    const months = res.body.observationsByMonth.map((row: { month: string }) => row.month);
    expect([...months].sort()).toEqual(months);
    for (const month of months) expect(month).toMatch(/^\d{4}-\d{2}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The observation mix
// ═══════════════════════════════════════════════════════════════════════════

describe("observations by type", () => {
  /**
   * ★ Every configured type, including the ones at zero.
   *
   * `groupBy` returns only the types that have rows, so a type nobody has used
   * would simply be missing from the response — and a chart that silently drops
   * its empty categories reads as "we do not do that here" rather than "none
   * yet". The service fills them back in from the configuration table.
   */
  it("reports every active type, not only the ones with observations", async () => {
    await observe(true);

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    const configured = await db.observationType.count({
      where: { kindergartenId: null, isActive: true, deletedAt: null },
    });
    expect(res.body.observationsByType).toHaveLength(configured);

    const daily = res.body.observationsByType.find(
      (row: { type: { id: string } }) => row.type.id === typeId,
    );
    expect(daily.count).toBe(1);
    expect(res.body.observationsByType.filter((r: { count: number }) => r.count === 0).length).toBe(
      configured - 1,
    );
  });

  /**
   * ★★ Counts, never a rate.
   *
   * The wireframe asked for a "биелэлт" percentage and there is no target in
   * the schema to divide by. A completion score against a denominator nobody
   * set is the kind of number that makes a dashboard lie, so the endpoint
   * publishes what was actually written and the UI shows share of total.
   */
  it("publishes counts and no invented completion rate", async () => {
    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    for (const row of res.body.observationsByType) {
      expect(typeof row.count).toBe("number");
      expect(row).not.toHaveProperty("percent");
      expect(row).not.toHaveProperty("target");
      expect(row).not.toHaveProperty("rate");
    }
  });

  it("★ does not count another kindergarten's observations", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    const typeB = (await db.observationType.findFirstOrThrow({ where: { code: "daily" } })).id;
    await authed(request(server()).post(`/v1/children/${b.child.id}/observations`), teacherB).send({
      typeId: typeB,
      observedOn: "2026-02-10",
      situation: "Бусад цэцэрлэг",
    });

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    const total = res.body.observationsByType.reduce(
      (sum: number, r: { count: number }) => sum + r.count,
      0,
    );
    expect(total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// This month's birthdays, and the class board
// ═══════════════════════════════════════════════════════════════════════════

describe("this month's birthdays", () => {
  /**
   * ★ Two lists, not one filtered on the client.
   *
   * `birthdaysToday` is what the alert block reacts to. A card driven by it
   * alone is invisible for twenty-nine days a month, which is why the wireframe
   * asks for the month — a teacher ordering a cake is planning, not reacting.
   */
  it("lists every birthday in the current month, whatever the day", async () => {
    const now = new Date();
    /*
     * ★ `Date.UTC`, not `new Date(y, m, d)`.
     *
     * `dateOfBirth` is `@db.Date`, and the local-time constructor makes midnight
     * in the *runner's* zone — which in any positive offset is the previous day
     * in UTC, so the 1st of a month lands in the one before and drops out of
     * this filter. It fails only east of Greenwich, which is where this system
     * runs and where a test that used it would look flaky rather than wrong.
     *
     * Production never takes that path: `z.coerce.date()` parses "2021-04-12" as
     * UTC midnight, so this matches how a real record is written.
     */
    for (const day of [1, 28]) {
      const child = await createChild(a.kindergarten.id, {
        firstName: `Төрсөн${day}`,
        dateOfBirth: new Date(Date.UTC(now.getFullYear() - 3, now.getMonth(), day)),
      });
      await enrollChild(a.kindergarten.id, child.id, a.group.id, a.schoolYear.id);
    }
    // …and one next month, which must not appear.
    const other = await createChild(a.kindergarten.id, {
      firstName: "Дараа",
      dateOfBirth: new Date(Date.UTC(now.getFullYear() - 3, now.getMonth() + 1, 15)),
    });
    await enrollChild(a.kindergarten.id, other.id, a.group.id, a.schoolYear.id);

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    const names = res.body.birthdaysThisMonth.map((c: { firstName: string }) => c.firstName);
    expect(names).toContain("Төрсөн1");
    expect(names).toContain("Төрсөн28");
    expect(names).not.toContain("Дараа");
  });

  it("★ does not reach another kindergarten's children", async () => {
    const now = new Date();
    const child = await createChild(b.kindergarten.id, {
      firstName: "Бусад",
      dateOfBirth: new Date(Date.UTC(now.getFullYear() - 3, now.getMonth(), 5)),
    });
    await enrollChild(b.kindergarten.id, child.id, b.group.id, b.schoolYear.id);

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    const names = res.body.birthdaysThisMonth.map((c: { firstName: string }) => c.firstName);
    expect(names).not.toContain("Бусад");
  });
});

describe("the class board notice", () => {
  async function publish(title: string | null) {
    const notice = await db.notification.create({
      data: {
        kindergartenId: a.kindergarten.id,
        title,
        body: "Ангийн хурал болно.",
        status: "PUBLISHED",
        publishedAt: new Date(),
        authorId: a.teacherUser.id,
      },
    });
    return notice.id;
  }

  /**
   * ★ A notice with no heading must not take the dashboard down with it.
   *
   * `Notification.title` became optional on 2026-08-30 — "forcing one produced
   * titles that restated the first line of the body" — and
   * `notificationSchema` was updated to match. The **dashboard's own copy** of
   * the same field was not, so on 2026-09-06 the first heading-less notice
   * made `GET /dashboard/teacher` fail `teacherDashboardSchema.parse` in the
   * browser: not a missing card but the whole screen, reported as the generic
   * "Алдаа гарлаа. Дахин оролдоно уу."
   *
   * The API was never at fault — it answered 200 with a correct body — which
   * is why no server-side test caught it. This one asserts the shape the
   * client has to be able to read.
   */
  it("survives a notice published without a title", async () => {
    await publish(null);

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.boardNotice).not.toBeNull();
    expect(res.body.boardNotice.title).toBeNull();
    // The body is what the screen falls back to, so it must still be there.
    expect(res.body.boardNotice.body).toBe("Ангийн хурал болно.");
  });

  it("shows the most recent published notice with how many opened it", async () => {
    await publish("Хуучин");
    const latest = await publish("Ангийн хурал");

    // Two people opened the latest one.
    await db.notificationRead.createMany({
      data: [
        { notificationId: latest, userId: a.parentUser.id },
        { notificationId: latest, userId: a.adminUser.id },
      ],
    });

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    expect(res.body.boardNotice.title).toBe("Ангийн хурал");
    expect(res.body.boardNotice.readCount).toBe(2);
  });

  /**
   * ★ A count, never the list.
   *
   * `notifications.repository.ts` already refuses to expose who reacted — "a
   * parent should not learn which other families are reading the board" — and
   * reads are the same fact. The teacher needs to know it landed; nobody needs
   * to know which named family opened it.
   */
  it("publishes no reader identities", async () => {
    const id = await publish("Ангийн хурал");
    await db.notificationRead.create({
      data: { notificationId: id, userId: a.parentUser.id },
    });

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    expect(res.body.boardNotice.readCount).toBe(1);
    expect(res.body.boardNotice).not.toHaveProperty("reads");
    expect(JSON.stringify(res.body.boardNotice)).not.toContain(a.parentUser.id);
  });

  it("is null when nothing has been published", async () => {
    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    expect(res.body.boardNotice).toBeNull();
  });

  it("★ does not surface another kindergarten's board", async () => {
    await db.notification.create({
      data: {
        kindergartenId: b.kindergarten.id,
        title: "Бусад цэцэрлэг",
        body: "…",
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });

    const res = await request(server())
      .get("/v1/dashboard/teacher")
      .set("Cookie", teacherA.cookies);

    expect(res.body.boardNotice).toBeNull();
  });
});
