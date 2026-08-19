import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { AuthzRepository } from "../src/authz/authz.repository";
import { canAccessChild } from "../src/authz/child-access";
import type { Actor } from "../src/authz/actor";
import { PrismaService } from "../src/prisma/prisma.service";
import { ObservationsRepository } from "../src/observations/observations.repository";
import { ReportsRepository } from "../src/reports/reports.repository";
import { resetData, testDb, uniq } from "./support/db";
import {
  assignTeacher,
  createChild,
  createGroup,
  createKindergarten,
  createMembership,
  createSchoolYear,
  createUser,
  enrollChild,
  linkGuardian,
} from "./support/fixtures";
import type { INestApplication } from "@nestjs/common";

/**
 * ★ Consistency between the two authorization paths.
 *
 * The same question — "may this actor see this child" — is answered twice, by
 * different code:
 *
 *   detail access → loadChildAccessFacts() + canAccessChild()
 *   list access   → visibleChildrenWhere(), a Prisma WHERE fragment
 *
 * They must agree for every child. When they drift, the symptom is quiet and
 * confusing: a child the list omits but whose detail page loads, or worse, a
 * child the list shows and the detail page 404s. Neither looks like a security
 * bug in review; both are.
 *
 * These tests exist because the two implementations are structurally different
 * — one traverses loaded rows, the other builds SQL — and will drift again
 * every time either side is touched. The edge cases below are exactly where the
 * drift lands: soft-deleted enrollments, ended enrollments, and children with no
 * enrollment history at all.
 */

let app: INestApplication;
let authz: AuthzRepository;
const db = testDb();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  authz = app.get(AuthzRepository);
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
});

/** Does the LIST query return this child for this actor? */
async function listSeesChild(actor: Actor, childId: string): Promise<boolean> {
  const where = await authz.visibleChildrenWhere(actor);
  const prisma = app.get(PrismaService);
  const found = await prisma.child.findFirst({
    where: { AND: [where, { id: childId }] },
    select: { id: true },
  });
  return found !== null;
}

/** Does the DETAIL path grant access to this child for this actor? */
async function detailSeesChild(actor: Actor, childId: string): Promise<boolean> {
  const facts = await authz.loadChildAccessFacts(actor, childId);
  return facts !== null && canAccessChild(actor, facts);
}

/**
 * The assertion that matters. Reports which side disagreed, because "false !==
 * true" alone tells you nothing about which path is wrong.
 */
async function expectAgreement(actor: Actor, childId: string, expected: boolean, label: string) {
  const list = await listSeesChild(actor, childId);
  const detail = await detailSeesChild(actor, childId);
  expect({ case: label, list, detail }).toEqual({ case: label, list: expected, detail: expected });
}

async function actorFor(userId: string): Promise<Actor> {
  return {
    userId,
    sessionId: "test-session",
    memberships: await authz.loadMemberships(userId),
  };
}

