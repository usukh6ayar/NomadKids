import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Administrator-editable configuration — RFP §2.1, §5.2, §6.1, §6.2.
 *
 * ★ The discriminating rule in this whole module is the asymmetry between what
 * a director may READ and what they may WRITE.
 *
 * `kindergartenId = NULL` is a system default shared by every kindergarten.
 * Reads include them, or a teacher's screen has no domain names to render.
 * Writes must not: a director editing a system row would change every other
 * kindergarten's configuration, which is a cross-tenant write wearing a
 * settings screen as a disguise. docs/SECURITY.md §6.2 names it
 * `test_a_director_cannot_open_a_system_domains_edit_form`.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;

/**
 * ★ Sessions other than `adminA` are logged in lazily, and memoised per test.
 *
 * Four eager logins in `beforeEach` is 120 across this file, of which about a
 * dozen are used. The suite shares one machine's sockets and one Redis, and
 * `IMPLEMENTATION_STATUS.md` (Phase 5) records what that pressure looks like
 * when it tips over: a login answering 404 or 400, in a different file on every
 * run. Not paying for sessions a test never touches is the cheap half of
 * staying under it.
 */
let sessions: Map<string, Promise<AuthSession>>;

function as(username: string): Promise<AuthSession> {
  let session = sessions.get(username);
  if (!session) {
    session = login(app, username);
    sessions.set(username, session);
  }
  return session;
}

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

  sessions = new Map();
  adminA = await as(a.adminUser.username);
});

const server = () => app.getHttpServer();

/** A domain owned by kindergarten A. */
async function ownDomain(scenario: Scenario = a) {
  return db.developmentDomain.create({
    data: {
      kindergartenId: scenario.kindergarten.id,
      name: "Хөгжлийн чиглэл",
      code: `custom_${Math.random().toString(36).slice(2, 8)}`,
    },
  });
}

/** A seeded system row — shared by every kindergarten, owned by none. */
async function systemDomain() {
  return db.developmentDomain.findFirstOrThrow({ where: { kindergartenId: null } });
}

// ═══════════════════════════════════════════════════════════════════════════
// Role separation
// ═══════════════════════════════════════════════════════════════════════════

