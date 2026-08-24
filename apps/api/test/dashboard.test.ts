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
  app.get(RateLimitService).resetAll();

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
    await authed(
      request(server()).post(`/v1/children/${b.child.id}/observations`),
      teacherB,
    ).send({ typeId: typeB, observedOn: "2026-02-10", situation: "Бусад цэцэрлэг" });

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
