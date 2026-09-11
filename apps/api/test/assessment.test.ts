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
  await app.get(RateLimitService).resetAll();

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
  /**
   * Files a note for a child directly, bypassing the API.
   *
   * ★ Straight to the database because what is under test here is the report's
   * citation of a note, not the note's own creation — which `observations.test.ts`
   * covers at length. Going through the endpoint would make every case in this
   * block depend on the observation controller's rules as well as its own.
   */
  async function noteFor(scenario: Scenario, day = "2025-10-05") {
    const type = await db.observationType.findFirstOrThrow({ where: { code: "daily" } });
    const row = await db.observation.create({
      data: {
        kindergartenId: scenario.kindergarten.id,
        childId: scenario.child.id,
        enrollmentId: scenario.enrollment.id,
        typeId: type.id,
        observedOn: new Date(day),
        source: "TEACHER",
        situation: `Тэмдэглэл ${day}`,
      },
    });
    return row.id;
  }

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

  /**
   * ★ FINAL has to mean final.
   *
   * Once a report is finalised a family is reading it. A later write would
   * change the text underneath them with no trace and no notification — the
   * teacher would believe they had corrected a draft, the parent would have
   * read something else. The upsert accepted that write.
   */
  it("refuses to rewrite a finalised report", async () => {
    await writeReport();
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/term-report/finalize`),
      teacherA,
    ).send({ termId });

    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/term-report`),
      teacherA,
    ).send({ termId, strengths: "Дараа нь өөрчилсөн" });

    expect(res.status).toBe(409);

    // And the published text is untouched, which is the property that matters.
    const row = await db.termReport.findFirstOrThrow({ where: { childId: a.child.id, termId } });
    expect(row.strengths).toBe("Хамтран ажиллах чадвартай");
  });

  /**
   * Finalising twice is a double-click, not an error — but it must not move
   * `finalizedAt`, which is when the family were told it was ready.
   */
  it("is idempotent when finalised twice", async () => {
    await writeReport();
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/term-report/finalize`),
      teacherA,
    ).send({ termId });

    const first = await db.termReport.findFirstOrThrow({ where: { childId: a.child.id, termId } });

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/term-report/finalize`),
      teacherA,
    ).send({ termId });
    expect(res.status).toBe(201);

    const second = await db.termReport.findFirstOrThrow({ where: { childId: a.child.id, termId } });
    expect(second.finalizedAt?.toISOString()).toBe(first.finalizedAt?.toISOString());
  });

  it("a guardian cannot reach the editor", async () => {
    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/term-report`),
      parentA,
    ).send({ termId, strengths: "Эцэг эхийн бичсэн" });

    expect(res.status).toBe(404);
  });

  // ── Cited observations ────────────────────────────────────────────────────
  //
  // ★ The client's 2026-09-11 ask: "өмнө нь бичсэн хэсгүүдээ чекэлж сонгож
  // байгаад тэдгээр дээрээ багцлан дүгнэлт гаргадаг." The report stores which
  // notes it was written from, rather than implying every note in the term.

  it("stores the notes a report was written from", async () => {
    const one = await noteFor(a, "2025-10-05");
    const two = await noteFor(a, "2025-11-02");

    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/term-report`),
      teacherA,
    ).send({ termId, strengths: "Багаараа тоглодог", observationIds: [one, two] });

    expect(res.status).toBe(200);

    const read = await authed(
      request(server()).get(`/v1/children/${a.child.id}/term-report?termId=${termId}`),
      teacherA,
    );
    expect(read.body.observations.map((row: { id: string }) => row.id)).toEqual([one, two]);
  });

  /*
    ★ 404, not 400 — §1.7.

    An observation id belonging to another child must not be distinguishable
    from one that never existed, or this endpoint becomes a way to test whether
    a note id is real.
  */
  it("★ refuses a note belonging to another child with 404", async () => {
    const mine = await noteFor(a);
    const theirs = await noteFor(b);

    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/term-report`),
      teacherA,
    ).send({ termId, observationIds: [mine, theirs] });

    expect(res.status).toBe(404);
  });

  it("★ answers the same 404 for a note id that does not exist", async () => {
    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/term-report`),
      teacherA,
    ).send({ termId, observationIds: ["00000000-0000-4000-8000-000000000000"] });

    expect(res.status).toBe(404);
  });

  /*
    ★ Nothing is written when one id is refused.

    The check runs before the upsert, so a report that did not exist still does
    not — a teacher whose selection was rejected must not find a blank report
    waiting for them.
  */
  it("writes no report at all when a cited note is refused", async () => {
    const theirs = await noteFor(b);

    await authed(request(server()).put(`/v1/children/${a.child.id}/term-report`), teacherA).send({
      termId,
      strengths: "Энэ хадгалагдах ёсгүй",
      observationIds: [theirs],
    });

    expect(await db.termReport.count({ where: { childId: a.child.id, termId } })).toBe(0);
  });

  it("replaces the selection rather than adding to it", async () => {
    const one = await noteFor(a, "2025-10-05");
    const two = await noteFor(a, "2025-11-02");

    await authed(request(server()).put(`/v1/children/${a.child.id}/term-report`), teacherA).send({
      termId,
      observationIds: [one, two],
    });
    await authed(request(server()).put(`/v1/children/${a.child.id}/term-report`), teacherA).send({
      termId,
      observationIds: [two],
    });

    const read = await authed(
      request(server()).get(`/v1/children/${a.child.id}/term-report?termId=${termId}`),
      teacherA,
    );
    expect(read.body.observations.map((row: { id: string }) => row.id)).toEqual([two]);
  });

  /*
    ★ Omitting the field is not the same as sending an empty one.

    A screen saving only the narrative must not drop the citations, and
    unticking the last box must still be expressible.
  */
  it("leaves the selection alone when the field is not sent", async () => {
    const one = await noteFor(a);

    await authed(request(server()).put(`/v1/children/${a.child.id}/term-report`), teacherA).send({
      termId,
      observationIds: [one],
    });
    await authed(request(server()).put(`/v1/children/${a.child.id}/term-report`), teacherA).send({
      termId,
      strengths: "Зөвхөн текст",
    });

    const read = await authed(
      request(server()).get(`/v1/children/${a.child.id}/term-report?termId=${termId}`),
      teacherA,
    );
    expect(read.body.observations).toHaveLength(1);
    expect(read.body.strengths).toBe("Зөвхөн текст");
  });

  it("clears the selection when an empty list is sent", async () => {
    const one = await noteFor(a);

    await authed(request(server()).put(`/v1/children/${a.child.id}/term-report`), teacherA).send({
      termId,
      observationIds: [one],
    });
    await authed(request(server()).put(`/v1/children/${a.child.id}/term-report`), teacherA).send({
      termId,
      observationIds: [],
    });

    const read = await authed(
      request(server()).get(`/v1/children/${a.child.id}/term-report?termId=${termId}`),
      teacherA,
    );
    expect(read.body.observations).toEqual([]);
  });

  it("★ a teacher from another kindergarten cannot cite this child's notes", async () => {
    const mine = await noteFor(a);
    const teacherB = await login(app, b.teacherUser.username);

    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/term-report`),
      teacherB,
    ).send({ termId, observationIds: [mine] });

    expect(res.status).toBe(404);
  });

  it("★ a guardian cannot write a report at all", async () => {
    const mine = await noteFor(a);

    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/term-report`),
      parentA,
    ).send({ termId, observationIds: [mine] });

    expect(res.status).toBe(404);
  });

  /*
    The cap is §3.4's bound: `findTermReport` includes the notes without
    paginating, which is only defensible because the set cannot grow past this.
  */
  it("refuses more than fifty cited notes", async () => {
    const ids = Array.from(
      { length: 51 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );

    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/term-report`),
      teacherA,
    ).send({ termId, observationIds: ids });

    expect(res.status).toBe(400);
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
      // ★ Seven since 2026-09-11, when the client's СҮД spreadsheet named the
      // strands. Five of them are the old rows renamed — the codes are
      // unchanged, so every assessment already filed still points at the
      // strand it was filed under — and "Байгаль, нийгмийн орчин" and
      // "Хөгжим" are genuinely new.
      expect(res.body.domains).toHaveLength(7);
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

  /**
   * ★ A duplicate number is a 409, not a 500.
   *
   * `@@unique([schoolYearId, number])` is the real guard, but reaching it
   * unguarded surfaced a raw constraint violation as a server error — which is
   * what an admin adding a term that already existed actually saw.
   */
  it("refuses a second term with the same number", async () => {
    const body = {
      schoolYearId: a.schoolYear.id,
      number: 2,
      name: "II улирал",
      startsOn: "2026-01-05",
      endsOn: "2026-03-31",
    };

    const first = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/terms`),
      adminA,
    ).send(body);
    expect(first.status).toBe(201);

    const second = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/terms`),
      adminA,
    ).send({ ...body, name: "Давхардсан" });

    expect(second.status).toBe(409);
  });

  /**
   * ★ The school year must belong to this kindergarten.
   *
   * The kindergarten comes from the authorized path; the school year from the
   * body. Without the check the term row would carry a kindergartenId and a
   * schoolYearId pointing at different tenants. `createGroup` guards the same
   * seam and this one did not.
   */
  it("refuses another kindergarten's school year", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/terms`),
      adminA,
    ).send({
      schoolYearId: b.schoolYear.id,
      number: 2,
      name: "Хулгайлсан жил",
      startsOn: "2026-01-05",
      endsOn: "2026-03-31",
    });

    expect(res.status).toBe(400);
    expect(
      await db.term.findFirst({ where: { schoolYearId: b.schoolYear.id, number: 2 } }),
    ).toBeNull();
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

