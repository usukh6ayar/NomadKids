import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import { createChild, createScenario, enrollChild, type Scenario } from "./support/fixtures";
import { PrismaService } from "../src/prisma/prisma.service";
import { ChildrenRepository } from "../src/children/children.repository";
import { ObservationsRepository } from "../src/observations/observations.repository";
import { NotificationsRepository } from "../src/notifications/notifications.repository";
import { PortfolioRepository } from "../src/portfolio/portfolio.repository";
import { DashboardRepository } from "../src/dashboard/dashboard.repository";
import { ReportsRepository } from "../src/reports/reports.repository";

/**
 * ★ N+1 regression guards — CLAUDE.md §3.5.
 *
 * The property under test is not "is this fast" but **"does the query count
 * grow with the number of rows"**. Those are different questions, and only the
 * second one predicts what happens when a kindergarten has three years of data
 * instead of a seeded handful.
 *
 * Measured through an instrumented Prisma client, the same technique
 * `assessment.test.ts` established. An earlier attempt during Phase 12 tried to
 * count statements from *outside* the process using `pg_stat_database`; it
 * reported endpoints getting **cheaper** as rows were added (−53 queries for
 * +24 rows), which is impossible and revealed the counter was picking up the
 * report worker and the maintenance scheduler. A measurement that can report a
 * negative is not a measurement.
 *
 * Each case is run at two sizes and compared. The absolute number is
 * deliberately not asserted — it changes whenever a legitimate `include` is
 * added, and a test that fails for that reason gets weakened rather than read.
 */

let app: INestApplication;
const db = testDb();

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
});

/** Runs `work` against a counting client and reports how many operations it issued. */
async function countQueries(work: (prisma: PrismaService) => Promise<unknown>): Promise<number> {
  let queries = 0;
  const counted = db.$extends({
    query: {
      $allOperations({ args, query }) {
        queries += 1;
        return query(args);
      },
    },
  });

  await work(counted as unknown as PrismaService);
  return queries;
}

/** A scenario with `extra` additional children enrolled in the same group. */
async function scenarioWithChildren(extra: number): Promise<Scenario> {
  const s = await createScenario(uniq("n"));
  for (let i = 0; i < extra; i += 1) {
    const child = await createChild(s.kindergarten.id, { firstName: `Хүүхэд${i}` });
    await enrollChild(s.kindergarten.id, child.id, s.group.id, s.schoolYear.id);
  }
  return s;
}

async function addObservations(s: Scenario, count: number) {
  const type = await db.observationType.findFirstOrThrow({ where: { kindergartenId: null } });
  for (let i = 0; i < count; i += 1) {
    await db.observation.create({
      data: {
        kindergartenId: s.kindergarten.id,
        childId: s.child.id,
        enrollmentId: s.enrollment.id,
        typeId: type.id,
        source: "TEACHER",
        observedOn: new Date("2025-10-01"),
        situation: `Ажиглалт ${i}`,
        visibleToParents: true,
        reviewStatus: "APPROVED",
      },
    });
  }
}

/**
 * The assertion.
 *
 * A tolerance of 2 rather than 0: a repository may legitimately issue one extra
 * query when data exists that did not before (a `findFirst` that previously
 * short-circuited). What it must never do is issue one *per row* — 24 extra
 * rows costing 24 extra queries is the shape this catches.
 */
function expectConstant(label: string, small: number, large: number, addedRows: number) {
  const growth = large - small;
  expect(
    growth,
    `${label}: ${small} → ${large} queries for +${addedRows} rows — this scales per row`,
  ).toBeLessThanOrEqual(2);
}

describe("list endpoints cost a constant number of queries", () => {
  it("the children list does not query per child", async () => {
    const small = await countQueries(async (prisma) => {
      const s = await scenarioWithChildren(1);
      const repo = new ChildrenRepository(prisma);
      // Counting starts from here; the fixture work above is on the raw client.
      return repo.listChildren({ id: { in: [s.child.id] } }, {}, { page: 1, pageSize: 25 });
    });

    await resetData();
    const s = await scenarioWithChildren(24);
    const ids = (await db.child.findMany({ where: { kindergartenId: s.kindergarten.id } })).map(
      (c) => c.id,
    );

    const large = await countQueries(async (prisma) => {
      const repo = new ChildrenRepository(prisma);
      return repo.listChildren({ id: { in: ids } }, {}, { page: 1, pageSize: 25 });
    });

    expectConstant("children list", small, large, 24);
  });

  it("the observation list does not query per observation", async () => {
    const s1 = await scenarioWithChildren(0);
    await addObservations(s1, 1);
    const viewer = { isGuardian: false, userId: s1.teacherUser.id };

    const small = await countQueries(async (prisma) =>
      new ObservationsRepository(prisma).list(s1.child.id, viewer, {}, { page: 1, pageSize: 25 }),
    );

    await resetData();
    const s2 = await scenarioWithChildren(0);
    await addObservations(s2, 25);
    const viewer2 = { isGuardian: false, userId: s2.teacherUser.id };

    const large = await countQueries(async (prisma) =>
      new ObservationsRepository(prisma).list(s2.child.id, viewer2, {}, { page: 1, pageSize: 25 }),
    );

    expectConstant("observation list", small, large, 24);
  });

  it("the notification list does not query per notification", async () => {
    async function measure(count: number): Promise<number> {
      await resetData();
      const s = await createScenario(uniq("n"));
      for (let i = 0; i < count; i += 1) {
        await db.notification.create({
          data: {
            kindergartenId: s.kindergarten.id,
            title: `Мэдэгдэл ${i}`,
            body: "текст",
            status: "PUBLISHED",
            publishedAt: new Date(),
          },
        });
      }

      return countQueries(async (prisma) =>
        new NotificationsRepository(prisma).list(
          { kindergartenId: s.kindergarten.id },
          s.teacherUser.id,
          { page: 1, pageSize: 25 },
          false,
        ),
      );
    }

    expectConstant("notification list", await measure(1), await measure(25), 24);
  });
});

