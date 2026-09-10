import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createChild,
  createGroup,
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
 * Observations — the module where a mistake publishes a teacher's private note
 * to a family, or lets a family write one in a teacher's name.
 *
 * The rules under test were read out of the reference implementation rather
 * than assumed, and several are counter-intuitive:
 *
 *  - a teacher's observation is APPROVED on save; a parent's is PENDING
 *  - a teacher's note is private by default; a parent's own note is not
 *  - a guardian sees `visible AND approved`, OR their own submission
 *  - a guardian may edit their own submission; reviewed text returns to queue
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let parentB: AuthSession;
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
  parentB = await login(app, b.parentUser.username);

  const daily = await db.observationType.findFirstOrThrow({ where: { code: "daily" } });
  typeId = daily.id;
});

const server = () => app.getHttpServer();

/** Files a teacher observation and returns its id. */
async function teacherObservation(overrides: Record<string, unknown> = {}) {
  const res = await authed(
    request(server()).post(`/v1/children/${a.child.id}/observations`),
    teacherA,
  ).send({
    typeId,
    observedOn: "2026-02-10",
    situation: "Барилгын буланд",
    childDid: "Цамхаг барив",
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`);
  return res.body.id as string;
}

/** Files a parent observation and returns its id. */
async function parentObservation(session = parentA, childId = a.child.id) {
  const res = await authed(
    request(server()).post(`/v1/children/${childId}/parent-observations`),
    session,
  ).send({ observedOn: "2026-02-11", situation: "Гэртээ", childDid: "Ном уншив" });
  if (res.status !== 201) throw new Error(`parent create failed: ${res.status} ${res.text}`);
  return res.body.id as string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Defaults — getting these backwards publishes every private note
// ═══════════════════════════════════════════════════════════════════════════

describe("creation defaults", () => {
  it("a teacher's observation is PRIVATE and APPROVED on save", async () => {
    const id = await teacherObservation();
    const row = await db.observation.findUniqueOrThrow({ where: { id } });

    expect(row.visibleToParents).toBe(false);
    // There is nobody above a teacher to approve their own note; leaving it in
    // any other state would make it invisible to the family for ever, because
    // the parent read filter requires APPROVED.
    expect(row.reviewStatus).toBe("APPROVED");
    expect(row.source).toBe("TEACHER");
    expect(row.authorId).toBe(a.teacherUser.id);
  });

  it("a parent's submission is VISIBLE to them and PENDING", async () => {
    const id = await parentObservation();
    const row = await db.observation.findUniqueOrThrow({ where: { id } });

    expect(row.visibleToParents).toBe(true);
    expect(row.reviewStatus).toBe("PENDING");
    expect(row.source).toBe("PARENT");
    expect(row.authorId).toBe(a.parentUser.id);
    // The teacher decides whether a family's note belongs in the report.
    expect(row.includeInReport).toBe(false);
  });

  it("a teacher may publish on creation", async () => {
    const id = await teacherObservation({ visibleToParents: true });
    const row = await db.observation.findUniqueOrThrow({ where: { id } });
    expect(row.visibleToParents).toBe(true);
  });

  it("pins the observation to the child's active enrollment", async () => {
    const id = await teacherObservation();
    const row = await db.observation.findUniqueOrThrow({ where: { id } });
    expect(row.enrollmentId).toBe(a.enrollment.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Parent visibility — the core security property
// ═══════════════════════════════════════════════════════════════════════════

describe("parent visibility", () => {
  it("a guardian does NOT see a private teacher observation", async () => {
    await teacherObservation({ situation: "Хувийн тэмдэглэл" });

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/observations`)
      .set("Cookie", parentA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it("a guardian DOES see a published teacher observation", async () => {
    await teacherObservation({ visibleToParents: true, situation: "Хуваалцсан" });

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/observations`)
      .set("Cookie", parentA.cookies);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].situation).toBe("Хуваалцсан");
  });

  it("the DETAIL route hides a private observation too", async () => {
    // A list that filters and a detail that does not is the classic version of
    // this bug — the id is right there in the response of some other endpoint.
    const id = await teacherObservation();

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/observations/${id}`)
      .set("Cookie", parentA.cookies);

    expect(res.status).toBe(404);
  });

  it("a guardian sees their OWN submission while it is still pending", async () => {
    // Without this a parent could not tell whether their note saved.
    await parentObservation();

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/observations`)
      .set("Cookie", parentA.cookies);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].reviewStatus).toBe("PENDING");
  });

  it("a guardian does NOT see another guardian's pending submission", async () => {
    const father = await createUser({ username: uniq("father") });
    await createMembership(father.id, a.kindergarten.id, "PARENT");
    await linkGuardian(a.kindergarten.id, a.child.id, father.id);
    const fatherSession = await login(app, father.username);

    await parentObservation(fatherSession);

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/observations`)
      .set("Cookie", parentA.cookies);

    // Same child, both are guardians — but a pending note is the author's until
    // a teacher approves it.
    expect(res.body.items).toHaveLength(0);
  });

  it("a teacher sees everything about their own children", async () => {
    await teacherObservation();
    await parentObservation();

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/observations`)
      .set("Cookie", teacherA.cookies);

    expect(res.body.items).toHaveLength(2);
  });

  it("a published-but-unapproved note stays hidden", async () => {
    // Both conditions are required. Visible alone is not enough.
    const id = await parentObservation();
    await db.observation.update({ where: { id }, data: { authorId: null } });

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/observations`)
      .set("Cookie", parentA.cookies);

    expect(res.body.items).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Who may file what
// ═══════════════════════════════════════════════════════════════════════════

describe("filing rules", () => {
  it("a guardian CANNOT file a teacher observation", async () => {
    // Would put words in a teacher's mouth in the PDF the family receives.
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/observations`),
      parentA,
    ).send({ typeId, observedOn: "2026-02-10", situation: "Эцэг эхийн бичсэн" });

    expect(res.status).toBe(404);
  });

  it("a guardian CAN file a parent observation", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/parent-observations`),
      parentA,
    ).send({ observedOn: "2026-02-11", situation: "Гэртээ" });

    expect(res.status).toBe(201);
  });

  it("stores the parent screen's selected category as the observation type", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/parent-observations`),
      parentA,
    ).send({ observedOn: "2026-02-11", situation: "Ярилцсан", categoryCode: "conversation" });

    expect(res.status).toBe(201);
    const row = await db.observation.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { type: true },
    });
    expect(row.type.code).toBe("conversation");
  });

  it("a TEACHER cannot use the parent route", async () => {
    // Would misattribute the note in the family's report.
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/parent-observations`),
      teacherA,
    ).send({ observedOn: "2026-02-11", situation: "Багшийн бичсэн" });

    expect(res.status).toBe(404);
  });

  it("the parent form does not accept teacher-only fields", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/parent-observations`),
      parentA,
    ).send({ observedOn: "2026-02-11", situation: "Гэртээ", visibleToParents: false });

    expect(res.status).toBe(400);
  });

  it("rejects an observation dated in the future", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/observations`),
      teacherA,
    ).send({ typeId, observedOn: "2099-01-01", situation: "Ирээдүй" });

    expect(res.status).toBe(400);
  });

  it("rejects a type from another kindergarten", async () => {
    const foreign = await db.observationType.create({
      data: { kindergartenId: b.kindergarten.id, name: "Гадны", code: uniq("code") },
    });

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/observations`),
      teacherA,
    ).send({ typeId: foreign.id, observedOn: "2026-02-10", situation: "x" });

    expect(res.status).toBe(400);
  });

  it("rejects a development domain from another kindergarten", async () => {
    const foreign = await db.developmentDomain.create({
      data: { kindergartenId: b.kindergarten.id, name: "Гадны", code: uniq("code") },
    });

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/observations`),
      teacherA,
    ).send({ typeId, observedOn: "2026-02-10", situation: "x", domainIds: [foreign.id] });

    expect(res.status).toBe(400);
  });

  it("links system development domains", async () => {
    const domain = await db.developmentDomain.findFirstOrThrow({
      where: { kindergartenId: null, code: "physical" },
    });

    const id = await teacherObservation({ domainIds: [domain.id] });
    const links = await db.observationDomain.findMany({ where: { observationId: id } });
    expect(links).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Editing
// ═══════════════════════════════════════════════════════════════════════════

describe("editing", () => {
  it("a guardian edits their own PENDING submission", async () => {
    const id = await parentObservation();

    const res = await authed(request(server()).patch(`/v1/observations/${id}`), parentA).send({
      situation: "Засварласан",
    });

    expect(res.status).toBe(200);
    expect(res.body.situation).toBe("Засварласан");
  });

  it("a guardian edit after approval returns the note to review", async () => {
    const id = await parentObservation();
    await authed(request(server()).post(`/v1/observations/${id}/review`), teacherA).send({
      decision: "APPROVED",
    });

    const res = await authed(request(server()).patch(`/v1/observations/${id}`), parentA).send({
      situation: "Дараа нь засах оролдлого",
    });

    expect(res.status).toBe(200);
    expect(res.body.reviewStatus).toBe("PENDING");
  });

  it("a guardian CANNOT edit another guardian's submission", async () => {
    const father = await createUser({ username: uniq("father") });
    await createMembership(father.id, a.kindergarten.id, "PARENT");
    await linkGuardian(a.kindergarten.id, a.child.id, father.id);
    const fatherSession = await login(app, father.username);

    const id = await parentObservation(fatherSession);

    const res = await authed(request(server()).patch(`/v1/observations/${id}`), parentA).send({
      situation: "Өөрийн биш",
    });
    expect(res.status).toBe(404);
  });

  it("a guardian CANNOT edit a teacher's observation", async () => {
    const id = await teacherObservation({ visibleToParents: true });

    const res = await authed(request(server()).patch(`/v1/observations/${id}`), parentA).send({
      situation: "Багшийнхыг засах",
    });
    expect(res.status).toBe(404);
  });

  it("★ a guardian's edit CANNOT change visibility, report inclusion or domains", async () => {
    // RFP §5.4 gives the teacher these three decisions. A guardian posting them
    // directly must have them ignored, not obeyed.
    const domain = await db.developmentDomain.findFirstOrThrow({
      where: { kindergartenId: null, code: "physical" },
    });
    const id = await parentObservation();

    const res = await authed(request(server()).patch(`/v1/observations/${id}`), parentA).send({
      situation: "Засварласан",
      includeInReport: true,
      visibleToParents: false,
      domainIds: [domain.id],
    });

    expect(res.status).toBe(200);

    const row = await db.observation.findUniqueOrThrow({ where: { id } });
    expect(row.includeInReport).toBe(false);
    expect(row.visibleToParents).toBe(true);
    expect(await db.observationDomain.count({ where: { observationId: id } })).toBe(0);
    // The legitimate part of the edit still applied.
    expect(row.situation).toBe("Засварласан");
  });

  it("a teacher may change all three", async () => {
    const id = await teacherObservation();

    const res = await authed(request(server()).patch(`/v1/observations/${id}`), teacherA).send({
      visibleToParents: true,
      includeInReport: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.visibleToParents).toBe(true);
    expect(res.body.includeInReport).toBe(false);
  });

  it("an edited RETURNED submission goes back to the queue", async () => {
    // The teacher approved the text they read, not the text it became.
    const id = await parentObservation();
    await authed(request(server()).post(`/v1/observations/${id}/review`), teacherA).send({
      decision: "RETURNED",
      reviewNote: "Дэлгэрэнгүй бичнэ үү",
    });

    await authed(request(server()).patch(`/v1/observations/${id}`), parentA).send({
      situation: "Дэлгэрэнгүй",
    });

    const row = await db.observation.findUniqueOrThrow({ where: { id } });
    expect(row.reviewStatus).toBe("PENDING");
  });

  it("replaces domains rather than appending", async () => {
    const domains = await db.developmentDomain.findMany({ where: { kindergartenId: null } });
    const id = await teacherObservation({ domainIds: [domains[0]!.id, domains[1]!.id] });

    await authed(request(server()).patch(`/v1/observations/${id}`), teacherA).send({
      domainIds: [domains[2]!.id],
    });

    const links = await db.observationDomain.findMany({ where: { observationId: id } });
    expect(links).toHaveLength(1);
    expect(links[0]!.domainId).toBe(domains[2]!.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Review queue
// ═══════════════════════════════════════════════════════════════════════════

describe("review queue", () => {
  it("lists pending parent submissions from the teacher's own groups", async () => {
    await parentObservation();

    const res = await request(server())
      .get("/v1/observations/review-queue")
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].child.id).toBe(a.child.id);
  });

  it("does NOT include another teacher's groups", async () => {
    await parentObservation(parentB, b.child.id);

    const res = await request(server())
      .get("/v1/observations/review-queue")
      .set("Cookie", teacherA.cookies);

    expect(res.body.items).toHaveLength(0);
  });

  it("drops out of the queue once reviewed", async () => {
    const id = await parentObservation();
    await authed(request(server()).post(`/v1/observations/${id}/review`), teacherA).send({
      decision: "APPROVED",
    });

    const res = await request(server())
      .get("/v1/observations/review-queue")
      .set("Cookie", teacherA.cookies);
    expect(res.body.items).toHaveLength(0);
  });

  it("is closed to guardians", async () => {
    expect(
      (await request(server()).get("/v1/observations/review-queue").set("Cookie", parentA.cookies))
        .status,
    ).toBe(404);
  });

  it("a revoked teacher's queue is empty", async () => {
    await parentObservation();
    await authed(request(server()).delete(`/v1/group-teachers/${a.assignment.id}`), adminA);

    const res = await request(server())
      .get("/v1/observations/review-queue")
      .set("Cookie", teacherA.cookies);
    expect(res.body.items).toHaveLength(0);
  });
});

describe("review", () => {
  it("approving records the reviewer and may publish in one step", async () => {
    const id = await parentObservation();

    const res = await authed(
      request(server()).post(`/v1/observations/${id}/review`),
      teacherA,
    ).send({ decision: "APPROVED", visibleToParents: true });

    expect(res.status).toBe(201);
    const row = await db.observation.findUniqueOrThrow({ where: { id } });
    expect(row.reviewStatus).toBe("APPROVED");
    expect(row.reviewedById).toBe(a.teacherUser.id);
    expect(row.reviewedAt).not.toBeNull();
  });

  it("returning carries a note back to the parent", async () => {
    const id = await parentObservation();

    await authed(request(server()).post(`/v1/observations/${id}/review`), teacherA).send({
      decision: "RETURNED",
      reviewNote: "Огноог шалгана уу",
    });

    const row = await db.observation.findUniqueOrThrow({ where: { id } });
    expect(row.reviewStatus).toBe("RETURNED");
    expect(row.reviewNote).toBe("Огноог шалгана уу");
  });

  it("a guardian cannot review", async () => {
    const id = await parentObservation();
    const res = await authed(request(server()).post(`/v1/observations/${id}/review`), parentA).send(
      {
        decision: "APPROVED",
      },
    );
    expect(res.status).toBe(404);
  });

  it("refuses to review a teacher's own observation", async () => {
    const id = await teacherObservation();
    const res = await authed(
      request(server()).post(`/v1/observations/${id}/review`),
      teacherA,
    ).send({ decision: "APPROVED" });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-child and cross-kindergarten
// ═══════════════════════════════════════════════════════════════════════════

describe("isolation", () => {
  it("a guardian of another child gets 404 on the list", async () => {
    expect(
      (
        await request(server())
          .get(`/v1/children/${b.child.id}/observations`)
          .set("Cookie", parentA.cookies)
      ).status,
    ).toBe(404);
  });

  it("a teacher from another group gets 404", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");
    const child = await createChild(a.kindergarten.id, { firstName: "Хол" });
    await enrollChild(a.kindergarten.id, child.id, other.id, a.schoolYear.id);

    expect(
      (
        await request(server())
          .get(`/v1/children/${child.id}/observations`)
          .set("Cookie", teacherA.cookies)
      ).status,
    ).toBe(404);
  });

  it("cross-kindergarten filing gets 404", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${b.child.id}/observations`),
      teacherA,
    ).send({ typeId, observedOn: "2026-02-10", situation: "Халдлага" });
    expect(res.status).toBe(404);
  });

  it("editing another kindergarten's observation gets 404", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    const foreign = await authed(
      request(server()).post(`/v1/children/${b.child.id}/observations`),
      teacherB,
    ).send({ typeId, observedOn: "2026-02-10", situation: "B-ийн" });

    const res = await authed(
      request(server()).patch(`/v1/observations/${foreign.body.id}`),
      teacherA,
    ).send({ situation: "Хулгай" });
    expect(res.status).toBe(404);
  });

  it("a revoked teacher loses access to observations", async () => {
    await teacherObservation();
    await authed(request(server()).delete(`/v1/group-teachers/${a.assignment.id}`), adminA);

    expect(
      (
        await request(server())
          .get(`/v1/children/${a.child.id}/observations`)
          .set("Cookie", teacherA.cookies)
      ).status,
    ).toBe(404);
  });

  it("a revoked guardian loses access", async () => {
    await teacherObservation({ visibleToParents: true });
    await authed(request(server()).patch(`/v1/guardianships/${a.guardianship.id}`), adminA).send({
      canView: false,
    });

    expect(
      (
        await request(server())
          .get(`/v1/children/${a.child.id}/observations`)
          .set("Cookie", parentA.cookies)
      ).status,
    ).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Filters, archive, audit
// ═══════════════════════════════════════════════════════════════════════════

describe("filters and lifecycle", () => {
  it("filters by source and by date range", async () => {
    await teacherObservation({ observedOn: "2026-01-05" });
    await teacherObservation({ observedOn: "2026-03-05" });
    await parentObservation();

    const bySource = await request(server())
      .get(`/v1/children/${a.child.id}/observations?source=PARENT`)
      .set("Cookie", teacherA.cookies);
    expect(bySource.body.items).toHaveLength(1);

    const byDate = await request(server())
      .get(`/v1/children/${a.child.id}/observations?from=2026-02-01&to=2026-12-31`)
      .set("Cookie", teacherA.cookies);
    expect(byDate.body.items).toHaveLength(2);
  });

  it("archiving hides it from everyone", async () => {
    const id = await teacherObservation({ visibleToParents: true });
    await authed(request(server()).delete(`/v1/observations/${id}`), teacherA);

    const teacherList = await request(server())
      .get(`/v1/children/${a.child.id}/observations`)
      .set("Cookie", teacherA.cookies);
    expect(teacherList.body.items).toHaveLength(0);

    const row = await db.observation.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).not.toBeNull();
  });

  it("a guardian can archive their own pending submission", async () => {
    const id = await parentObservation();
    expect((await authed(request(server()).delete(`/v1/observations/${id}`), parentA)).status).toBe(
      200,
    );
    expect((await db.observation.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
  });

  it("a guardian cannot archive a teacher observation", async () => {
    const id = await teacherObservation({ visibleToParents: true });
    expect((await authed(request(server()).delete(`/v1/observations/${id}`), parentA)).status).toBe(
      404,
    );
  });

  it("writes an audit entry naming the child", async () => {
    await teacherObservation();
    const entry = await db.auditLog.findFirst({
      where: { objectType: "Observation", action: "CREATE" },
    });
    expect(entry?.childId).toBe(a.child.id);
    expect(entry?.actorUserId).toBe(a.teacherUser.id);
  });

  it("requires CSRF on writes", async () => {
    const res = await request(server())
      .post(`/v1/children/${a.child.id}/observations`)
      .set("Cookie", teacherA.cookies)
      .send({ typeId, observedOn: "2026-02-10", situation: "CSRF-гүй" });
    expect(res.status).toBe(403);
  });

  /**
   * ★ The catalogue's contents, not its size.
   *
   * This asserted `length >= 5` — the number of system types that happened to
   * exist when it was written. On 2026-09-06 the client named the three kinds
   * the product should offer (Ажиглалт, Ярилцлага, Бүтээл) and the seed shrank
   * to those plus the family's own, so a count-based assertion failed for a
   * change that was entirely deliberate.
   *
   * A count was never what this test was about. What matters is that the
   * endpoint answers with the kindergarten's own catalogue, so it checks the
   * codes are there — which fails if a type is dropped by accident and passes
   * when one is added on purpose.
   */
  it("lists observation types for the kindergarten", async () => {
    const res = await request(server())
      .get(`/v1/children/${a.child.id}/observations/types`)
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);

    const codes = (res.body as { code: string | null }[]).map((type) => type.code);
    expect(codes).toEqual(expect.arrayContaining(["daily", "conversation", "artwork", "parent"]));
  });
});

/**
 * The group coverage dashboard — `GET /groups/:id/observation-stats`.
 *
 * ★ Authorised per group, not per child, so it needs its own §4.1 cases.
 *
 * The three that matter are the three a group-scoped endpoint can get wrong:
 * another kindergarten's group, a group in *this* kindergarten that this
 * teacher is not assigned to, and a guardian who has no business here at all.
 * All three must be 404 — a 403 would confirm the group exists.
 */
describe("group observation stats", () => {
  const RANGE = "from=2026-01-01&to=2026-12-31";

  it("counts a group's notes by type, and keeps a zero row", async () => {
    await teacherObservation();

    const res = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/observation-stats?${RANGE}`),
      teacherA,
    );

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);

    const daily = res.body.byType.find((row: { id: string }) => row.id === typeId);
    expect(daily.count).toBe(1);

    /*
      Every configured type appears even at zero — "Ярилцлага 0" is the finding,
      and a missing row reads as a type nobody set up.
    */
    expect(res.body.byType.length).toBeGreaterThan(1);
    expect(res.body.byType.some((row: { count: number }) => row.count === 0)).toBe(true);
  });

  it("counts distinct children, not notes", async () => {
    await teacherObservation();
    await teacherObservation({ observedOn: "2026-03-11" });

    const res = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/observation-stats?${RANGE}`),
      teacherA,
    );

    // Two notes about the same child is one child covered.
    expect(res.body.total).toBe(2);
    expect(res.body.childrenWithNotes).toBe(1);
    expect(res.body.enrolled).toBe(1);
    expect(res.body.byChild).toEqual([{ childId: a.child.id, count: 2 }]);
    expect(res.body.byChildType).toEqual([{ childId: a.child.id, typeId, count: 2 }]);
  });

  it("buckets notes by calendar month", async () => {
    await teacherObservation();
    await teacherObservation({ observedOn: "2026-03-11" });

    const res = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/observation-stats?${RANGE}`),
      teacherA,
    );

    expect(res.body.byMonth).toEqual([
      { month: "2026-02", count: 1, childrenCount: 1 },
      { month: "2026-03", count: 1, childrenCount: 1 },
    ]);
  });

  it("excludes notes outside the window", async () => {
    await teacherObservation();

    const res = await authed(
      request(server()).get(
        `/v1/groups/${a.group.id}/observation-stats?from=2026-06-01&to=2026-12-31`,
      ),
      teacherA,
    );

    expect(res.body.total).toBe(0);
  });

  it("a teacher from another kindergarten gets 404", async () => {
    const res = await authed(
      request(server()).get(`/v1/groups/${b.group.id}/observation-stats?${RANGE}`),
      teacherA,
    );

    expect(res.status).toBe(404);
  });

  /*
   * Membership is not enough. A second group in the *same* kindergarten that
   * this teacher is not assigned to is the case a tenant filter alone lets
   * through, which is why the service repeats the assignment check.
   */
  it("a teacher not assigned to the group gets 404", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Хараагүй бүлэг");

    const res = await authed(
      request(server()).get(`/v1/groups/${other.id}/observation-stats?${RANGE}`),
      teacherA,
    );

    expect(res.status).toBe(404);
  });

  it("an admin sees a group they do not teach", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");

    const res = await authed(
      request(server()).get(`/v1/groups/${other.id}/observation-stats?${RANGE}`),
      adminA,
    );

    expect(res.status).toBe(200);
  });

  it("a guardian gets 404", async () => {
    const res = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/observation-stats?${RANGE}`),
      parentA,
    );

    expect(res.status).toBe(404);
  });

  it("refuses a window wider than a school year", async () => {
    const res = await authed(
      request(server()).get(
        `/v1/groups/${a.group.id}/observation-stats?from=2020-01-01&to=2026-12-31`,
      ),
      teacherA,
    );

    expect(res.status).toBe(400);
  });
});