describe("list and detail authorization agree", () => {
  it("child with NO enrollments — admin of the denormalised kindergarten", async () => {
    // The fallback case. A child registered a minute ago has no enrollment yet,
    // and the staff filling in the record must not be locked out of it.
    const kg = await createKindergarten();
    const adminUser = await createUser({ username: uniq("admin") });
    await createMembership(adminUser.id, kg.id, "ADMIN");
    const child = await createChild(kg.id);

    await expectAgreement(await actorFor(adminUser.id), child.id, true, "no enrollments");
  });

  it("child whose ONLY enrollment is soft-deleted", async () => {
    // The divergence the fact loader and the list query are most likely to
    // disagree on: `loadChildAccessFacts` filters `deletedAt: null`, so the
    // child reads as having no enrollments and the fallback fires. The list
    // query must reach the same conclusion.
    const kg = await createKindergarten();
    const year = await createSchoolYear(kg.id);
    const group = await createGroup(kg.id, year.id);
    const adminUser = await createUser({ username: uniq("admin") });
    await createMembership(adminUser.id, kg.id, "ADMIN");

    const child = await createChild(kg.id);
    const enrollment = await enrollChild(kg.id, child.id, group.id, year.id);
    await db.enrollment.update({
      where: { id: enrollment.id },
      data: { deletedAt: new Date() },
    });

    await expectAgreement(await actorFor(adminUser.id), child.id, true, "soft-deleted enrollment");
  });

  it("child with an ENDED enrollment — admin still sees them", async () => {
    const kg = await createKindergarten();
    const year = await createSchoolYear(kg.id);
    const group = await createGroup(kg.id, year.id);
    const adminUser = await createUser({ username: uniq("admin") });
    await createMembership(adminUser.id, kg.id, "ADMIN");

    const child = await createChild(kg.id);
    await enrollChild(kg.id, child.id, group.id, year.id, "ENDED");

    await expectAgreement(await actorFor(adminUser.id), child.id, true, "ended enrollment");
  });

  it("child transferred away — the PREVIOUS kindergarten's admin keeps access", async () => {
    // History is authoritative, so the old admin still sees the child. This is
    // the documented consequence of D2 (behaviour preserved unchanged).
    const oldKg = await createKindergarten();
    const newKg = await createKindergarten();
    const oldYear = await createSchoolYear(oldKg.id);
    const newYear = await createSchoolYear(newKg.id);
    const oldGroup = await createGroup(oldKg.id, oldYear.id);
    const newGroup = await createGroup(newKg.id, newYear.id);

    const oldAdmin = await createUser({ username: uniq("oldadmin") });
    await createMembership(oldAdmin.id, oldKg.id, "ADMIN");

    // The child now belongs to newKg but was enrolled in oldKg.
    const child = await createChild(newKg.id);
    await enrollChild(oldKg.id, child.id, oldGroup.id, oldYear.id, "TRANSFERRED");
    await enrollChild(newKg.id, child.id, newGroup.id, newYear.id);

    await expectAgreement(await actorFor(oldAdmin.id), child.id, true, "previous kindergarten");
  });

  it("admin of an UNRELATED kindergarten sees nothing", async () => {
    const kg = await createKindergarten();
    const other = await createKindergarten();
    const year = await createSchoolYear(kg.id);
    const group = await createGroup(kg.id, year.id);

    const outsideAdmin = await createUser({ username: uniq("outside") });
    await createMembership(outsideAdmin.id, other.id, "ADMIN");

    const child = await createChild(kg.id);
    await enrollChild(kg.id, child.id, group.id, year.id);

    await expectAgreement(await actorFor(outsideAdmin.id), child.id, false, "unrelated admin");
  });

  it("admin of an unrelated kindergarten sees nothing even with NO enrollments", async () => {
    // The fallback must not widen access to admins elsewhere.
    const kg = await createKindergarten();
    const other = await createKindergarten();
    const outsideAdmin = await createUser({ username: uniq("outside") });
    await createMembership(outsideAdmin.id, other.id, "ADMIN");
    const child = await createChild(kg.id);

    await expectAgreement(
      await actorFor(outsideAdmin.id),
      child.id,
      false,
      "unrelated admin, no enrollments",
    );
  });

  it("assigned teacher", async () => {
    const kg = await createKindergarten();
    const year = await createSchoolYear(kg.id);
    const group = await createGroup(kg.id, year.id);
    const teacherUser = await createUser({ username: uniq("teacher") });
    const membership = await createMembership(teacherUser.id, kg.id, "TEACHER");
    await assignTeacher(kg.id, group.id, membership.id);

    const child = await createChild(kg.id);
    await enrollChild(kg.id, child.id, group.id, year.id);

    await expectAgreement(await actorFor(teacherUser.id), child.id, true, "assigned teacher");
  });

  it("teacher from another group in the same kindergarten", async () => {
    const kg = await createKindergarten();
    const year = await createSchoolYear(kg.id);
    const groupA = await createGroup(kg.id, year.id, "А бүлэг");
    const groupB = await createGroup(kg.id, year.id, "Б бүлэг");

    const teacherUser = await createUser({ username: uniq("teacher") });
    const membership = await createMembership(teacherUser.id, kg.id, "TEACHER");
    await assignTeacher(kg.id, groupB.id, membership.id);

    const child = await createChild(kg.id);
    await enrollChild(kg.id, child.id, groupA.id, year.id);

    await expectAgreement(await actorFor(teacherUser.id), child.id, false, "wrong group");
  });

  it("REVOKED teacher — assignment ended", async () => {
    const kg = await createKindergarten();
    const year = await createSchoolYear(kg.id);
    const group = await createGroup(kg.id, year.id);
    const teacherUser = await createUser({ username: uniq("teacher") });
    const membership = await createMembership(teacherUser.id, kg.id, "TEACHER");
    await assignTeacher(kg.id, group.id, membership.id, new Date("2026-01-31"));

    const child = await createChild(kg.id);
    await enrollChild(kg.id, child.id, group.id, year.id);

    await expectAgreement(await actorFor(teacherUser.id), child.id, false, "revoked teacher");
  });

  it("teacher whose assignment row is soft-deleted", async () => {
    const kg = await createKindergarten();
    const year = await createSchoolYear(kg.id);
    const group = await createGroup(kg.id, year.id);
    const teacherUser = await createUser({ username: uniq("teacher") });
    const membership = await createMembership(teacherUser.id, kg.id, "TEACHER");
    const assignment = await assignTeacher(kg.id, group.id, membership.id);
    await db.groupTeacher.update({
      where: { id: assignment.id },
      data: { deletedAt: new Date() },
    });

    const child = await createChild(kg.id);
    await enrollChild(kg.id, child.id, group.id, year.id);

    await expectAgreement(
      await actorFor(teacherUser.id),
      child.id,
      false,
      "soft-deleted assignment",
    );
  });

  it("active guardian", async () => {
    const kg = await createKindergarten();
    const year = await createSchoolYear(kg.id);
    const group = await createGroup(kg.id, year.id);
    const parentUser = await createUser({ username: uniq("parent") });
    await createMembership(parentUser.id, kg.id, "PARENT");

    const child = await createChild(kg.id);
    await enrollChild(kg.id, child.id, group.id, year.id);
    await linkGuardian(kg.id, child.id, parentUser.id);

    await expectAgreement(await actorFor(parentUser.id), child.id, true, "active guardian");
  });

  it("REVOKED guardian — canView false", async () => {
    const kg = await createKindergarten();
    const year = await createSchoolYear(kg.id);
    const group = await createGroup(kg.id, year.id);
    const parentUser = await createUser({ username: uniq("parent") });
    await createMembership(parentUser.id, kg.id, "PARENT");

    const child = await createChild(kg.id);
    await enrollChild(kg.id, child.id, group.id, year.id);
    await linkGuardian(kg.id, child.id, parentUser.id, false);

    await expectAgreement(await actorFor(parentUser.id), child.id, false, "revoked guardian");
  });

  it("guardian whose link is soft-deleted", async () => {
    const kg = await createKindergarten();
    const year = await createSchoolYear(kg.id);
    const group = await createGroup(kg.id, year.id);
    const parentUser = await createUser({ username: uniq("parent") });
    await createMembership(parentUser.id, kg.id, "PARENT");

    const child = await createChild(kg.id);
    await enrollChild(kg.id, child.id, group.id, year.id);
    const link = await linkGuardian(kg.id, child.id, parentUser.id);
    await db.guardianship.update({ where: { id: link.id }, data: { deletedAt: new Date() } });

    await expectAgreement(await actorFor(parentUser.id), child.id, false, "deleted guardianship");
  });

  it("guardian of a DIFFERENT child", async () => {
    const kg = await createKindergarten();
    const year = await createSchoolYear(kg.id);
    const group = await createGroup(kg.id, year.id);
    const parentUser = await createUser({ username: uniq("parent") });
    await createMembership(parentUser.id, kg.id, "PARENT");

    const ownChild = await createChild(kg.id, { firstName: "Минийх" });
    await enrollChild(kg.id, ownChild.id, group.id, year.id);
    await linkGuardian(kg.id, ownChild.id, parentUser.id);

    const otherChild = await createChild(kg.id, { firstName: "Бусад" });
    await enrollChild(kg.id, otherChild.id, group.id, year.id);

    await expectAgreement(await actorFor(parentUser.id), otherChild.id, false, "sibling isolation");
  });

  it("a soft-deleted CHILD is invisible to everyone", async () => {
    const kg = await createKindergarten();
    const adminUser = await createUser({ username: uniq("admin") });
    await createMembership(adminUser.id, kg.id, "ADMIN");
    const child = await createChild(kg.id);
    await db.child.update({ where: { id: child.id }, data: { deletedAt: new Date() } });

    await expectAgreement(await actorFor(adminUser.id), child.id, false, "soft-deleted child");
  });

  it("an actor with no memberships sees nothing", async () => {
    const kg = await createKindergarten();
    const nobody = await createUser({ username: uniq("nobody") });
    const child = await createChild(kg.id);

    await expectAgreement(await actorFor(nobody.id), child.id, false, "no memberships");
  });
});

