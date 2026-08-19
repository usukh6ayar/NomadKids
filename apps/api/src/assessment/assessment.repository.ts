import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Assessments, terms and term reports.
 *
 * Two read filters carry the security weight, and both differ from the
 * observation rules — verified against the reference rather than assumed:
 *
 *  - an **assessment** is visible to a guardian when `visibleToParents` is set
 *    (RFP §2.3, "багшийн зөвшөөрсөн үнэлгээ"). There is no approval workflow.
 *  - a **term report** is visible to a guardian only when `status = FINAL`. A
 *    draft is the teacher's working text.
 */
@Injectable()
export class AssessmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Configuration ─────────────────────────────────────────────────────────

  /** A kindergarten's own rows plus the shared system defaults. */
  async listDomains(kindergartenId: string) {
    return this.prisma.developmentDomain.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ kindergartenId }, { kindergartenId: null }],
      },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
  }

  async listLevels(kindergartenId: string) {
    return this.prisma.assessmentLevel.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ kindergartenId }, { kindergartenId: null }],
      },
      orderBy: { value: "asc" },
    });
  }

  async findDomain(id: string, kindergartenId: string) {
    return this.prisma.developmentDomain.findFirst({
      where: { id, deletedAt: null, OR: [{ kindergartenId }, { kindergartenId: null }] },
    });
  }

  async findLevel(id: string, kindergartenId: string) {
    return this.prisma.assessmentLevel.findFirst({
      where: { id, deletedAt: null, OR: [{ kindergartenId }, { kindergartenId: null }] },
    });
  }

  // ── Terms ─────────────────────────────────────────────────────────────────

  async listTerms(kindergartenId: string, schoolYearId?: string) {
    return this.prisma.term.findMany({
      where: { kindergartenId, deletedAt: null, ...(schoolYearId ? { schoolYearId } : {}) },
      orderBy: { number: "asc" },
      include: { schoolYear: { select: { id: true, name: true } } },
    });
  }

  async findTerm(id: string, kindergartenIds: string[]) {
    return this.prisma.term.findFirst({
      where: { id, deletedAt: null, kindergartenId: { in: kindergartenIds } },
      include: { schoolYear: { select: { id: true, name: true } } },
    });
  }

  async createTerm(data: {
    kindergartenId: string;
    schoolYearId: string;
    number: number;
    name: string;
    startsOn: Date;
    endsOn: Date;
  }) {
    return this.prisma.term.create({ data });
  }

  async updateTerm(id: string, data: { name?: string; startsOn?: Date; endsOn?: Date }) {
    return this.prisma.term.update({ where: { id }, data });
  }

  // ── Child assessments ─────────────────────────────────────────────────────

  async listForChild(childId: string, isGuardian: boolean, termId?: string) {
    return this.prisma.assessment.findMany({
      where: {
        childId,
        deletedAt: null,
        ...(termId ? { termId } : {}),
        // A guardian sees only what the teacher published.
        ...(isGuardian ? { visibleToParents: true } : {}),
      },
      orderBy: [{ term: { number: "asc" } }, { domain: { order: "asc" } }],
      include: {
        domain: { select: { id: true, name: true, color: true, order: true } },
        level: { select: { id: true, value: true, label: true, color: true } },
        term: { select: { id: true, number: true, name: true } },
        assessedBy: { select: { id: true, lastName: true, firstName: true } },
      },
    });
  }

  /**
   * ★ One group, one term, ONE domain — RFP §6.3.
   *
   * **Two queries regardless of group size**: the roster, then their
   * assessments in one `IN` lookup. (The levels are a third query, issued in
   * parallel by the service.) This is the screen a teacher opens most often,
   * and a query per child is what makes it slow enough to stop being used.
   *
   * `assessment.test.ts` measures this for real — 2 queries for a group of two,
   * 2 for a group of twenty — by running the repository against an
   * instrumented Prisma client rather than asserting on the response shape.
   */
  async loadGroupColumn(groupId: string, schoolYearId: string, termId: string, domainId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { groupId, schoolYearId, status: "ACTIVE", deletedAt: null },
      select: {
        id: true,
        child: { select: { id: true, lastName: true, firstName: true, photoMediaFileId: true } },
      },
      orderBy: [{ child: { lastName: "asc" } }, { child: { firstName: "asc" } }],
    });

    const childIds = enrollments.map((e) => e.child.id);

    const assessments =
      childIds.length === 0
        ? []
        : await this.prisma.assessment.findMany({
            where: { childId: { in: childIds }, termId, domainId, deletedAt: null },
            select: {
              id: true,
              childId: true,
              levelId: true,
              comment: true,
              visibleToParents: true,
            },
          });

    return { enrollments, assessments };
  }

  async findAssessment(childId: string, termId: string, domainId: string) {
    return this.prisma.assessment.findFirst({
      where: { childId, termId, domainId, deletedAt: null },
    });
  }

  async upsertAssessment(data: {
    kindergartenId: string;
    childId: string;
    enrollmentId: string;
    domainId: string;
    termId: string;
    levelId: string;
    comment: string | null;
    assessedById: string;
    visibleToParents?: boolean;
  }) {
    const { childId, termId, domainId, visibleToParents, ...rest } = data;

    return this.prisma.assessment.upsert({
      where: { childId_termId_domainId: { childId, termId, domainId } },
      create: {
        childId,
        termId,
        domainId,
        ...rest,
        // A new assessment is private until the teacher publishes the term.
        visibleToParents: visibleToParents ?? false,
        assessedAt: new Date(),
      },
      update: {
        levelId: rest.levelId,
        comment: rest.comment,
        assessedById: rest.assessedById,
        assessedAt: new Date(),
        deletedAt: null,
        ...(visibleToParents === undefined ? {} : { visibleToParents }),
      },
      include: {
        domain: { select: { id: true, name: true } },
        level: { select: { id: true, value: true, label: true } },
      },
    });
  }

  /** Bulk upsert for one group + term + domain, in one transaction. */
  async upsertColumn(
    rows: {
      kindergartenId: string;
      childId: string;
      enrollmentId: string;
      domainId: string;
      termId: string;
      levelId: string;
      comment: string | null;
      assessedById: string;
    }[],
  ) {
    return this.prisma.$transaction(
      rows.map((row) => {
        const { childId, termId, domainId, ...rest } = row;
        return this.prisma.assessment.upsert({
          where: { childId_termId_domainId: { childId, termId, domainId } },
          create: {
            childId,
            termId,
            domainId,
            ...rest,
            visibleToParents: false,
            assessedAt: new Date(),
          },
          update: {
            levelId: rest.levelId,
            comment: rest.comment,
            assessedById: rest.assessedById,
            assessedAt: new Date(),
            deletedAt: null,
          },
        });
      }),
    );
  }

  /**
   * Publishes or unpublishes every assessment for a child in a term.
   *
   * Per term rather than per assessment: a teacher decides "this term's results
   * are ready to share", not row by row.
   */
  async setTermVisibility(childId: string, termId: string, visible: boolean) {
    const { count } = await this.prisma.assessment.updateMany({
      where: { childId, termId, deletedAt: null },
      data: { visibleToParents: visible },
    });
    return count;
  }

  // ── Term reports ──────────────────────────────────────────────────────────

  async findTermReport(childId: string, termId: string, isGuardian: boolean) {
    return this.prisma.termReport.findFirst({
      where: {
        childId,
        termId,
        deletedAt: null,
        // ★ A draft is the teacher's working text; a guardian sees it only once
        // finalised.
        ...(isGuardian ? { status: "FINAL" } : {}),
      },
      include: {
        author: { select: { id: true, lastName: true, firstName: true } },
        term: { select: { id: true, number: true, name: true } },
      },
    });
  }

  async upsertTermReport(data: {
    kindergartenId: string;
    childId: string;
    enrollmentId: string;
    termId: string;
    authorId: string;
    strengths?: string | null;
    needsSupport?: string | null;
    nextGoals?: string | null;
    adviceForParents?: string | null;
  }) {
    const { childId, termId, ...rest } = data;

    return this.prisma.termReport.upsert({
      where: { childId_termId: { childId, termId } },
      create: { childId, termId, ...rest, status: "DRAFT" },
      update: { ...rest, deletedAt: null },
    });
  }

  async finalizeTermReport(childId: string, termId: string) {
    return this.prisma.termReport.update({
      where: { childId_termId: { childId, termId } },
      data: { status: "FINAL", finalizedAt: new Date() },
    });
  }

  /** The child's enrollment for a term's school year — assessments pin to it. */
  async enrollmentForTerm(childId: string, schoolYearId: string) {
    return this.prisma.enrollment.findFirst({
      where: { childId, schoolYearId, deletedAt: null },
      orderBy: [{ status: "asc" }, { startedOn: "desc" }],
      select: { id: true, kindergartenId: true, groupId: true },
    });
  }

  async findGroupForAssessment(groupId: string, kindergartenIds: string[]) {
    return this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null, kindergartenId: { in: kindergartenIds } },
      select: { id: true, kindergartenId: true, schoolYearId: true, name: true },
    });
  }
}
