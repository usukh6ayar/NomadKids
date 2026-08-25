import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Milestones — RFP §4.5.
 *
 * ★ No visibility filter, and no review state.
 *
 * A milestone is a family's memory, not a teacher's professional record. There
 * is nothing here for a review queue to hold back, which is the whole reason
 * this is its own table rather than an `Observation` with a special type — see
 * the doc comment on `model Milestone`.
 */
@Injectable()
export class MilestonesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly detail = {
    recordedBy: { select: { id: true, lastName: true, firstName: true } },
    media: {
      where: { deletedAt: null },
      orderBy: { order: "asc" as const },
      select: { id: true, caption: true, order: true, originalName: true },
    },
  };

  /**
   * A child's timeline, newest first.
   *
   * Bounded by the child rather than paginated: RFP §4.5 is a list of firsts,
   * and a family accumulates a handful over four years. The index
   * `(childId, occurredOn desc)` serves this exactly.
   */
  async listForChild(childId: string) {
    return this.prisma.milestone.findMany({
      where: { childId, deletedAt: null },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
      include: this.detail,
    });
  }

  async findById(id: string) {
    return this.prisma.milestone.findFirst({
      where: { id, deletedAt: null },
      include: this.detail,
    });
  }

  /** The authorization anchor — which child and tenant this milestone belongs to. */
  async findForAuthorization(id: string) {
    return this.prisma.milestone.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, childId: true, kindergartenId: true, recordedById: true },
    });
  }

  async create(data: {
    childId: string;
    kindergartenId: string;
    kind: string;
    title: string | null;
    occurredOn: Date;
    description: string | null;
    recordedById: string;
  }) {
    return this.prisma.milestone.create({ data, include: this.detail });
  }

  async update(id: string, data: Record<string, unknown>) {
    return this.prisma.milestone.update({ where: { id }, data, include: this.detail });
  }

  async softDelete(id: string) {
    return this.prisma.milestone.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async countForChild(childId: string) {
    return this.prisma.milestone.count({ where: { childId, deletedAt: null } });
  }
}
