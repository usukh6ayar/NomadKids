import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toSkipTake, type PageParams } from "../common/pagination";
import type { AttendanceRequestStatus, AttendanceStatus } from "../domain/enums";

/**
 * Attendance records and the guardian requests that precede them.
 *
 * ★ Unlike observations, there is no parent-visibility filter to build here —
 * once `ChildAccessService.assertCanAccess` has let someone through, they may
 * see all of a child's attendance. The distinction this module cares about is
 * who may *write* `Attendance` (staff only) versus `AttendanceRequest`
 * (guardians), not who may read.
 */
@Injectable()
export class AttendanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Attendance ───────────────────────────────────────────────────────────

  async findForChildInRange(childId: string, from: Date, to: Date) {
    return this.prisma.attendance.findMany({
      where: { childId, deletedAt: null, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
      include: { recordedBy: { select: { id: true, lastName: true, firstName: true } } },
    });
  }

  /** Per-status counts for a month — never a collapsed "funding day" figure. */
  async monthlyStatusCounts(
    childId: string,
    from: Date,
    to: Date,
  ): Promise<Record<AttendanceStatus, number>> {
    const rows = await this.prisma.attendance.groupBy({
      by: ["status"],
      where: { childId, deletedAt: null, date: { gte: from, lte: to } },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {
      PRESENT: 0,
      HALF_DAY: 0,
      EXCUSED: 0,
      SICK: 0,
      ABSENT: 0,
    };
    for (const row of rows) counts[row.status] = row._count._all;
    return counts as Record<AttendanceStatus, number>;
  }

  /**
   * The whole group's attendance for one day, plus the roster it should cover.
   * `children` is every currently-enrolled child in the group; `records` is
   * whatever has been marked so far — the caller reconciles the two so an
   * unmarked child shows up as unmarked rather than silently missing.
   */
  async groupDaySheet(groupId: string, date: Date) {
    const [enrollments, records] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { groupId, status: "ACTIVE", deletedAt: null },
        select: {
          id: true,
          childId: true,
          child: { select: { id: true, lastName: true, firstName: true } },
        },
      }),
      this.prisma.attendance.findMany({
        where: { deletedAt: null, date, enrollment: { groupId, deletedAt: null } },
      }),
    ]);

    return { enrollments, records };
  }

  /**
   * Create-or-update, keyed by `(enrollmentId, date)` among *live* rows.
   *
   * ★ Not `prisma.attendance.upsert()`, deliberately.
   *
   * The uniqueness this keys off is a **partial** index — `WHERE "deletedAt"
   * IS NULL` — so that re-recording a day whose row was soft-deleted does not
   * fail on a "duplicate" only the database still remembers (see the doc
   * comment on `model Attendance` in schema.prisma). Postgres's `ON CONFLICT`,
   * which is what `upsert()` compiles to, needs a *plain* unique index or
   * constraint as its arbiter and will not match a partial one — so upsert
   * fails outright on every call once the index is partial, not merely on the
   * re-recording case it was written to fix. A transaction with an explicit
   * find-then-write does not need an arbiter and works with either index
   * shape.
   */
  async upsertForChild(data: RecordAttendanceData) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.attendance.findFirst({
        where: { enrollmentId: data.enrollmentId, date: data.date, deletedAt: null },
      });

      if (existing) {
        return tx.attendance.update({
          where: { id: existing.id },
          data: { status: data.status, note: data.note, recordedById: data.recordedById },
        });
      }

      return tx.attendance.create({ data });
    });
  }

  // ── Attendance requests ──────────────────────────────────────────────────

  async createRequest(data: CreateAttendanceRequestData) {
    return this.prisma.attendanceRequest.create({ data });
  }

  async listRequestsForChild(childId: string) {
    return this.prisma.attendanceRequest.findMany({
      where: { childId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        requestedBy: { select: { id: true, lastName: true, firstName: true } },
        reviewedBy: { select: { id: true, lastName: true, firstName: true } },
      },
    });
  }

  /** Raw row for authorization decisions — no join, no filtering. */
  async findRequestForAuthorization(requestId: string) {
    return this.prisma.attendanceRequest.findFirst({
      where: { id: requestId, deletedAt: null },
      select: {
        id: true,
        childId: true,
        enrollmentId: true,
        kindergartenId: true,
        dateFrom: true,
        dateTo: true,
        requestedStatus: true,
        reviewStatus: true,
      },
    });
  }

  async decideRequest(id: string, reviewStatus: AttendanceRequestStatus, reviewedById: string) {
    return this.prisma.attendanceRequest.update({
      where: { id },
      data: { reviewStatus, reviewedById, reviewedAt: new Date() },
    });
  }

  /** Pending requests across the teacher's own groups — the review queue. */
  async listPendingForGroups(groupIds: string[], page: PageParams) {
    const { skip, take } = toSkipTake(page);
    if (groupIds.length === 0) return { items: [], total: 0 };

    const where = {
      deletedAt: null,
      reviewStatus: "PENDING" as AttendanceRequestStatus,
      enrollment: { groupId: { in: groupIds }, deletedAt: null },
    };

    const [items, total] = await Promise.all([
      this.prisma.attendanceRequest.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip,
        take,
        include: {
          child: { select: { id: true, lastName: true, firstName: true } },
          requestedBy: { select: { id: true, lastName: true, firstName: true } },
        },
      }),
      this.prisma.attendanceRequest.count({ where }),
    ]);

    return { items, total };
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /** Mirrors `AssessmentRepository.findGroupForAssessment` exactly. */
  async findGroup(groupId: string, kindergartenIds: string[]) {
    return this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null, kindergartenId: { in: kindergartenIds } },
      select: { id: true, kindergartenId: true },
    });
  }

  /** The child's active enrollment — attendance is pinned to it. */
  async activeEnrollment(childId: string) {
    return this.prisma.enrollment.findFirst({
      where: { childId, status: "ACTIVE", deletedAt: null },
      orderBy: { startedOn: "desc" },
      select: { id: true, kindergartenId: true, groupId: true },
    });
  }
}

export interface RecordAttendanceData {
  kindergartenId: string;
  childId: string;
  enrollmentId: string;
  date: Date;
  status: AttendanceStatus;
  note: string | null;
  recordedById: string;
}

export interface CreateAttendanceRequestData {
  kindergartenId: string;
  childId: string;
  enrollmentId: string;
  requestedById: string;
  dateFrom: Date;
  dateTo: Date;
  requestedStatus: AttendanceStatus;
  reason: string | null;
}