/**
 * ★ The report is a THIRD reader of the same observations.
 *
 * The list endpoint, the detail endpoint and the generated PDF all answer
 * "which observations may this person see about this child". They compose one
 * predicate — `ObservationsRepository.readableWhere` — and these tests hold
 * them to it.
 *
 * The report is the case that matters most and is checked least. A list is
 * re-derived on every request, so drift there surfaces immediately; a PDF
 * freezes one viewer's filter into a file that gets forwarded. A report using a
 * laxer rule would put a teacher's private note into a document the family
 * emails to relatives.
 */
describe("the report reads the same observations as the list", () => {
  async function observationSets(childId: string, viewer: { isGuardian: boolean; userId: string }) {
    const observations = app.get(ObservationsRepository);
    const reports = app.get(ReportsRepository);

    const listed = await observations.list(childId, viewer, {}, { page: 1, pageSize: 100 });
    const report = await reports.loadPortfolioData(childId, viewer);

    return {
      report: new Set(report.observations.map((o) => o.id)),
      // The report additionally drops `includeInReport: false`, so the
      // comparison is against the same subset of the list.
      listReportable: new Set(listed.items.filter((o) => o.includeInReport).map((o) => o.id)),
    };
  }

  async function seedWorld() {
    const kg = await createKindergarten();
    const year = await createSchoolYear(kg.id);
    const group = await createGroup(kg.id, year.id);

    const teacherUser = await createUser({ username: uniq("teacher") });
    const teacherMembership = await createMembership(teacherUser.id, kg.id, "TEACHER");
    await assignTeacher(kg.id, group.id, teacherMembership.id);

    const parentUser = await createUser({ username: uniq("parent") });
    await createMembership(parentUser.id, kg.id, "PARENT");

    const child = await createChild(kg.id);
    const enrollment = await enrollChild(kg.id, child.id, group.id, year.id);
    await linkGuardian(kg.id, child.id, parentUser.id);

    const type = await db.observationType.findFirstOrThrow({ where: { kindergartenId: null } });

    const make = async (data: Record<string, unknown>) =>
      db.observation.create({
        data: {
          kindergartenId: kg.id,
          childId: child.id,
          enrollmentId: enrollment.id,
          typeId: type.id,
          observedOn: new Date("2025-10-01"),
          ...data,
        } as never,
      });

    // One of every shape the filter has to separate.
    await make({ source: "TEACHER", visibleToParents: true, reviewStatus: "APPROVED" });
    await make({ source: "TEACHER", visibleToParents: false, reviewStatus: "APPROVED" });
    await make({
      source: "PARENT",
      authorId: parentUser.id,
      visibleToParents: true,
      reviewStatus: "PENDING",
    });
    await make({
      source: "PARENT",
      authorId: parentUser.id,
      visibleToParents: false,
      reviewStatus: "RETURNED",
    });
    await make({
      source: "TEACHER",
      visibleToParents: true,
      reviewStatus: "APPROVED",
      includeInReport: false,
    });

    return { child, teacherUser, parentUser };
  }

  it("agrees for a guardian", async () => {
    const { child, parentUser } = await seedWorld();
    const sets = await observationSets(child.id, { isGuardian: true, userId: parentUser.id });

    expect([...sets.report].sort()).toEqual([...sets.listReportable].sort());
    expect(sets.report.size).toBeGreaterThan(0);
  });

  it("agrees for a teacher", async () => {
    const { child, teacherUser } = await seedWorld();
    const sets = await observationSets(child.id, { isGuardian: false, userId: teacherUser.id });

    expect([...sets.report].sort()).toEqual([...sets.listReportable].sort());
  });

  /** A guardian's PDF must be a strict subset of a teacher's. */
  it("gives a guardian strictly less than a teacher", async () => {
    const { child, teacherUser, parentUser } = await seedWorld();

    const forParent = await observationSets(child.id, { isGuardian: true, userId: parentUser.id });
    const forTeacher = await observationSets(child.id, {
      isGuardian: false,
      userId: teacherUser.id,
    });

    for (const id of forParent.report) {
      expect(forTeacher.report.has(id)).toBe(true);
    }
    expect(forParent.report.size).toBeLessThan(forTeacher.report.size);
  });
});
