import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Growth measurements — RFP §7.
 *
 * ★ No parent-visibility filter, deliberately.
 *
 * A child's height is not a teacher's private note: RFP §2.3 lists "хүүхдийн
 * өндөр, жингийн график харах" among what a guardian may do, and §2.3 also lets
 * them record one. Once `ChildAccessService` has let someone through, they see
 * the whole series. What differs between roles is nothing here — which is why
 * this repository has one read path and not two.
 */
@Injectable()
export class GrowthRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly recorder = {
    select: { id: true, lastName: true, firstName: true },
  };

  /**
   * A child's series, oldest first.
   *
   * ★ Ascending, unlike every other list in this system.
   *
   * The index is `(childId, measuredOn desc)` because a descending scan is what
   * "the latest measurement" needs, but a chart is drawn left to right in time
   * and a caller that has to reverse an array before plotting it will
   * eventually forget. Postgres reads a b-tree backwards at the same cost, so
   * this is free.
   *
   * Unbounded by date range rather than paginated: a child's whole history is
   * at most one row per school day over four years, and a chart with a "next
   * page" is not a chart. CLAUDE.md §3.4 asks that no endpoint return an
   * unbounded set — this one is bounded by the partial unique index, which
   * allows exactly one row per child per day.
   */
  async listForChild(childId: string, from?: Date, to?: Date) {
    return this.prisma.growthMeasurement.findMany({
      where: {
        childId,
        deletedAt: null,
        ...(from || to
          ? { measuredOn: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      orderBy: { measuredOn: "asc" },
      include: { recordedBy: this.recorder },
    });
  }

  async findOnDate(childId: string, measuredOn: Date) {
    return this.prisma.growthMeasurement.findFirst({
      where: { childId, measuredOn, deletedAt: null },
    });
  }

  /**
   * Create-or-update for one child on one day.
   *
   * ★ Not `upsert()`, for the same reason `Attendance.record` is not.
   *
   * The unique index is **partial** — `WHERE "deletedAt" IS NULL` — and Prisma's
   * `upsert` targets the full constraint, so it cannot see that a soft-deleted
   * row does not occupy the day. Finding the live row first and branching is the
   * only shape that agrees with the index.
   */
  async record(input: {
    childId: string;
    kindergartenId: string;
    measuredOn: Date;
    heightCm: number | null;
    weightKg: number | null;
    headCircumferenceCm: number | null;
    note: string | null;
    recordedById: string;
  }) {
    const existing = await this.findOnDate(input.childId, input.measuredOn);

    const data = {
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      headCircumferenceCm: input.headCircumferenceCm,
      note: input.note,
      recordedById: input.recordedById,
    };

    if (existing) {
      return this.prisma.growthMeasurement.update({
        where: { id: existing.id },
        data,
        include: { recordedBy: this.recorder },
      });
    }

    return this.prisma.growthMeasurement.create({
      data: {
        childId: input.childId,
        kindergartenId: input.kindergartenId,
        measuredOn: input.measuredOn,
        ...data,
      },
      include: { recordedBy: this.recorder },
    });
  }

  async softDelete(id: string) {
    return this.prisma.growthMeasurement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** One measurement, for the authorization check behind a delete. */
  async findById(id: string) {
    return this.prisma.growthMeasurement.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, childId: true, kindergartenId: true },
    });
  }

  /** The child's sex and birth date — what the reference band needs. */
  async findChildFacts(childId: string) {
    return this.prisma.child.findFirst({
      where: { id: childId, deletedAt: null },
      select: { id: true, sex: true, dateOfBirth: true },
    });
  }
}