describe("who may reach the configuration at all", () => {
  it("a teacher cannot reach the configuration", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/development-domains`),
      await as(a.teacherUser.username),
    );
    expect(res.status).toBe(404);
  });

  it("a guardian cannot reach the configuration", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/development-domains`),
      await as(a.parentUser.username),
    );
    expect(res.status).toBe(404);
  });

  it("a teacher cannot create a development domain", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/development-domains`),
      await as(a.teacherUser.username),
    ).send({ name: "Шинэ", code: "shine" });
    expect(res.status).toBe(404);
  });

  it("an unauthenticated request gets 401", async () => {
    const res = await request(server()).get(
      `/v1/kindergartens/${a.kindergarten.id}/development-domains`,
    );
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-kindergarten isolation
// ═══════════════════════════════════════════════════════════════════════════

describe("cross-kindergarten isolation", () => {
  it("a director cannot list another kindergarten's configuration", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${b.kindergarten.id}/development-domains`),
      adminA,
    );
    expect(res.status).toBe(404);
  });

  it("a director cannot create in another kindergarten", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${b.kindergarten.id}/development-domains`),
      adminA,
    ).send({ name: "Хулгай", code: "hulgai" });
    expect(res.status).toBe(404);
  });

  it("a director cannot edit another kindergarten's domain", async () => {
    const theirs = await ownDomain(b);
    const res = await authed(
      request(server()).patch(`/v1/development-domains/${theirs.id}`),
      adminA,
    ).send({ name: "Өөрчилсөн" });

    expect(res.status).toBe(404);

    // And it really did not change — a 404 that still wrote would be worse
    // than a 200.
    const after = await db.developmentDomain.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.name).toBe(theirs.name);
  });

  it("a director cannot deactivate another kindergarten's domain", async () => {
    const theirs = await ownDomain(b);
    const res = await authed(
      request(server()).delete(`/v1/development-domains/${theirs.id}`),
      adminA,
    );

    expect(res.status).toBe(404);
    expect(
      (await db.developmentDomain.findUniqueOrThrow({ where: { id: theirs.id } })).isActive,
    ).toBe(true);
  });

  it("an unknown id is indistinguishable from a forbidden one", async () => {
    const res = await authed(
      request(server()).patch("/v1/development-domains/00000000-0000-4000-8000-000000000000"),
      adminA,
    ).send({ name: "Хоосон" });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// System rows — read yes, write no
// ═══════════════════════════════════════════════════════════════════════════

describe("system rows", () => {
  it("a director sees the system rows in their list, marked as such", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/development-domains`),
      adminA,
    );

    expect(res.status).toBe(200);
    const system = res.body.filter((row: { isSystem: boolean }) => row.isSystem);
    expect(system.length).toBeGreaterThan(0);
  });

  /** ★ `test_a_director_cannot_open_a_system_domains_edit_form`. */
  it("a director cannot edit a system domain", async () => {
    const shared = await systemDomain();
    const res = await authed(
      request(server()).patch(`/v1/development-domains/${shared.id}`),
      adminA,
    ).send({ name: "Миний нэр" });

    expect(res.status).toBe(404);
    expect((await db.developmentDomain.findUniqueOrThrow({ where: { id: shared.id } })).name).toBe(
      shared.name,
    );
  });

  it("a director cannot deactivate a system domain", async () => {
    const shared = await systemDomain();
    const res = await authed(
      request(server()).delete(`/v1/development-domains/${shared.id}`),
      adminA,
    );

    expect(res.status).toBe(404);
    expect(
      (await db.developmentDomain.findUniqueOrThrow({ where: { id: shared.id } })).isActive,
    ).toBe(true);
  });

  it("a director cannot edit a system assessment level", async () => {
    const shared = await db.assessmentLevel.findFirstOrThrow({ where: { kindergartenId: null } });
    const res = await authed(
      request(server()).patch(`/v1/assessment-levels/${shared.id}`),
      adminA,
    ).send({ label: "Өөрийн нэр" });
    expect(res.status).toBe(404);
  });

  it("a director cannot edit a system observation type", async () => {
    const shared = await db.observationType.findFirstOrThrow({ where: { kindergartenId: null } });
    const res = await authed(
      request(server()).patch(`/v1/observation-types/${shared.id}`),
      adminA,
    ).send({ name: "Өөрийн нэр" });
    expect(res.status).toBe(404);
  });

  /**
   * The override route: a director who wants different wording creates their
   * own row rather than editing the shared one.
   */
  it("a director may create their own row instead", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/development-domains`),
      adminA,
    ).send({ name: "Хөгжимт хөдөлгөөн", code: "music_movement", color: "#4f46e5" });

    expect(res.status).toBe(201);
    expect(res.body.kindergartenId).toBe(a.kindergarten.id);

    // And kindergarten B does not see it.
    const theirList = await authed(
      request(server()).get(`/v1/kindergartens/${b.kindergarten.id}/development-domains`),
      await as(b.adminUser.username),
    );
    expect(theirList.body.some((row: { id: string }) => row.id === res.body.id)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Development domains
// ═══════════════════════════════════════════════════════════════════════════

describe("development domains", () => {
  it("creates, updates and deactivates", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/development-domains`),
      adminA,
    ).send({ name: "Бүтээлч сэтгэлгээ", code: "creative", order: 5 });
    expect(created.status).toBe(201);

    const updated = await authed(
      request(server()).patch(`/v1/development-domains/${created.body.id}`),
      adminA,
    ).send({ name: "Бүтээлч байдал", color: "#16a34a" });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Бүтээлч байдал");

    const removed = await authed(
      request(server()).delete(`/v1/development-domains/${created.body.id}`),
      adminA,
    );
    expect(removed.status).toBe(200);
    expect(removed.body.isActive).toBe(false);
  });

  /**
   * ★ Deactivation is not deletion.
   *
   * Published assessments point at these rows and a term report from last year
   * still has to render the criterion it was written against. `isActive: false`
   * takes it out of the pickers; `deletedAt` would orphan history.
   */
  it("deactivating leaves the row and its history intact", async () => {
    const domain = await ownDomain();
    await authed(request(server()).delete(`/v1/development-domains/${domain.id}`), adminA);

    const row = await db.developmentDomain.findUniqueOrThrow({ where: { id: domain.id } });
    expect(row.isActive).toBe(false);
    expect(row.deletedAt).toBeNull();
  });

  it("a duplicate code is a 409, not a 500", async () => {
    await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/development-domains`),
      adminA,
    ).send({ name: "Нэг", code: "duplicate_code" });

    const second = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/development-domains`),
      adminA,
    ).send({ name: "Хоёр", code: "duplicate_code" });

    expect(second.status).toBe(409);
  });

  /**
   * ★ `code` is the stable key. Renaming is a display change; re-coding
   * silently repoints everything that looks the row up.
   */
  it("ignores an attempt to change the code", async () => {
    const domain = await ownDomain();
    const res = await authed(
      request(server()).patch(`/v1/development-domains/${domain.id}`),
      adminA,
    ).send({ name: "Шинэ нэр", code: "hijacked" });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(domain.code);
  });

  it("refuses a code that is not a machine key", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/development-domains`),
      adminA,
    ).send({ name: "Хэл яриа", code: "Хэл яриа" });
    expect(res.status).toBe(400);
  });

  it("refuses a colour that is not #rrggbb", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/development-domains`),
      adminA,
    ).send({ name: "Өнгө", code: "colour_test", color: "red" });
    expect(res.status).toBe(400);
  });

  it("reports how many assessments a deactivated domain still carries", async () => {
    const domain = await ownDomain();
    const res = await authed(
      request(server()).delete(`/v1/development-domains/${domain.id}`),
      adminA,
    );
    expect(res.body.assessmentCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Assessment levels
// ═══════════════════════════════════════════════════════════════════════════

describe("assessment levels", () => {
  it("creates and updates a level", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/assessment-levels`),
      adminA,
    ).send({ value: 2, label: "Хөгжиж байгаа", color: "#f59e0b" });
    expect(created.status).toBe(201);

    const updated = await authed(
      request(server()).patch(`/v1/assessment-levels/${created.body.id}`),
      adminA,
    ).send({ label: "Хөгжиж буй" });
    expect(updated.body.label).toBe("Хөгжиж буй");
  });

  /**
   * ★★ `value` is immutable, and this is the sharpest version of the rule.
   *
   * Published assessments point at the level and reports render "3 / 4" from
   * it. Editing the number rewrites what a family was already told about their
   * child last term, with nothing recording that it changed.
   */
  it("ignores an attempt to change a level's value", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/assessment-levels`),
      adminA,
    ).send({ value: 3, label: "Хүлээгдэж буй түвшинд" });

    const res = await authed(
      request(server()).patch(`/v1/assessment-levels/${created.body.id}`),
      adminA,
    ).send({ label: "Өөр нэр", value: 1 });

    expect(res.status).toBe(200);
    expect(res.body.value).toBe(3);
  });

  it("refuses a value outside 1..4", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/assessment-levels`),
      adminA,
    ).send({ value: 7, label: "Долоо" });
    expect(res.status).toBe(400);
  });

  it("a duplicate value in one kindergarten is a 409", async () => {
    await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/assessment-levels`),
      adminA,
    ).send({ value: 4, label: "Давсан" });

    const second = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/assessment-levels`),
      adminA,
    ).send({ value: 4, label: "Дахин давсан" });

    expect(second.status).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Observation types
// ═══════════════════════════════════════════════════════════════════════════

describe("observation types", () => {
  it("creates, updates and deactivates a type", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/observation-types`),
      adminA,
    ).send({ name: "Аяллын ажиглалт", code: "excursion" });
    expect(created.status).toBe(201);

    const updated = await authed(
      request(server()).patch(`/v1/observation-types/${created.body.id}`),
      adminA,
    ).send({ name: "Аялал" });
    expect(updated.body.name).toBe("Аялал");

    const removed = await authed(
      request(server()).delete(`/v1/observation-types/${created.body.id}`),
      adminA,
    );
    expect(removed.body.isActive).toBe(false);
    expect(removed.body.observationCount).toBe(0);
  });

  /**
   * A new type is usable immediately: the read path teachers use is the same
   * table, filtered to active rows.
   */
  it("a new type appears on the teacher's picker", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/observation-types`),
      adminA,
    ).send({ name: "Аяллын ажиглалт", code: "excursion" });

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/observations/types`),
      await as(a.teacherUser.username),
    );

    expect(res.body.some((t: { id: string }) => t.id === created.body.id)).toBe(true);
  });

  /** And a deactivated one disappears from it without breaking old records. */
  it("a deactivated type leaves the picker", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/observation-types`),
      adminA,
    ).send({ name: "Түр", code: "temporary" });

    await authed(request(server()).delete(`/v1/observation-types/${created.body.id}`), adminA);

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/observations/types`),
      await as(a.teacherUser.username),
    );

    expect(res.body.some((t: { id: string }) => t.id === created.body.id)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Deactivation has to bite on the WRITE path too
//
// ★ The trap these guard against: `isActive: false` removed a row from the
// pickers, and nothing else. A retired domain, level or type stayed fully
// usable by anyone who passed its id — so "deactivated" was a UI suggestion,
// not a rule. Asserting only that the picker no longer offers it is a test that
// reads like coverage and checks nothing.
// ═══════════════════════════════════════════════════════════════════════════

describe("a deactivated row cannot be written against", () => {
  /** Refuse new … */
  it("refuses a new observation filed under a retired type", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/observation-types`),
      adminA,
    ).send({ name: "Түр", code: "temporary" });

    await authed(request(server()).delete(`/v1/observation-types/${created.body.id}`), adminA);

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/observations`),
      await as(a.teacherUser.username),
    ).send({ typeId: created.body.id, observedOn: "2026-02-10", situation: "Тэмдэглэл" });

    expect(res.status).toBe(400);
  });

  /** … and permit existing. */
  it("an observation already filed under a retired type still reads", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/observation-types`),
      adminA,
    ).send({ name: "Аялал", code: "excursion" });

    const teacher = await as(a.teacherUser.username);
    const observation = await authed(
      request(server()).post(`/v1/children/${a.child.id}/observations`),
      teacher,
    ).send({ typeId: created.body.id, observedOn: "2026-02-10", situation: "Тэмдэглэл" });
    expect(observation.status).toBe(201);

    await authed(request(server()).delete(`/v1/observation-types/${created.body.id}`), adminA);

    const res = await authed(
      // The detail route is nested under the child — there is no
      // `GET /observations/:id`.
      request(server()).get(`/v1/children/${a.child.id}/observations/${observation.body.id}`),
      teacher,
    );
    expect(res.status).toBe(200);
  });

  it("refuses an assessment against a retired domain", async () => {
    const domain = await ownDomain();
    const level = await db.assessmentLevel.findFirstOrThrow({ where: { kindergartenId: null } });
    const term = await db.term.create({
      data: {
        kindergartenId: a.kindergarten.id,
        schoolYearId: a.schoolYear.id,
        number: 1,
        name: "I улирал",
        startsOn: new Date("2025-09-01"),
        endsOn: new Date("2025-12-31"),
      },
    });

    await authed(request(server()).delete(`/v1/development-domains/${domain.id}`), adminA);

    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/assessments`),
      await as(a.teacherUser.username),
    ).send({ termId: term.id, domainId: domain.id, levelId: level.id });

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The lists are bounded by construction
// ═══════════════════════════════════════════════════════════════════════════

describe("row cap", () => {
  /**
   * ★ These three lists are not paginated, on purpose — the assessment grid
   * needs every active domain at once. CLAUDE.md §3.4 is satisfied by capping
   * what can be created rather than by paging what exists, so the bound is
   * enforced instead of assumed.
   */
  it("refuses to create past the per-kindergarten cap", async () => {
    await db.developmentDomain.createMany({
      data: Array.from({ length: 40 }, (_, i) => ({
        kindergartenId: a.kindergarten.id,
        name: `Чиглэл ${i}`,
        code: `bulk_${i}`,
      })),
    });

    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/development-domains`),
      adminA,
    ).send({ name: "Нэг илүү", code: "one_too_many" });

    expect(res.status).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Audit
// ═══════════════════════════════════════════════════════════════════════════

describe("audit", () => {
  it("records who changed the configuration", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/development-domains`),
      adminA,
    ).send({ name: "Аудит", code: "audit_test" });

    const entry = await db.auditLog.findFirstOrThrow({
      where: { objectType: "DevelopmentDomain", objectId: created.body.id, action: "CREATE" },
    });

    expect(entry.actorUserId).toBe(a.adminUser.id);
    expect(entry.kindergartenId).toBe(a.kindergarten.id);
  });
});
