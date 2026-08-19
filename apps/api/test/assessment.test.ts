import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  authed,
  createChild,
  createGroup,
  createScenario,
  enrollChild,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { AssessmentRepository } from "../src/assessment/assessment.repository";
import type { PrismaService } from "../src/prisma/prisma.service";

/**
 * Assessment — one development domain at a time.
 *
 * The scope rule under test throughout: `GET /groups/:id/assessments` requires
 * **both** a term and a single domain. There is no children × domains matrix,
 * and `domainId` being required is what stops the endpoint drifting into one.
 *
 * Visibility rules, verified against the reference and different from
 * observations:
 *  - an assessment is visible to a guardian when `visibleToParents` is set;
 *    there is no approval workflow
 *  - a term report is visible only when FINAL
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let termId: string;
let domainId: string;
let otherDomainId: string;
let levelIds: string[];

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
  termId = term.id;

  const domains = await db.developmentDomain.findMany({
    where: { kindergartenId: null },
    orderBy: { order: "asc" },
  });
  domainId = domains[0]!.id;
  otherDomainId = domains[1]!.id;

  levelIds = (
    await db.assessmentLevel.findMany({
      where: { kindergartenId: null },
      orderBy: { value: "asc" },
    })
  ).map((l) => l.id);
});

const server = () => app.getHttpServer();

// ═══════════════════════════════════════════════════════════════════════════
// One domain at a time — the scope rule
// ═══════════════════════════════════════════════════════════════════════════

describe("★ one domain at a time", () => {
  it("returns ONE column: every child, one domain", async () => {
    const res = await request(server())
      .get(`/v1/groups/${a.group.id}/assessments?termId=${termId}&domainId=${domainId}`)
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.domain.id).toBe(domainId);
    expect(res.body.children).toHaveLength(1);
    // No second dimension: the response describes a single domain, not a grid.
    expect(res.body).not.toHaveProperty("domains");
    expect(res.body.children[0]).not.toHaveProperty("assessments");
  });

  it("REQUIRES domainId — omitting it is a 400, not a matrix", async () => {
    const res = await request(server())
      .get(`/v1/groups/${a.group.id}/assessments?termId=${termId}`)
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(400);
  });

  it("REQUIRES termId", async () => {
    const res = await request(server())
      .get(`/v1/groups/${a.group.id}/assessments?domainId=${domainId}`)
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(400);
  });

  it("rejects an attempt to pass several domains", async () => {
    const res = await request(server())
      .get(
        `/v1/groups/${a.group.id}/assessments?termId=${termId}&domainId=${domainId}&domainIds=${otherDomainId}`,
      )
      .set("Cookie", teacherA.cookies);

    // `.strict()` on the query schema: an unknown parameter is a 400 rather
    // than being silently ignored.
    expect(res.status).toBe(400);
  });

  it("includes the levels to choose from, so the screen needs one request", async () => {
    const res = await request(server())
      .get(`/v1/groups/${a.group.id}/assessments?termId=${termId}&domainId=${domainId}`)
      .set("Cookie", teacherA.cookies);

    expect(res.body.levels).toHaveLength(4);
  });

  it("★ costs a constant number of queries regardless of group size", async () => {
    // RFP §17, and the reference pins the same property with assertNumQueries.
    // This is the screen a teacher opens most often; a query per child is what
    // makes it slow enough to stop being used.
    //
    // Measured for real by counting operations through an instrumented client
    // rather than asserting on the response shape, which would prove nothing.
    async function countQueriesFor(groupSize: number): Promise<number> {
      await resetData();
      const s = await createScenario(`q${groupSize}`);
      const term = await db.term.create({
        data: {
          kindergartenId: s.kindergarten.id,
          schoolYearId: s.schoolYear.id,
          number: 1,
          name: "I улирал",
          startsOn: new Date("2025-09-01"),
          endsOn: new Date("2025-12-31"),
        },
      });
      const domain = await db.developmentDomain.findFirstOrThrow({
        where: { kindergartenId: null },
      });

      // The scenario ships one child; add the rest.
      for (let i = 1; i < groupSize; i++) {
        const child = await createChild(s.kindergarten.id, { firstName: `Хүүхэд${i}` });
        await enrollChild(s.kindergarten.id, child.id, s.group.id, s.schoolYear.id);
      }

      let queries = 0;
      const counted = db.$extends({
        query: {
          $allOperations({ args, query }) {
            queries += 1;
            return query(args);
          },
        },
      });

      const repo = new AssessmentRepository(counted as unknown as PrismaService);
      await repo.loadGroupColumn(s.group.id, s.schoolYear.id, term.id, domain.id);
      return queries;
    }

    const small = await countQueriesFor(2);
    const large = await countQueriesFor(20);

    // Two reads — the roster and their assessments — whatever the group size.
    expect(small).toBe(2);
    expect(large).toBe(small);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Saving
// ═══════════════════════════════════════════════════════════════════════════

describe("saving a column", () => {
  it("saves levels for the whole group in one call", async () => {
    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/assessments`),
      teacherA,
    ).send({
      termId,
      domainId,
      entries: [{ childId: a.child.id, levelId: levelIds[2], comment: "Сайн ахиц" }],
    });

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(1);

    const row = await db.assessment.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.levelId).toBe(levelIds[2]);
    expect(row.comment).toBe("Сайн ахиц");
  });

  it("★ a new assessment is NOT visible to parents", async () => {
    // Publishing is a separate, deliberate act. If this default ever flips,
    // every in-progress assessment reaches families immediately.
    await authed(request(server()).put(`/v1/groups/${a.group.id}/assessments`), teacherA).send({
      termId,
      domainId,
      entries: [{ childId: a.child.id, levelId: levelIds[1] }],
    });

    const row = await db.assessment.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.visibleToParents).toBe(false);
  });

  it("updates rather than duplicating on a second save", async () => {
    for (const levelId of [levelIds[0], levelIds[3]]) {
      await authed(request(server()).put(`/v1/groups/${a.group.id}/assessments`), teacherA).send({
        termId,
        domainId,
        entries: [{ childId: a.child.id, levelId }],
      });
    }

    const rows = await db.assessment.findMany({ where: { childId: a.child.id, termId, domainId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.levelId).toBe(levelIds[3]);
  });

  it("keeps domains independent", async () => {
    await authed(request(server()).put(`/v1/groups/${a.group.id}/assessments`), teacherA).send({
      termId,
      domainId,
      entries: [{ childId: a.child.id, levelId: levelIds[0] }],
    });
    await authed(request(server()).put(`/v1/groups/${a.group.id}/assessments`), teacherA).send({
      termId,
      domainId: otherDomainId,
      entries: [{ childId: a.child.id, levelId: levelIds[3] }],
    });

    expect(await db.assessment.count({ where: { childId: a.child.id, termId } })).toBe(2);
  });

  it("★ REFUSES a child who is not enrolled in this group", async () => {
    // Without this a valid child id from elsewhere would have an assessment
    // written against a group they do not attend.
    const outsider = await createChild(a.kindergarten.id, { firstName: "Гадны" });
    const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");
    await enrollChild(a.kindergarten.id, outsider.id, otherGroup.id, a.schoolYear.id);

    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/assessments`),
      teacherA,
    ).send({ termId, domainId, entries: [{ childId: outsider.id, levelId: levelIds[0] }] });

    expect(res.status).toBe(400);
    expect(await db.assessment.count({ where: { childId: outsider.id } })).toBe(0);
  });

  it("rejects a level from another kindergarten", async () => {
    const foreign = await db.assessmentLevel.create({
      data: { kindergartenId: b.kindergarten.id, value: 9, label: "Гадны" },
    });

    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/assessments`),
      teacherA,
    ).send({ termId, domainId, entries: [{ childId: a.child.id, levelId: foreign.id }] });

    expect(res.status).toBe(400);
  });

  it("rejects a term from another kindergarten", async () => {
    const foreignTerm = await db.term.create({
      data: {
        kindergartenId: b.kindergarten.id,
        schoolYearId: b.schoolYear.id,
        number: 1,
        name: "I улирал",
        startsOn: new Date("2025-09-01"),
        endsOn: new Date("2025-12-31"),
      },
    });

    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/assessments`),
      teacherA,
    ).send({
      termId: foreignTerm.id,
      domainId,
      entries: [{ childId: a.child.id, levelId: levelIds[0] }],
    });

    expect(res.status).toBe(400);
  });

  it("saves a single child directly", async () => {
    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/assessments`),
      teacherA,
    ).send({ termId, domainId, levelId: levelIds[2], comment: "Тайлбар" });

    expect(res.status).toBe(200);
    expect(res.body.level.id).toBe(levelIds[2]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Visibility
// ═══════════════════════════════════════════════════════════════════════════

describe("assessment visibility", () => {
  async function assess(visible = false) {
    await authed(request(server()).put(`/v1/groups/${a.group.id}/assessments`), teacherA).send({
      termId,
      domainId,
      entries: [{ childId: a.child.id, levelId: levelIds[2] }],
    });
    if (visible) {
      await authed(
        request(server()).post(`/v1/children/${a.child.id}/assessments/publish`),
        teacherA,
      ).send({ termId, visible: true });
    }
  }

  it("a guardian does NOT see an unpublished assessment", async () => {
    await assess(false);

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/assessments`)
      .set("Cookie", parentA.cookies);

    expect(res.body).toHaveLength(0);
  });

  it("a guardian DOES see it once the term is published", async () => {
    await assess(true);

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/assessments`)
      .set("Cookie", parentA.cookies);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].level.value).toBe(3);
  });

  it("publishing can be reversed", async () => {
    await assess(true);
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/assessments/publish`),
      teacherA,
    ).send({ termId, visible: false });

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/assessments`)
      .set("Cookie", parentA.cookies);
    expect(res.body).toHaveLength(0);
  });

  it("a teacher sees unpublished assessments", async () => {
    await assess(false);

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/assessments`)
      .set("Cookie", teacherA.cookies);
    expect(res.body).toHaveLength(1);
  });

  it("a guardian cannot publish", async () => {
    await assess(false);

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/assessments/publish`),
      parentA,
    ).send({ termId, visible: true });

    expect(res.status).toBe(404);
  });

  it("a guardian cannot assess", async () => {
    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/assessments`),
      parentA,
    ).send({ termId, domainId, levelId: levelIds[3] });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Term reports
// ═══════════════════════════════════════════════════════════════════════════

describe("term reports", () => {
  async function writeReport() {
    return authed(request(server()).put(`/v1/children/${a.child.id}/term-report`), teacherA).send({
      termId,
      strengths: "Хамтран ажиллах чадвартай",
      nextGoals: "Тоо таних",
    });
  }

  it("saves as a DRAFT", async () => {
    const res = await writeReport();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DRAFT");
  });

  it("★ a guardian CANNOT read a draft", async () => {
    await writeReport();

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/term-report?termId=${termId}`)
      .set("Cookie", parentA.cookies);

    // Absent and not-yet-final are the same answer: telling them a draft exists
    // would be its own disclosure.
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
    expect(res.body.strengths).toBeNull();
  });

  it("a guardian CAN read it once finalised", async () => {
    await writeReport();
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/term-report/finalize`),
      teacherA,
    ).send({ termId });

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/term-report?termId=${termId}`)
      .set("Cookie", parentA.cookies);

    expect(res.body.status).toBe("FINAL");
    expect(res.body.strengths).toBe("Хамтран ажиллах чадвартай");
  });

  it("a teacher reads their own draft", async () => {
    await writeReport();

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/term-report?termId=${termId}`)
      .set("Cookie", teacherA.cookies);
    expect(res.body.status).toBe("DRAFT");
  });

  it("refuses to finalise a report that was never written", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/term-report/finalize`),
      teacherA,
    ).send({ termId });

    expect(res.status).toBe(400);
  });

  it("records finalisation time", async () => {
    await writeReport();
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/term-report/finalize`),
      teacherA,
    ).send({ termId });

    const row = await db.termReport.findFirstOrThrow({ where: { childId: a.child.id, termId } });
    expect(row.finalizedAt).not.toBeNull();
  });

  it("a guardian cannot reach the editor", async () => {
    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/term-report`),
      parentA,
    ).send({ termId, strengths: "Эцэг эхийн бичсэн" });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Terms, config and isolation
// ═══════════════════════════════════════════════════════════════════════════

describe("terms and config", () => {
  it("lists domains and levels for every role", async () => {
    for (const session of [teacherA, parentA, adminA]) {
      const res = await request(server())
        .get(`/v1/kindergartens/${a.kindergarten.id}/assessment-config`)
        .set("Cookie", session.cookies);

      expect(res.status).toBe(200);
      expect(res.body.domains).toHaveLength(5);
      expect(res.body.levels).toHaveLength(4);
    }
  });

  it("refuses config for another kindergarten", async () => {
    const res = await request(server())
      .get(`/v1/kindergartens/${b.kindergarten.id}/assessment-config`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(404);
  });

  it("an admin creates a term", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/terms`),
      adminA,
    ).send({
      schoolYearId: a.schoolYear.id,
      number: 2,
      name: "II улирал",
      startsOn: "2026-01-05",
      endsOn: "2026-03-31",
    });

    expect(res.status).toBe(201);
  });

  it("a teacher cannot create a term", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/terms`),
      teacherA,
    ).send({
      schoolYearId: a.schoolYear.id,
      number: 2,
      name: "II улирал",
      startsOn: "2026-01-05",
      endsOn: "2026-03-31",
    });

    expect(res.status).toBe(404);
  });

  it("rejects a term ending before it starts", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/terms`),
      adminA,
    ).send({
      schoolYearId: a.schoolYear.id,
      number: 3,
      name: "Буруу",
      startsOn: "2026-06-01",
      endsOn: "2026-01-01",
    });

    expect(res.status).toBe(400);
  });
});

describe("isolation", () => {
  it("a teacher cannot assess another group", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");

    const res = await request(server())
      .get(`/v1/groups/${other.id}/assessments?termId=${termId}&domainId=${domainId}`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(404);
  });

  it("a revoked teacher loses the assessment screen", async () => {
    await authed(request(server()).delete(`/v1/group-teachers/${a.assignment.id}`), adminA);

    const res = await request(server())
      .get(`/v1/groups/${a.group.id}/assessments?termId=${termId}&domainId=${domainId}`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(404);
  });

  it("cross-kindergarten group access gets 404", async () => {
    const res = await request(server())
      .get(`/v1/groups/${b.group.id}/assessments?termId=${termId}&domainId=${domainId}`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(404);
  });

  it("a parent cannot open the group screen at all", async () => {
    const res = await request(server())
      .get(`/v1/groups/${a.group.id}/assessments?termId=${termId}&domainId=${domainId}`)
      .set("Cookie", parentA.cookies);
    expect(res.status).toBe(404);
  });

  it("a guardian of another child gets 404 on assessments", async () => {
    const res = await request(server())
      .get(`/v1/children/${b.child.id}/assessments`)
      .set("Cookie", parentA.cookies);
    expect(res.status).toBe(404);
  });

  it("requires CSRF on writes", async () => {
    const res = await request(server())
      .put(`/v1/groups/${a.group.id}/assessments`)
      .set("Cookie", teacherA.cookies)
      .send({ termId, domainId, entries: [{ childId: a.child.id, levelId: levelIds[0] }] });

    expect(res.status).toBe(403);
  });

  it("writes an audit entry naming the term and domain", async () => {
    await authed(request(server()).put(`/v1/children/${a.child.id}/assessments`), teacherA).send({
      termId,
      domainId,
      levelId: levelIds[1],
    });

    const entry = await db.auditLog.findFirst({
      where: { objectType: "Assessment", childId: a.child.id },
    });
    expect((entry?.metadata as { domainId: string }).domainId).toBe(domainId);
  });
});
