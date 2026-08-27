import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Safety incidents — RFP Module 2.1.
 *
 * ★ No visibility filter and no review state, unlike observations.
 *
 * An incident is not a draft opinion a teacher refines: it happened, and a
 * family is entitled to it. What varies is whether they have been *told* yet
 * (`reportedAt`), which is a workflow state rather than a permission — and the
 * unreported queue is the reason it exists.
 */
@Injectable()
export class IncidentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly detail = {
    recordedBy: { select: { id: true, lastName: true, firstName: true } },
    child: { select: { id: true, lastName: true, firstName: true } },
    media: {
      where: { deletedAt: null },
      orderBy: { order: "asc" as const },
      select: { id: true, caption: true, order: true, originalName: true },
    },
  };

  async listForChild(childId: string) {
    return this.prisma.safetyIncident.findMany({
      where: { childId, deletedAt: null },
      orderBy: { occurredAt: "desc" },
      include: this.detail,
    });
  }

  /**
   * The kindergarten's log, newest first — and the unreported queue.
   *
   * ★ Paginated even though a kindergarten hopes to have few: CLAUDE.md §3.4
   * admits no exceptions, and the one year this list is long is the year
   * somebody most needs to read it.
   */
  async listForKindergarten(
    kindergartenId: string,
    filters: { unreportedOnly?: boolean; highPriorityOnly?: boolean },
    page: { skip: number; take: number },
  ) {
    const where = {
      kindergartenId,
      deletedAt: null,
      ...(filters.unreportedOnly ? { reportedAt: null } : {}),
      ...(filters.highPriorityOnly ? { isHighPriority: true } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.safetyIncident.findMany({
        where,
        // High priority first within the same recency — the queue's whole
        // purpose is that the serious ones are read first.
        orderBy: [{ isHighPriority: "desc" }, { occurredAt: "desc" }],
        skip: page.skip,
        take: page.take,
        include: this.detail,
      }),
      this.prisma.safetyIncident.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string) {
    return this.prisma.safetyIncident.findFirst({
      where: { id, deletedAt: null },
      include: this.detail,
    });
  }

  async findForAuthorization(id: string) {
    return this.prisma.safetyIncident.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        childId: true,
        kindergartenId: true,
        reportedAt: true,
        notificationId: true,
      },
    });
  }

  async create(data: Record<string, unknown>) {
    return this.prisma.safetyIncident.create({ data: data as never, include: this.detail });
  }

  async update(id: string, data: Record<string, unknown>) {
    return this.prisma.safetyIncident.update({ where: { id }, data, include: this.detail });
  }

  /** Links the notice that told the family, and stamps when. */
  async markReported(id: string, notificationId: string, reportedAt: Date) {
    return this.prisma.safetyIncident.update({
      where: { id },
      data: { notificationId, reportedAt },
      include: this.detail,
    });
  }

  async softDelete(id: string) {
    return this.prisma.safetyIncident.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** How many incidents are still waiting to be reported — the badge count. */
  async countUnreported(kindergartenIds: string[]) {
    if (kindergartenIds.length === 0) return 0;
    return this.prisma.safetyIncident.count({
      where: { kindergartenId: { in: kindergartenIds }, deletedAt: null, reportedAt: null },
    });
  }
}
