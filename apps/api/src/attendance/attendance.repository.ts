import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toSkipTake, type PageParams } from "../common/pagination";
import type { Prisma } from "../generated/prisma/client";
import type {
  AgeBand,
  AttendanceCompanion,
  AttendanceForm,
  AttendanceRequestStatus,
  AttendanceStatus,
  ChildStatus,
  ProgramKind,
} from "../domain/enums";

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
   * One group's month, aggregated three ways for the register's own panel.
   *
   * ★ Three grouped queries, not a page of rows the service counts.
   *
   * A group of twenty over a twenty-two-day month is 440 attendance rows, and
   * the screen wants none of them — it wants the shape. Fetching the rows to
   * count them in JavaScript would ship half a megabyte to draw six numbers,
   * and it is the reading `docs/DATABASE.md` §N+1 exists to prevent.
   *
   * `byDate` and `byStatus` cannot be one query with two groupings, and
   * `byChild` is keyed on `enrollmentId` because `groupBy` cannot group by a
   * relation's column — the same constraint `dashboard.repository.ts` records
   * against `attendanceByGroup`, resolved the same way: the ids are mapped back
   * over a set the roster already bounds.
   */
  async groupMonthSummary(groupId: string, from: Date, to: Date) {
    const where = {
      deletedAt: null,
      date: { gte: from, lte: to },
      enrollment: { groupId, deletedAt: null },
    };

    const [byDate, byStatus, byEnrollment, roster] = await Promise.all([
      this.prisma.attendance.groupBy({
        by: ["date", "status"],
        where,
        _count: { _all: true },
        orderBy: { date: "asc" },
      }),
      this.prisma.attendance.groupBy({ by: ["status"], where, _count: { _all: true } }),
      this.prisma.attendance.groupBy({
        by: ["enrollmentId", "status"],
        where,
        _count: { _all: true },
      }),
      /*
       * The roster is *currently* enrolled, which is deliberately not "who has
       * a row this month". A child who left mid-month should not make the
       * group look under-recorded for every day since, and one who joined last
       * week is part of what the teacher is looking at today.
       */
      this.prisma.enrollment.findMany({
        where: { groupId, status: "ACTIVE", deletedAt: null },
        select: {
          id: true,
          child: { select: { id: true, lastName: true, firstName: true } },
        },
      }),
    ]);

    return { byDate, byStatus, byEnrollment, roster };
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
  /**
   * The kindergarten-wide register — every enrolment that matches the filters,
   * and every attendance row inside the date range for those enrolments.
   *
   * ★ **Two queries, whatever the shape of the answer.** 300 children over a
   * quarter is 27,600 cells; a query per child, or per day, is the N+1
   * CLAUDE.md §3.4 forbids, in the place it hurts most — a director waiting on
   * a screen while the database does thousands of round trips. The service
   * pivots these two flat lists into the grid.
   *
   * ★★ The status filter is applied to the **records**, not to the children.
   * Filtering by `SICK` must not drop a child from the register; it leaves
   * them in with only their sick days filled in, because "who was sick, and
   * when" is the question, and a child with no sick days is part of that
   * answer.
   */
  async registerRows(
    kindergartenId: string,
    filters: {
      from: Date;
      to: Date;
      groupIds?: string[];
      ageBands?: AgeBand[];
      programKind?: ProgramKind;
      attendanceForm?: AttendanceForm;
      statuses?: AttendanceStatus[];
      q?: string;
      childStatuses?: ChildStatus[];
    },
  ) {
    const groupWhere: Prisma.GroupWhereInput = {
      deletedAt: null,
      ...(filters.ageBands?.length ? { ageBand: { in: filters.ageBands } } : {}),
      ...(filters.programKind ? { programKind: filters.programKind } : {}),
      ...(filters.attendanceForm ? { attendanceForm: filters.attendanceForm } : {}),
    };

    const enrollmentWhere: Prisma.EnrollmentWhereInput = {
      kindergartenId,
      deletedAt: null,
      status: "ACTIVE",
      ...(filters.groupIds?.length ? { groupId: { in: filters.groupIds } } : {}),
      group: groupWhere,
      child: {
        deletedAt: null,
        ...(filters.childStatuses?.length ? { status: { in: filters.childStatuses } } : {}),
        ...(filters.q
          ? {
              OR: [
                { firstName: { contains: filters.q, mode: "insensitive" as const } },
                { lastName: { contains: filters.q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
    };

    const enrollments = await this.prisma.enrollment.findMany({
      where: enrollmentWhere,
      select: {
        id: true,
        childId: true,
        child: { select: { id: true, lastName: true, firstName: true, status: true } },
        group: {
          select: { id: true, name: true, ageBand: true, programKind: true, attendanceForm: true },
        },
      },
      orderBy: [{ group: { name: "asc" } }, { child: { lastName: "asc" } }],
    });

    if (enrollments.length === 0) return { enrollments, records: [] };

    const records = await this.prisma.attendance.findMany({
      where: {
        kindergartenId,
        deletedAt: null,
        date: { gte: filters.from, lte: filters.to },
        enrollmentId: { in: enrollments.map((e) => e.id) },
        ...(filters.statuses?.length ? { status: { in: filters.statuses } } : {}),
      },
      select: { enrollmentId: true, date: true, status: true, note: true },
    });

    return { enrollments, records };
  }

  async upsertForChild(data: RecordAttendanceData) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.attendance.findFirst({
        where: { enrollmentId: data.enrollmentId, date: data.date, deletedAt: null },
      });

      if (existing) {
        return tx.attendance.update({
          where: { id: existing.id },
          data: {
            status: data.status,
            note: data.note,
            recordedById: data.recordedById,
            // ★ Only overwritten when the caller actually sent one — a plain
            // `{ status: "ABSENT" }` call (the group day-sheet, most of
            // `TodayRecorder`'s buttons) must not erase a drop-off already
            // recorded earlier the same day. Same guard for pickup: an
            // approved arrival claim (`reviewRequest`) must not blank out a
            // pickup a later approval, or staff's own `PATCH .../pickup`,
            // already wrote.
            ...(data.arrivedWith !== undefined ? { arrivedWith: data.arrivedWith } : {}),
            ...(data.arrivedWithName !== undefined
              ? { arrivedWithName: data.arrivedWithName }
              : {}),
            ...(data.arrivedAt !== undefined ? { arrivedAt: data.arrivedAt } : {}),
            ...(data.pickedUpWith !== undefined ? { pickedUpWith: data.pickedUpWith } : {}),
            ...(data.pickedUpWithName !== undefined
              ? { pickedUpWithName: data.pickedUpWithName }
              : {}),
            ...(data.pickedUpAt !== undefined ? { pickedUpAt: data.pickedUpAt } : {}),
          },
        });
      }

      return tx.attendance.create({ data });
    });
  }

  /**
   * Pickup, independent of `upsertForChild` — a child must already have a
   * record for the day (you cannot pick up who was never checked in), so
   * this updates rather than creates, and returns `null` when there is
   * nothing to update. Whether `null` is a 404 is the service's call, not
   * this layer's.
   */
  async recordPickup(
    enrollmentId: string,
    date: Date,
    data: { pickedUpWith: AttendanceCompanion; pickedUpWithName: string | null; pickedUpAt: Date },
  ) {
    const existing = await this.prisma.attendance.findFirst({
      where: { enrollmentId, date, deletedAt: null },
    });
    if (!existing) return null;

    return this.prisma.attendance.update({
      where: { id: existing.id },
      data: {
        pickedUpWith: data.pickedUpWith,
        pickedUpWithName: data.pickedUpWithName,
        pickedUpAt: data.pickedUpAt,
      },
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
        arrivedWith: true,
        arrivedWithName: true,
        arrivedAt: true,
        pickedUpWith: true,
        pickedUpWithName: true,
        pickedUpAt: true,
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
  arrivedWith?: AttendanceCompanion | null;
  arrivedWithName?: string | null;
  arrivedAt?: Date | null;
  pickedUpWith?: AttendanceCompanion | null;
  pickedUpWithName?: string | null;
  pickedUpAt?: Date | null;
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
  arrivedWith?: AttendanceCompanion | null;
  arrivedWithName?: string | null;
  arrivedAt?: Date | null;
  pickedUpWith?: AttendanceCompanion | null;
  pickedUpWithName?: string | null;
  pickedUpAt?: Date | null;
}