describe("detail endpoints cost a constant number of queries", () => {
  it("the child detail does not query per guardian or enrollment", async () => {
    async function measure(guardians: number): Promise<number> {
      await resetData();
      const s = await createScenario(uniq("d"));

      for (let i = 0; i < guardians; i += 1) {
        const guardian = await db.user.create({
          data: {
            username: uniq(`g${i}`),
            passwordHash: "x",
            lastName: "Асран",
            firstName: `Хамгаалагч${i}`,
          },
        });
        await db.guardianship.create({
          data: {
            kindergartenId: s.kindergarten.id,
            childId: s.child.id,
            guardianUserId: guardian.id,
            relation: "OTHER",
            canView: true,
          },
        });
      }

      return countQueries(async (prisma) => new ChildrenRepository(prisma).findChild(s.child.id));
    }

    expectConstant("child detail", await measure(1), await measure(20), 19);
  });

  /**
   * ★ The portfolio overview was the one endpoint the noisy external probe
   * accused of scaling. Measured properly here, at two sizes.
   */
  it("the portfolio overview does not query per age profile or note", async () => {
    async function measure(entries: number): Promise<number> {
      await resetData();
      const s = await createScenario(uniq("p"));

      // Ages 2–5 only, so "more entries" means more birthday notes as well.
      for (let age = 2; age <= Math.min(5, 1 + entries); age += 1) {
        await db.childAgeProfile.create({
          data: {
            kindergartenId: s.kindergarten.id,
            childId: s.child.id,
            age,
            favoriteColor: "цэнхэр",
            parentNote: "эцэг эхийн тэмдэглэл",
            teacherNote: "багшийн тэмдэглэл",
          },
        });
        await db.birthdayNote.create({
          data: {
            kindergartenId: s.kindergarten.id,
            childId: s.child.id,
            age,
            note: `${age} насны тэмдэглэл`,
          },
        });
      }

      return countQueries(async (prisma) =>
        new PortfolioRepository(prisma).loadOverview(s.child.id),
      );
    }

    expectConstant("portfolio overview", await measure(1), await measure(4), 3);
  });
});

describe("dashboards cost a constant number of queries", () => {
  it("the teacher dashboard does not query per child", async () => {
    async function measure(children: number): Promise<number> {
      await resetData();
      const s = await scenarioWithChildren(children);
      const groupIds = [s.group.id];

      return countQueries(async (prisma) => {
        const repo = new DashboardRepository(prisma);
        await repo.recentObservations(groupIds);
        await repo.activeChildCount(groupIds);
        await repo.pendingReviewCount(groupIds);
      });
    }

    expectConstant("teacher dashboard", await measure(1), await measure(25), 24);
  });

  it("the parent home does not query per child", async () => {
    async function measure(children: number): Promise<number> {
      await resetData();
      const s = await scenarioWithChildren(children);
      const childIds = (
        await db.child.findMany({ where: { kindergartenId: s.kindergarten.id } })
      ).map((c) => c.id);

      return countQueries(async (prisma) =>
        new DashboardRepository(prisma).recentForGuardian(childIds, s.parentUser.id),
      );
    }

    expectConstant("parent home feed", await measure(1), await measure(25), 24);
  });
});

describe("report generation costs a constant number of queries", () => {
  /**
   * The PDF gathers the whole portfolio. It is the single heaviest read in the
   * product, and the one most likely to acquire a per-row query as sections are
   * added to the template.
   */
  it("gathering portfolio data does not query per observation", async () => {
    async function measure(observations: number): Promise<number> {
      await resetData();
      const s = await createScenario(uniq("r"));
      await addObservations(s, observations);
      const viewer = { isGuardian: false, userId: s.teacherUser.id };

      return countQueries(async (prisma) =>
        new ReportsRepository(prisma, new ObservationsRepository(prisma)).loadPortfolioData(
          s.child.id,
          viewer,
        ),
      );
    }

    expectConstant("report portfolio gather", await measure(1), await measure(25), 24);
  });
});
