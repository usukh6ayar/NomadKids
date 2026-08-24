import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { VisibleChildrenFilter } from "../authz/authz.repository";
import type { AuditAction } from "../domain/enums";

/**
 * Dashboard reads.
 *
 * ★ Every query here is bounded — `take` on every list, `count` rather than
 * fetching to measure. A dashboard is the first screen of every session, so an
 * unbounded query here is felt on every login rather than occasionally.
 */
@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Teacher ───────────────────────────────────────────────────────────────

  /** Parent submissions awaiting this teacher — the only true queue. */
  async pendingReviewCount(groupIds: string[]): Promise<number> {
    if (groupIds.length === 0) return 0;
    return this.prisma.observation.count({
      where: {
        deletedAt: null,
        source: "PARENT",
        reviewStatus: "PENDING",
        enrollment: { groupId: { in: groupIds }, deletedAt: null },
      },
    });
  }

  /**
   * Children in this teacher's groups with no assessment in the current term.
   *
   * The gap, not the coverage: a dashboard answers "what needs attention", and
   * a list of children already assessed needs no action.
   */
  async childrenMissingAssessment(groupIds: string[], termId: string, take = 10) {
    if (groupIds.length === 0) return [];
    return this.prisma.child.findMany({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        enrollments: { some: { groupId: { in: groupIds }, status: "ACTIVE", deletedAt: null } },
        assessments: { none: { termId, deletedAt: null } },
      },
      select: {
        id: true,
        lastName: true,
        firstName: true,
        photoMediaFileId: true,
        enrollments: {
          where: { status: "ACTIVE", deletedAt: null },
          select: { group: { select: { id: true, name: true } } },
          take: 1,
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take,
    });
  }

  /** Recent observations, so a teacher can resume where they left off. */
  async recentObservations(groupIds: string[], take = 5) {
    if (groupIds.length === 0) return [];
    return this.prisma.observation.findMany({
      where: {
        deletedAt: null,
        enrollment: { groupId: { in: groupIds }, deletedAt: null },
      },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        observedOn: true,
        situation: true,
        source: true,
        visibleToParents: true,
        child: { select: { id: true, lastName: true, firstName: true } },
        type: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Children in these groups whose birthday is today — RFP §12.1.
   *
   * ★ Matched on month and day in SQL, not in JavaScript.
   *
   * Loading the roster and filtering it in the service works at 35 children and
   * quietly becomes a transfer of every child's record at 3,000. Prisma has no
   * month/day helper, so the match is a raw query — scoped to this teacher's
   * own groups inside the SQL, never widened to the kindergarten and then
   * narrowed afterwards.
   *
   * A child born on 29 February simply has no birthday in a common year, which
   * is the same answer a person would give.
   */
  async birthdaysToday(groupIds: string[], on: Date) {
    if (groupIds.length === 0) return [];

    return this.prisma.$queryRaw<
      {
        id: string;
        lastName: string;
        firstName: string;
        dateOfBirth: Date;
        photoMediaFileId: string | null;
      }[]
    >`
      SELECT DISTINCT c.id, c."lastName", c."firstName", c."dateOfBirth", c."photoMediaFileId"
      FROM children c
      JOIN enrollments e ON e."childId" = c.id
      WHERE c."deletedAt" IS NULL
        AND c.status = 'ACTIVE'
        AND e."deletedAt" IS NULL
        AND e.status = 'ACTIVE'
        AND e."groupId" = ANY(${groupIds}::uuid[])
        AND EXTRACT(MONTH FROM c."dateOfBirth") = ${on.getMonth() + 1}
        AND EXTRACT(DAY FROM c."dateOfBirth") = ${on.getDate()}
      ORDER BY c."lastName", c."firstName"
      LIMIT 10
    `;
  }

  /**
   * How far this term's assessment has got — RFP §12.1 "улирлын үнэлгээний явц".
   *
   * Two counts, not a per-child list: the roster size and how many of them have
   * at least one assessment this term. The list of who is missing is already
   * returned separately by `childrenMissingAssessment`, and returning both
   * shapes of the same fact would let them disagree.
   */
  async termAssessmentProgress(groupIds: string[], termId: string) {
    if (groupIds.length === 0) return { assessed: 0 };

    const assessed = await this.prisma.child.count({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        enrollments: { some: { groupId: { in: groupIds }, status: "ACTIVE", deletedAt: null } },
        assessments: { some: { termId, deletedAt: null } },
      },
    });

    return { assessed };
  }

  /**
   * How this term's observations are distributed across the configured types.
   *
   * ★ Counts, and deliberately not a completion percentage.
   *
   * The wireframe asked for "биелэлт" — a fulfilment rate — and there is no
   * target anywhere in the schema to divide by. A percentage would need a
   * denominator somebody invented, which is the shape of number that makes a
   * dashboard lie. What exists is how many of each kind were written, so that
   * is what this returns; the UI shows each type's share of the total, which is
   * a fact rather than a score.
   *
   * ★★ Driven by `ObservationType`, which is a table an administrator edits
   * (CLAUDE.md §2.3), so this reports whatever a kindergarten has configured
   * rather than three names hard-coded from a drawing. Types with no
   * observations are absent here and filled in by the service, so a
   * newly-configured type reads as "0" rather than vanishing.
   *
   * One `groupBy`, not one query per type.
   */
  async observationCountsByType(groupIds: string[], from: Date, to: Date) {
    if (groupIds.length === 0) return [];

    return this.prisma.observation.groupBy({
      by: ["typeId"],
      where: {
        deletedAt: null,
        observedOn: { gte: from, lte: to },
        child: { enrollments: { some: { groupId: { in: groupIds }, deletedAt: null } } },
      },
      _count: { _all: true },
    });
  }

  /** The kindergarten's observation types, in configured order. */
  async listObservationTypes(kindergartenIds: string[]) {
    return this.prisma.observationType.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ kindergartenId: null }, { kindergartenId: { in: kindergartenIds } }],
      },
      select: { id: true, name: true, order: true },
      orderBy: { order: "asc" },
    });
  }

  async activeChildCount(groupIds: string[]): Promise<number> {
    if (groupIds.length === 0) return 0;
    return this.prisma.child.count({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        enrollments: { some: { groupId: { in: groupIds }, status: "ACTIVE", deletedAt: null } },
      },
    });
  }

  /** The current term, so the dashboard knows what "this term" means. */
  async currentTerm(kindergartenIds: string[], on: Date) {
    if (kindergartenIds.length === 0) return null;
    return this.prisma.term.findFirst({
      where: {
        kindergartenId: { in: kindergartenIds },
        deletedAt: null,
        startsOn: { lte: on },
        endsOn: { gte: on },
      },
      orderBy: { startsOn: "desc" },
      include: { schoolYear: { select: { id: true, name: true } } },
    });
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  async kindergartenCounts(kindergartenIds: string[]) {
    if (kindergartenIds.length === 0) {
      return { children: 0, groups: 0, staff: 0, guardians: 0 };
    }

    const [children, groups, staff, guardians] = await Promise.all([
      this.prisma.child.count({
        where: { kindergartenId: { in: kindergartenIds }, deletedAt: null, status: "ACTIVE" },
      }),
      this.prisma.group.count({
        where: { kindergartenId: { in: kindergartenIds }, deletedAt: null, status: "ACTIVE" },
      }),
      this.prisma.membership.count({
        where: {
          kindergartenId: { in: kindergartenIds },
          deletedAt: null,
          isActive: true,
          role: { in: ["TEACHER", "ADMIN"] },
        },
      }),
      this.prisma.membership.count({
        where: {
          kindergartenId: { in: kindergartenIds },
          deletedAt: null,
          isActive: true,
          role: "PARENT",
        },
      }),
    ]);

    return { children, groups, staff, guardians };
  }

  /** Assessment coverage for the current term, per group. */
  async assessmentCoverage(kindergartenIds: string[], termId: string) {
    if (kindergartenIds.length === 0) return [];

    const groups = await this.prisma.group.findMany({
      where: { kindergartenId: { in: kindergartenIds }, deletedAt: null, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        _count: { select: { enrollments: { where: { status: "ACTIVE", deletedAt: null } } } },
      },
      orderBy: { name: "asc" },
      take: 20,
    });

    if (groups.length === 0) return [];

    // One grouped query for every group, rather than one per group.
    const assessed = await this.prisma.assessment.groupBy({
      by: ["enrollmentId"],
      where: {
        termId,
        deletedAt: null,
        enrollment: { groupId: { in: groups.map((g) => g.id) }, status: "ACTIVE", deletedAt: null },
      },
    });

    const enrollments = await this.prisma.enrollment.findMany({
      where: { id: { in: assessed.map((a) => a.enrollmentId) } },
      select: { id: true, groupId: true },
    });

    const perGroup = new Map<string, number>();
    for (const e of enrollments) {
      perGroup.set(e.groupId, (perGroup.get(e.groupId) ?? 0) + 1);
    }

    return groups.map((g) => ({
      groupId: g.id,
      name: g.name,
      children: g._count.enrollments,
      assessed: perGroup.get(g.id) ?? 0,
    }));
  }

  async recentAuditEntries(kindergartenIds: string[], take = 10) {
    if (kindergartenIds.length === 0) return [];
    return this.prisma.auditLog.findMany({
      where: { kindergartenId: { in: kindergartenIds } },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        action: true,
        actorLabel: true,
        objectType: true,
        createdAt: true,
      },
    });
  }

  // ── Parent ────────────────────────────────────────────────────────────────

  /**
   * The parent home feed.
   *
   * Only observations the family may see — the same filter the observations
   * module uses, restated here because a dashboard that builds its own is
   * exactly how a private note reaches a family.
   */
  async recentForGuardian(childIds: string[], guardianUserId: string, take = 10) {
    if (childIds.length === 0) return [];
    return this.prisma.observation.findMany({
      where: {
        childId: { in: childIds },
        deletedAt: null,
        OR: [
          { visibleToParents: true, reviewStatus: "APPROVED" },
          { source: "PARENT", authorId: guardianUserId },
        ],
      },
      orderBy: { observedOn: "desc" },
      take,
      select: {
        id: true,
        observedOn: true,
        situation: true,
        source: true,
        reviewStatus: true,
        child: { select: { id: true, lastName: true, firstName: true } },
        type: { select: { id: true, name: true } },
      },
    });
  }

  /** Published assessments for a child in the current term. */
  async publishedAssessments(childIds: string[], termId: string) {
    if (childIds.length === 0) return [];
    return this.prisma.assessment.findMany({
      where: { childId: { in: childIds }, termId, visibleToParents: true, deletedAt: null },
      select: {
        childId: true,
        domain: { select: { id: true, name: true, color: true } },
        level: { select: { id: true, value: true, label: true, color: true } },
      },
      orderBy: { domain: { order: "asc" } },
    });
  }

  /** Children a guardian may see, for the home screen. */
  async guardianChildren(visible: VisibleChildrenFilter) {
    return this.prisma.child.findMany({
      where: visible,
      select: {
        id: true,
        lastName: true,
        firstName: true,
        dateOfBirth: true,
        photoMediaFileId: true,
        enrollments: {
          where: { status: "ACTIVE", deletedAt: null },
          select: { group: { select: { id: true, name: true } } },
          take: 1,
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 20,
    });
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  async listAudit(
    kindergartenIds: string[],
    filters: {
      childId?: string;
      actorUserId?: string;
      action?: AuditAction;
      from?: Date;
      to?: Date;
    },
    page: { skip: number; take: number },
  ) {
    const where = {
      kindergartenId: { in: kindergartenIds },
      ...(filters.childId ? { childId: filters.childId } : {}),
      ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total };
  }
}
