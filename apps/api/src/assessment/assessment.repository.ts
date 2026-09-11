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
  /**
   * The curriculum's indicators for one strand — СҮД.
   *
   * ★ Scoped to a strand, never returned whole.
   *
   * Seventy-one indicators with two hundred and sixty-five descriptors between
   * them is about forty kilobytes, and the form asks for them only once a
   * teacher has chosen a strand — at which point it wants between five and
   * twenty-two. §3.4's rule is about unbounded sets; this one is bounded by
   * the strand, which is the bound the screen already imposes.
   *
   * ★★ The kindergarten's own indicators sit beside the national ones, exactly
   * as `listDomains` treats strands: `kindergartenId IS NULL` is the standard,
   * a value is this kindergarten's addition, and anybody else's is invisible.
   */
  async listIndicators(kindergartenId: string, domainId: string) {
    return this.prisma.curriculumIndicator.findMany({
      where: {
        domainId,
        deletedAt: null,
        isActive: true,
        OR: [{ kindergartenId }, { kindergartenId: null }],
      },
      orderBy: [{ order: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        domainId: true,
        levels: { orderBy: { level: "asc" }, select: { level: true, text: true } },
      },
    });
  }

  /**
   * One indicator, only if this kindergarten may use it — the check `create`
   * makes before storing an id that came from a client.
   */
  async findIndicator(indicatorId: string, kindergartenId: string) {
    return this.prisma.curriculumIndicator.findFirst({
      where: {
        id: indicatorId,
        deletedAt: null,
        OR: [{ kindergartenId }, { kindergartenId: null }],
      },
      select: { id: true, levels: { select: { level: true } } },
    });
  }

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

  /**
   * A school year, but only if it belongs to this kindergarten.
   *
   * The kindergarten id comes from the authorized path parameter and the year
   * id from the request body, so this is what stops an admin of one
   * kindergarten attaching a term to another's year by pasting its id.
   * `TenantsService.createGroup` makes the same check for the same reason.
   */
  async findSchoolYearInKindergarten(schoolYearId: string, kindergartenId: string) {
    return this.prisma.schoolYear.findFirst({
      where: { id: schoolYearId, kindergartenId, deletedAt: null },
      select: { id: true },
    });
  }

  /** Whether this school year already has a term with this number. */
  async findTermByNumber(schoolYearId: string, number: number) {
    return this.prisma.term.findFirst({
      where: { schoolYearId, number, deletedAt: null },
      select: { id: true },
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

  async setGroupNoteGoal(
    groupId: string,
    goal: { monthlyNoteGoal?: number | null; monthlyNotesPerChildGoal?: number | null },
  ) {
    await this.prisma.group.update({ where: { id: groupId }, data: goal });
  }

  /**
   * The same children's levels in the **previous term** of the same year, for
   * the same domain — RFP §6.3's "өмнөх үнэлгээтэй харьцуулах".
   *
   * ★ One query for the whole roster, not one per row. `loadGroupColumn`
   * beside it makes the same promise, and this screen is the one a teacher
   * opens most often (§3.4).
   *
   * ★★ The previous term is `number - 1` **within the same school year**, not
   * "the most recent assessment before this one". A child assessed in the
   * third term of last year has not been assessed *recently*; showing that as
   * "өмнөх" would invite a comparison across a summer and a change of group.
   * The caller skips this entirely when `number` is 1, so the first term of a
   * year costs no query at all.
   */
  async loadPreviousLevels(
    childIds: string[],
    schoolYearId: string,
    previousTermNumber: number,
    domainId: string,
  ) {
    if (childIds.length === 0) return [];

    return this.prisma.assessment.findMany({
      where: {
        childId: { in: childIds },
        domainId,
        deletedAt: null,
        term: { schoolYearId, number: previousTermNumber, deletedAt: null },
      },
      select: {
        childId: true,
        level: { select: { id: true, value: true, label: true, color: true } },
      },
    });
  }

  /**
   * The cohort a radar compares against: every assessment in one group, one term.
   *
   * ★ One query, whatever the group size — the same rule `loadGroupColumn`
   * documents. A radar wants five domains rather than one, so this selects the
   * level value alongside the domain and lets the service do the arithmetic;
   * `groupBy` cannot aggregate `level.value` across the relation, and a query
   * per domain would be five where one does.
   *
   * ★★ `visibleToParents` is deliberately NOT filtered here.
   *
   * That flag governs whether a family may read *their own* child's assessment,
   * and applying it to the cohort would make the comparison line mean "the
   * average of the children whose teacher has published" — a different and
   * unstable statistic that moves as colleagues publish. Who may see this
   * aggregate at all is decided once, in the service, by cohort size.
   *
   * `childId` is returned so the service can count distinct children without a
   * second round trip.
   */
  async loadCohortAssessments(groupId: string, schoolYearId: string, termId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { groupId, schoolYearId, status: "ACTIVE", deletedAt: null },
      select: { childId: true },
    });

    const childIds = enrollments.map((e) => e.childId);
    if (childIds.length === 0) return [];

    return this.prisma.assessment.findMany({
      where: { childId: { in: childIds }, termId, deletedAt: null },
      select: { childId: true, domainId: true, level: { select: { value: true } } },
    });
  }

  /** The group a child sits in for a given school year, for the cohort lookup. */
  async groupForChildInYear(childId: string, schoolYearId: string) {
    return this.prisma.enrollment.findFirst({
      where: { childId, schoolYearId, status: "ACTIVE", deletedAt: null },
      select: { group: { select: { id: true, name: true } } },
    });
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
      select: {
        id: true,
        kindergartenId: true,
        schoolYearId: true,
        name: true,
        monthlyNoteGoal: true,
        monthlyNotesPerChildGoal: true,
      },
    });
  }
}
