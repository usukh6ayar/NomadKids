import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toSkipTake, type PageParams } from "../common/pagination";
import type { ObservationSource, ReviewStatus } from "../domain/enums";
import { searchWhere } from "../common/repository/search";

/**
 * Observations and their development-domain links.
 *
 * ★ `readableWhere` is the parent visibility filter and the single most
 * security-sensitive query in this module. It is built here, once, and every
 * read path composes it — a list endpoint and a detail endpoint that build
 * their own filters is exactly how a private teaching note reaches a family.
 */
@Injectable()
export class ObservationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What this actor may read about this child.
   *
   * A guardian sees an observation only when it is **approved and marked
   * visible** — or when it is their own submission, whatever its state.
   *
   * The second clause is not a convenience. Without it a parent's note would
   * vanish the moment they saved it and reappear only after a teacher acted,
   * and they could not tell whether it had saved at all.
   *
   * Staff see everything about children they may reach; the child-level check
   * has already happened in `ChildAccessService`.
   */
  readableWhere(childId: string, viewer: { isGuardian: boolean; userId: string }) {
    if (!viewer.isGuardian) return { childId, deletedAt: null };

    return {
      childId,
      deletedAt: null,
      OR: [
        { visibleToParents: true, reviewStatus: "APPROVED" as ReviewStatus },
        { source: "PARENT" as ObservationSource, authorId: viewer.userId },
      ],
    };
  }

  async list(
    childId: string,
    viewer: { isGuardian: boolean; userId: string },
    filters: ObservationFilters,
    page: PageParams,
  ) {
    const { skip, take } = toSkipTake(page);

    const where = {
      AND: [
        this.readableWhere(childId, viewer),
        {
          ...(filters.typeId ? { typeId: filters.typeId } : {}),
          ...(filters.source ? { source: filters.source } : {}),
          ...(filters.reviewStatus ? { reviewStatus: filters.reviewStatus } : {}),
          ...(filters.from || filters.to
            ? {
                observedOn: {
                  ...(filters.from ? { gte: filters.from } : {}),
                  ...(filters.to ? { lte: filters.to } : {}),
                },
              }
            : {}),
          ...(filters.domainId ? { domains: { some: { domainId: filters.domainId } } } : {}),
          /*
           * ★ Every narrative field, not just one.
           *
           * An observation's text is spread across six optional columns
           * because the form asks six questions; a reader remembers what was
           * written, not which box it went in.
           */
          ...(searchWhere(filters.q, [
            "activityName",
            "situation",
            "childDid",
            "childSaid",
            "teacherComment",
            "nextSteps",
          ]) ?? {}),
        },
      ],
    };

    const [items, total] = await Promise.all([
      this.prisma.observation.findMany({
        where,
        orderBy: { observedOn: "desc" },
        skip,
        take,
        include: {
          type: { select: { id: true, name: true, code: true } },
          author: { select: { id: true, lastName: true, firstName: true } },
          domains: {
            include: {
              domain: { select: { id: true, name: true, color: true } },
              level: { select: { id: true, value: true, label: true } },
            },
          },
          media: {
            where: { deletedAt: null, status: "READY" },
            select: { id: true, caption: true, order: true },
            orderBy: { order: "asc" },
          },
        },
      }),
      this.prisma.observation.count({ where }),
    ]);

    return { items, total };
  }

  /** One observation, subject to the same visibility filter as the list. */
  async findReadable(
    observationId: string,
    childId: string,
    viewer: { isGuardian: boolean; userId: string },
  ) {
    return this.prisma.observation.findFirst({
      where: { AND: [this.readableWhere(childId, viewer), { id: observationId }] },
      include: {
        type: { select: { id: true, name: true, code: true } },
        author: { select: { id: true, lastName: true, firstName: true } },
        reviewedBy: { select: { id: true, lastName: true, firstName: true } },
        domains: {
          include: {
            domain: { select: { id: true, name: true, color: true } },
            level: { select: { id: true, value: true, label: true } },
          },
        },
        media: {
          where: { deletedAt: null, status: "READY" },
          select: { id: true, caption: true, order: true, originalName: true },
          orderBy: { order: "asc" },
        },
      },
    });
  }

  /** Raw row for authorization decisions — no visibility filter applied. */
  async findForAuthorization(observationId: string) {
    return this.prisma.observation.findFirst({
      where: { id: observationId, deletedAt: null },
      select: {
        id: true,
        childId: true,
        kindergartenId: true,
        authorId: true,
        source: true,
        reviewStatus: true,
      },
    });
  }

  async create(data: CreateObservationData, domainIds: string[]) {
    return this.prisma.$transaction(async (tx) => {
      const observation = await tx.observation.create({ data });

      if (domainIds.length > 0) {
        await tx.observationDomain.createMany({
          data: domainIds.map((domainId) => ({
            kindergartenId: data.kindergartenId,
            observationId: observation.id,
            domainId,
          })),
        });
      }

      return observation;
    });
  }

  async update(id: string, data: Record<string, unknown>, domainIds?: string[]) {
    return this.prisma.$transaction(async (tx) => {
      const observation = await tx.observation.update({ where: { id }, data });

      // Replace rather than merge: the form sends the complete set, so a
      // removed domain must disappear.
      if (domainIds) {
        await tx.observationDomain.deleteMany({ where: { observationId: id } });
        if (domainIds.length > 0) {
          await tx.observationDomain.createMany({
            data: domainIds.map((domainId) => ({
              kindergartenId: observation.kindergartenId,
              observationId: id,
              domainId,
            })),
          });
        }
      }

      return observation;
    });
  }

  async softDelete(id: string) {
    return this.prisma.observation.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** The review queue: parent submissions awaiting a teacher, in their groups. */
  async listPendingForGroups(groupIds: string[], page: PageParams) {
    const { skip, take } = toSkipTake(page);
    if (groupIds.length === 0) return { items: [], total: 0 };

    const where = {
      deletedAt: null,
      source: "PARENT" as ObservationSource,
      reviewStatus: "PENDING" as ReviewStatus,
      enrollment: { groupId: { in: groupIds }, deletedAt: null },
    };

    const [items, total] = await Promise.all([
      this.prisma.observation.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip,
        take,
        include: {
          child: { select: { id: true, lastName: true, firstName: true } },
          author: { select: { id: true, lastName: true, firstName: true } },
          type: { select: { id: true, name: true } },
        },
      }),
      this.prisma.observation.count({ where }),
    ]);

    return { items, total };
  }

  /** The child's active enrollment — an observation is pinned to it. */
  async activeEnrollment(childId: string) {
    return this.prisma.enrollment.findFirst({
      where: { childId, status: "ACTIVE", deletedAt: null },
      orderBy: { startedOn: "desc" },
      select: { id: true, kindergartenId: true, groupId: true },
    });
  }

  /** Most recent enrollment of any status — the fallback for an archived child. */
  async latestEnrollment(childId: string) {
    return this.prisma.enrollment.findFirst({
      where: { childId, deletedAt: null },
      orderBy: { startedOn: "desc" },
      select: { id: true, kindergartenId: true, groupId: true },
    });
  }

  /** Observation types available to a kindergarten: its own plus system rows. */
  async listTypes(kindergartenId: string) {
    return this.prisma.observationType.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ kindergartenId }, { kindergartenId: null }],
      },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
  }

  async findType(typeId: string, kindergartenId: string) {
    return this.prisma.observationType.findFirst({
      where: {
        id: typeId,
        deletedAt: null,
        OR: [{ kindergartenId }, { kindergartenId: null }],
      },
    });
  }

  /** Validates domain ids belong to this kindergarten or are system rows. */
  async countValidDomains(domainIds: string[], kindergartenId: string): Promise<number> {
    if (domainIds.length === 0) return 0;
    return this.prisma.developmentDomain.count({
      where: {
        id: { in: domainIds },
        deletedAt: null,
        OR: [{ kindergartenId }, { kindergartenId: null }],
      },
    });
  }

  /**
   * The group, if this actor's kindergartens contain it.
   *
   * Scoped by `kindergartenId in […]` rather than fetched then checked: an id
   * from another tenant returns null here and becomes a 404 in the service,
   * which is one place the tenant filter can be forgotten instead of two.
   */
  async findGroupForStats(groupId: string, kindergartenIds: string[]) {
    return this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null, kindergartenId: { in: kindergartenIds } },
      select: { id: true, kindergartenId: true, name: true },
    });
  }

  /** The configured learning areas, so a domain with no notes still gets a row. */
  async listDomainsForStats(kindergartenId: string) {
    return this.prisma.developmentDomain.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ kindergartenId }, { kindergartenId: null }],
      },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    });
  }

  /**
   * The raw material for a group's coverage dashboard.
   *
   * ★ Aggregated in SQL, not fetched and counted in the browser.
   *
   * A group's year of notes is not bounded — twenty children with a note each
   * per week is roughly eight hundred rows — so a client-side tally would need
   * an unpaginated list endpoint, which §3.4 forbids for exactly this reason.
   * `groupBy` returns one row per bucket instead: six queries whose result sets
   * are the size of the answer rather than the size of the data.
   *
   * ★★ Scoped by `enrollment.groupId`, not by the child's current group.
   *
   * A child who moved from Дэлбээ to Цэцэг in January took their notes with
   * them if the scope reads `Child`; reading the enrolment the note was written
   * under keeps each note in the group it was actually made in, which is what a
   * teacher looking at *their* group's coverage is asking about.
   */
  async groupObservationStats(groupId: string, from: Date, to: Date) {
    const window = {
      deletedAt: null,
      enrollment: { groupId },
      observedOn: { gte: from, lte: to },
    };

    const [byType, byDomain, byActivity, byChild, byChildType, distinctChildren, total, enrolled] =
      await Promise.all([
        this.prisma.observation.groupBy({
          by: ["typeId"],
          where: window,
          _count: { _all: true },
        }),
        this.prisma.observationDomain.groupBy({
          by: ["domainId"],
          where: { deletedAt: null, observation: window },
          _count: { _all: true },
        }),
        this.prisma.observation.groupBy({
          by: ["activityName"],
          where: { ...window, activityName: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { activityName: "desc" } },
          take: 12,
        }),
        this.prisma.observation.groupBy({
          by: ["childId"],
          where: window,
          _count: { _all: true },
        }),
        this.prisma.observation.groupBy({
          by: ["childId", "typeId"],
          where: window,
          _count: { _all: true },
        }),
        /*
        "How many *different* children were written about" — the client's
        Зорилт. `distinct` on the row rather than a `groupBy` count, because the
        question is the size of the set, not the shape of it.
      */
        this.prisma.observation.findMany({
          where: window,
          select: { childId: true },
          distinct: ["childId"],
        }),
        this.prisma.observation.count({ where: window }),
        this.prisma.enrollment.count({
          where: { groupId, status: "ACTIVE", deletedAt: null },
        }),
      ]);

    return {
      byType,
      byDomain,
      byActivity,
      byChild,
      byChildType,
      childrenWithNotes: distinctChildren.length,
      total,
      enrolled,
    };
  }

  /**
   * Notes per calendar month across a window — the "Сарын тэмдэглэлийн хамралт"
   * chart.
   *
   * ★ Raw SQL, and it is the one place in this file that needs to be.
   *
   * Prisma's `groupBy` can only group by a column, and the bucket here is an
   * *expression* over one (`date_trunc`). The alternatives are twelve counts in
   * a loop — the N+1 §3.4 forbids — or fetching every row to bucket in memory,
   * which is the unbounded read this whole method exists to avoid.
   *
   * `groupId`, `from` and `to` are bound parameters via the tagged template, so
   * this is not string interpolation and carries no injection surface.
   */
  async observationsByMonth(
    groupId: string,
    from: Date,
    to: Date,
  ): Promise<{ month: string; count: number; childrenCount: number }[]> {
    const rows = await this.prisma.$queryRaw<
      { month: Date; count: bigint; childrenCount: bigint }[]
    >`
      SELECT date_trunc('month', o."observedOn")::date AS month,
             COUNT(*) AS count,
             COUNT(DISTINCT o."childId") AS "childrenCount"
      FROM observations o
      JOIN enrollments e ON e.id = o."enrollmentId"
      WHERE e."groupId" = ${groupId}::uuid
        AND o."deletedAt" IS NULL
        AND o."observedOn" >= ${from}
        AND o."observedOn" <= ${to}
      GROUP BY 1
      ORDER BY 1
    `;

    // `COUNT(*)` comes back as bigint, which `JSON.stringify` throws on.
    return rows.map((row) => ({
      month: row.month.toISOString().slice(0, 7),
      count: Number(row.count),
      childrenCount: Number(row.childrenCount),
    }));
  }
}

export interface ObservationFilters {
  typeId?: string;
  source?: ObservationSource;
  reviewStatus?: ReviewStatus;
  domainId?: string;
  from?: Date;
  to?: Date;
  q?: string;
}

export interface CreateObservationData {
  kindergartenId: string;
  childId: string;
  enrollmentId: string;
  typeId: string;
  authorId: string;
  source: ObservationSource;
  observedOn: Date;
  visibleToParents: boolean;
  includeInReport: boolean;
  reviewStatus: ReviewStatus;
  activityName?: string | null;
  situation?: string | null;
  childDid?: string | null;
  childSaid?: string | null;
  teacherComment?: string | null;
  nextSteps?: string | null;
}