// ═══════════════════════════════════════════════════════════════════════════
// The radar — RFP §12.1
// ═══════════════════════════════════════════════════════════════════════════

/** Assesses `count` extra children in group A on `domain`, at level index 2. */
async function assessCohort(count: number, domain = domainId) {
  for (let i = 0; i < count; i += 1) {
    const child = await createChild(a.kindergarten.id);
    const enrollment = await enrollChild(a.kindergarten.id, child.id, a.group.id, a.schoolYear.id);
    await db.assessment.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: child.id,
        enrollmentId: enrollment.id,
        domainId: domain,
        termId,
        levelId: levelIds[2]!,
        visibleToParents: false,
        assessedById: a.teacherUser.id,
      },
    });
  }
}

async function assessOwnChild(domain: string, levelIndex: number, visibleToParents = true) {
  await db.assessment.create({
    data: {
      kindergartenId: a.kindergarten.id,
      childId: a.child.id,
      enrollmentId: a.enrollment.id,
      domainId: domain,
      termId,
      levelId: levelIds[levelIndex]!,
      visibleToParents,
      assessedById: a.teacherUser.id,
    },
  });
}

describe("the radar", () => {
  /**
   * ★ Shape is the signal, so the axis count cannot depend on the data.
   *
   * A radar drawn only from assessed domains is a four-sided figure for one
   * child and a five-sided one for the next, and the two are not comparable at
   * a glance. An unassessed domain is a point at the origin, not a missing side.
   */
  it("returns every domain as an axis, assessed or not", async () => {
    await assessOwnChild(domainId, 3);

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/assessment-radar`),
      teacherA,
    ).query({ termId });

    expect(res.status).toBe(200);
    const domains = await db.developmentDomain.count({ where: { kindergartenId: null } });
    expect(res.body.axes).toHaveLength(domains);

    const assessed = res.body.axes.find(
      (ax: { domain: { id: string } }) => ax.domain.id === domainId,
    );
    expect(assessed.score).toBe(4);
    const untouched = res.body.axes.find(
      (ax: { domain: { id: string } }) => ax.domain.id === otherDomainId,
    );
    expect(untouched.score).toBeNull();
    expect(untouched.level).toBeNull();
  });

  /**
   * ★★ The disclosure rule, from the guardian's side.
   *
   * A mean over a group of two lets a parent solve for the other child exactly:
   * `other = mean × 2 − own`. This is the ordinary way an aggregate defeats an
   * authorization model, and it is the reason the cohort line is nullable.
   */
  it("withholds the cohort average from a guardian while the group is small", async () => {
    await assessOwnChild(domainId, 3);
    await assessCohort(1); // two assessed children in the group

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/assessment-radar`),
      parentA,
    ).query({ termId });

    expect(res.status).toBe(200);
    expect(res.body.cohort).toBeNull();
  });

  it("discloses it to a guardian once the cohort is large enough", async () => {
    await assessOwnChild(domainId, 3);
    await assessCohort(4); // five assessed children including their own

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/assessment-radar`),
      parentA,
    ).query({ termId });

    expect(res.status).toBe(200);
    expect(res.body.cohort).not.toBeNull();
    expect(res.body.cohort.sampleSize).toBe(5);
    // Four children at level 3 and their own at 4 → 3.2.
    expect(res.body.cohort.averageByDomain[domainId]).toBeCloseTo(3.2, 5);
  });

  /**
   * A teacher opens every child in their group individually on the assessment
   * grid, so suppressing the aggregate from them protects nobody and costs the
   * feature. The rule is about disclosure, not about secrecy.
   */
  it("never suppresses the cohort for staff", async () => {
    await assessOwnChild(domainId, 3);
    await assessCohort(1);

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/assessment-radar`),
      teacherA,
    ).query({ termId });

    expect(res.body.cohort).not.toBeNull();
    expect(res.body.cohort.sampleSize).toBe(2);
  });

  /**
   * ★★★ `visibleToParents` governs a family reading *their own* child, and the
   * cohort line is not that. If it filtered the aggregate too, the comparison
   * would silently mean "the average of the children whose teacher has
   * published" — a statistic that moves as colleagues publish and describes
   * nothing a reader could name.
   */
  it("averages the whole cohort, not only the published assessments", async () => {
    await assessOwnChild(domainId, 3);
    await assessCohort(4); // created with visibleToParents: false

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/assessment-radar`),
      parentA,
    ).query({ termId });

    expect(res.body.cohort.sampleSize).toBe(5);
  });

  it("hides the guardian's own unpublished score while still drawing the axis", async () => {
    await assessOwnChild(domainId, 3, false);

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/assessment-radar`),
      parentA,
    ).query({ termId });

    const axis = res.body.axes.find((ax: { domain: { id: string } }) => ax.domain.id === domainId);
    expect(axis.score).toBeNull();
  });

  // ── The three mandatory cases, CLAUDE.md §4.1 ────────────────────────────

  it("teacher from another kindergarten gets 404", async () => {
    const teacherB = await login(app, b.teacherUser.username);

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/assessment-radar`),
      teacherB,
    ).query({ termId });

    expect(res.status).toBe(404);
  });

  it("guardian of another child gets 404", async () => {
    const parentB = await login(app, b.parentUser.username);

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/assessment-radar`),
      parentB,
    ).query({ termId });

    expect(res.status).toBe(404);
  });

  it("a teacher assigned to no group containing the child gets 404", async () => {
    const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Бусад бүлэг");
    const stranger = await createChild(a.kindergarten.id);
    await enrollChild(a.kindergarten.id, stranger.id, otherGroup.id, a.schoolYear.id);

    const res = await authed(
      request(server()).get(`/v1/children/${stranger.id}/assessment-radar`),
      teacherA,
    ).query({ termId });

    expect(res.status).toBe(404);
  });

  it("requires a term — a radar of everything describes no moment", async () => {
    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/assessment-radar`),
      teacherA,
    );

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Өмнөх үнэлгээтэй харьцуулах — RFP §6.3
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The previous term's level, beside this term's chips.
 *
 * ★ What these pin is *which* previous — the same domain, one term back,
 * **within the same school year**. "The most recent assessment before this
 * one" is the tempting alternative and it is wrong: a child assessed in last
 * year's third term has not been assessed recently, and showing it as "өмнөх"
 * invites a comparison across a summer and a change of group.
 */
describe("★ previous term", () => {
  /** A term in the same year, at `number`. */
  async function makeTerm(number: number) {
    return db.term.create({
      data: {
        kindergartenId: a.kindergarten.id,
        schoolYearId: a.schoolYear.id,
        number,
        name: `${number} улирал`,
        startsOn: new Date(`2025-${String(number).padStart(2, "0")}-01`),
        endsOn: new Date(`2025-${String(number).padStart(2, "0")}-28`),
      },
    });
  }

  async function column(termIdArg: string) {
    return request(server())
      .get(`/v1/groups/${a.group.id}/assessments?termId=${termIdArg}&domainId=${domainId}`)
      .set("Cookie", teacherA.cookies);
  }

  /** The first term has no previous term at all. */
  it("is null in the first term of the year", async () => {
    const res = await column(termId);

    expect(res.status).toBe(200);
    expect(res.body.children[0].previous).toBeNull();
  });

  it("carries the level given one term back, with its label", async () => {
    const second = await makeTerm(2);

    // Assess in term 1…
    await authed(request(server()).put(`/v1/groups/${a.group.id}/assessments`), teacherA).send({
      termId,
      domainId,
      entries: [{ childId: a.child.id, levelId: levelIds[2]! }],
    });

    // …and read term 2, where it should appear as "previous".
    const res = await column(second.id);
    expect(res.status).toBe(200);

    const level = await db.assessmentLevel.findUniqueOrThrow({ where: { id: levelIds[2]! } });
    expect(res.body.children[0].previous).toMatchObject({
      id: level.id,
      value: level.value,
      label: level.label,
    });
  });

  /**
   * ★ The label is a snapshot, not a lookup.
   *
   * `AssessmentLevel` is a table an administrator edits (§2.3). The response
   * carries `value` and `label` rather than only an id so a client cannot
   * resolve last term's level against today's list and silently relabel what
   * was actually said. This is the read that would break if it ever became an
   * id alone.
   */
  it("names the level rather than leaving the client to resolve an id", async () => {
    const second = await makeTerm(2);
    await authed(request(server()).put(`/v1/groups/${a.group.id}/assessments`), teacherA).send({
      termId,
      domainId,
      entries: [{ childId: a.child.id, levelId: levelIds[1]! }],
    });

    const res = await column(second.id);
    expect(typeof res.body.children[0].previous.label).toBe("string");
    expect(res.body.children[0].previous.label.length).toBeGreaterThan(0);
  });

  /** A child nobody assessed last term reads as nothing, not as an error. */
  it("is null for a child who was not assessed last term", async () => {
    const second = await makeTerm(2);
    const res = await column(second.id);

    expect(res.status).toBe(200);
    expect(res.body.children[0].previous).toBeNull();
  });

  /**
   * ★★ One term back, not "any earlier term".
   *
   * Term 3's previous is term 2. A child assessed in term 1 and left alone in
   * term 2 has no previous level to show — reaching further back would present
   * a two-term-old judgement as the most recent one.
   */
  it("does not reach back further than one term", async () => {
    const second = await makeTerm(2);
    const third = await makeTerm(3);

    await authed(request(server()).put(`/v1/groups/${a.group.id}/assessments`), teacherA).send({
      termId,
      domainId,
      entries: [{ childId: a.child.id, levelId: levelIds[0]! }],
    });

    expect((await column(second.id)).body.children[0].previous).not.toBeNull();
    expect((await column(third.id)).body.children[0].previous).toBeNull();
  });

  /**
   * ★★★ The same domain, not any domain.
   *
   * A child assessed on "Хэл яриа" last term tells you nothing about their
   * "Бие бялдар" this term, and showing it in that column would be a number
   * that looks like a comparison and is not one.
   */
  it("does not borrow another domain's level", async () => {
    const second = await makeTerm(2);

    await authed(request(server()).put(`/v1/groups/${a.group.id}/assessments`), teacherA).send({
      termId,
      domainId: otherDomainId,
      entries: [{ childId: a.child.id, levelId: levelIds[3]! }],
    });

    const res = await column(second.id);
    expect(res.body.children[0].previous).toBeNull();
  });

  /**
   * ★ Still a fixed number of queries, whatever the group size.
   *
   * §3.4, and the same property `loadGroupColumn` is already pinned for. The
   * previous term is one more read for the whole roster — never one per child.
   */
  it("costs one query for the roster, not one per child", async () => {
    async function countPreviousQueries(groupSize: number): Promise<number> {
      await resetData();
      const s = await createScenario(`p${groupSize}`);
      const domain = await db.developmentDomain.findFirstOrThrow({
        where: { kindergartenId: null },
      });

      const childIds: string[] = [s.child.id];
      for (let i = 1; i < groupSize; i++) {
        const child = await createChild(s.kindergarten.id, { firstName: `Хүүхэд${i}` });
        await enrollChild(s.kindergarten.id, child.id, s.group.id, s.schoolYear.id);
        childIds.push(child.id);
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
      await repo.loadPreviousLevels(childIds, s.schoolYear.id, 1, domain.id);
      return queries;
    }

    expect(await countPreviousQueries(2)).toBe(1);
    expect(await countPreviousQueries(20)).toBe(1);
  });
});

/**
 * Энэ сарын зорилт — the group's own monthly documentation target.
 *
 * ★ It has moved twice, and both moves fixed a real fault.
 *
 * It began in `localStorage`, so the two teachers of one group could hold
 * different targets, a director saw neither, and clearing site data lost it.
 * It then spent a day on `Kindergarten`, which had the opposite fault: the
 * client asked that the teacher set it ("багш өөрөө сонгох"), and a
 * kindergarten-wide number set by one teacher would silently change every
 * other group's. On the group, set by whoever teaches it, it is theirs.
 *
 * ★★ Children, not notes. A goal counted in notes is met by writing twenty
 * about one child.
 */
describe("a group's monthly documentation goal", () => {
  const setGoal = (session: AuthSession, monthlyNoteGoal: number | null, group = a.group.id) =>
    authed(
      request(server()).put(`/v1/groups/${group}/assessments/monthly-note-goal`),
      session,
    ).send({
      monthlyNoteGoal,
    });

  const readGoal = async (group = a.group.id) =>
    (await authed(request(server()).get(`/v1/groups/${group}`), teacherA)).body.monthlyNoteGoal;

  it("is null until somebody sets one", async () => {
    expect(await readGoal()).toBeNull();
  });

  it("the group's own teacher sets it", async () => {
    expect((await setGoal(teacherA, 20)).status).toBe(200);
    expect(await readGoal()).toBe(20);
  });

  it("stores how many notes each targeted child should receive", async () => {
    const response = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/assessments/monthly-note-goal`),
      teacherA,
    ).send({ monthlyNotesPerChildGoal: 3 });

    expect(response.status).toBe(200);
    expect(response.body.monthlyNotesPerChildGoal).toBe(3);
    expect(
      (await authed(request(server()).get(`/v1/groups/${a.group.id}`), teacherA)).body
        .monthlyNotesPerChildGoal,
    ).toBe(3);
  });

  it("an administrator sets it too", async () => {
    expect((await setGoal(adminA, 15)).status).toBe(200);
    expect(await readGoal()).toBe(15);
  });

  /**
   * ★ Membership is not enough — the same rule the column editor makes.
   *
   * A teacher may only act on a group they are assigned to. This is the check
   * the screen cannot make, and it is why the control can be offered to every
   * member of staff who reaches the page.
   */
  it("a teacher not assigned to the group gets 404", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Тэдний биш бүлэг");

    expect((await setGoal(teacherA, 20, other.id)).status).toBe(404);
  });

  it("a teacher from another kindergarten gets 404", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    expect((await setGoal(teacherB, 20)).status).toBe(404);
  });

  it("a guardian gets 404", async () => {
    expect((await setGoal(parentA, 20)).status).toBe(404);
  });

  /** Null clears it; the screen then draws no goal card. */
  it("can be cleared", async () => {
    await setGoal(teacherA, 20);
    expect((await setGoal(teacherA, null)).status).toBe(200);
    expect(await readGoal()).toBeNull();
  });

  /**
   * ★ Zero is refused, not stored.
   *
   * A goal of zero is met by every group without writing anything — a bar
   * permanently at 100% saying nothing, which is worse than no bar.
   */
  it("refuses a goal of zero or an absurd one", async () => {
    expect((await setGoal(teacherA, 0)).status).toBe(400);
    expect((await setGoal(teacherA, 99)).status).toBe(400);

    const tooManyNotes = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/assessments/monthly-note-goal`),
      teacherA,
    ).send({ monthlyNotesPerChildGoal: 11 });
    expect(tooManyNotes.status).toBe(400);
  });

  /** ★ One group's target does not move another's. */
  it("belongs to the group and nobody else", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");

    await setGoal(adminA, 20);
    await setGoal(adminA, 8, other.id);

    expect(await readGoal()).toBe(20);
    expect(
      (await authed(request(server()).get(`/v1/groups/${other.id}`), adminA)).body.monthlyNoteGoal,
    ).toBe(8);
  });

  it("records who changed it", async () => {
    await setGoal(teacherA, 12);

    const entry = await db.auditLog.findFirst({
      where: { objectType: "Group", action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });

    expect(entry?.actorUserId).toBe(a.teacherUser.id);
    expect(entry?.metadata).toMatchObject({ monthlyNoteGoal: 12 });
  });
});

/**
 * Сургалтын чиглэлийн СҮД — the indicator list behind the compose form's
 * picker.
 *
 * ★ Read by every member, including a parent.
 *
 * A family's screen names the indicator a note was filed against, so hiding
 * the list from them would leave that name unresolvable — the same reasoning
 * `listConfig` beside it already makes for domains and levels.
 */
describe("the curriculum's indicators", () => {
  const list = (session: AuthSession, domain = domainId, kg = a.kindergarten.id) =>
    authed(
      request(server()).get(`/v1/kindergartens/${kg}/curriculum-indicators?domainId=${domain}`),
      session,
    );

  it("returns one strand's indicators with their level descriptors", async () => {
    const social = await db.developmentDomain.findFirstOrThrow({
      where: { kindergartenId: null, code: "social" },
    });

    const res = await list(teacherA, social.id);

    expect(res.status).toBe(200);
    // Нийгэм-сэтгэл хөдлөл carries nine indicators in the client's sheet.
    expect(res.body).toHaveLength(9);
    const first = res.body.find((row: { code: string }) => row.code === "НСХ1а");
    expect(first.levels).toHaveLength(4);
    expect(first.levels[0]).toMatchObject({ level: 1 });
    expect(first.levels[0].text).toContain("Биеийн зарим мэдрэмж");
  });

  /**
   * ★ Never the whole curriculum.
   *
   * Seventy-one indicators and their descriptors is about forty kilobytes, and
   * the form asks only once a strand is chosen. `domainId` is required so the
   * endpoint cannot quietly become the bulk export.
   */
  it("refuses to list without a strand", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/curriculum-indicators`),
      teacherA,
    );

    expect(res.status).toBe(400);
  });

  it("a parent reads it too", async () => {
    expect((await list(parentA)).status).toBe(200);
  });

  it("a member of another kindergarten gets 404", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    expect((await list(teacherB)).status).toBe(404);
  });

  /** A strand from another kindergarten is not a way in. */
  it("refuses a strand that is not this kindergarten's", async () => {
    const foreign = await db.developmentDomain.create({
      data: { kindergartenId: b.kindergarten.id, code: "own", name: "Өөрийн чиглэл" },
    });

    expect((await list(teacherA, foreign.id)).status).toBe(400);
  });
});
