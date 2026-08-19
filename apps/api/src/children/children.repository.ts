import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toSkipTake, type PageParams } from "../common/pagination";
import type { VisibleChildrenFilter } from "../authz/authz.repository";
import type { ChildStatus, EnrollmentStatus, GuardianRelation, Sex } from "../domain/enums";

/**
 * Children, guardianships and enrollment history.
 *
 * ★ `listChildren` takes a `VisibleChildrenFilter` built by `AuthzRepository`
 * rather than a plain kindergarten scope. Children are not reachable by tenant
 * alone: a parent sees their own children, a teacher sees their groups', an
 * admin sees their kindergartens'. Handing the repository a prebuilt filter
 * keeps that one definition in one place — and `test/authz-consistency.test.ts`
 * holds it identical to the detail path.
 */
@Injectable()
export class ChildrenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listChildren(visible: VisibleChildrenFilter, filters: ChildFilters, page: PageParams) {
    const { skip, take } = toSkipTake(page);

    const where = {
      AND: [
        visible,
        {
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.q
            ? {
                OR: [
                  { lastName: { contains: filters.q, mode: "insensitive" as const } },
                  { firstName: { contains: filters.q, mode: "insensitive" as const } },
                ],
              }
            : {}),
          // Group and school-year filters go through enrollments, so a child
          // who has moved group still matches the group they are in *now*.
          ...(filters.groupId || filters.schoolYearId
            ? {
                enrollments: {
                  some: {
                    deletedAt: null,
                    ...(filters.groupId ? { groupId: filters.groupId } : {}),
                    ...(filters.schoolYearId ? { schoolYearId: filters.schoolYearId } : {}),
                    ...(filters.enrollmentStatus ? { status: filters.enrollmentStatus } : {}),
                  },
                },
              }
            : {}),
        },
      ],
    };

    const [items, total] = await Promise.all([
      this.prisma.child.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip,
        take,
        select: {
          id: true,
          lastName: true,
          firstName: true,
          sex: true,
          dateOfBirth: true,
          status: true,
          photoMediaFileId: true,
          enrollments: {
            where: { status: "ACTIVE", deletedAt: null },
            select: {
              id: true,
              group: { select: { id: true, name: true, ageBand: true } },
              schoolYear: { select: { id: true, name: true } },
            },
            take: 1,
          },
        },
      }),
      this.prisma.child.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Full child detail.
   *
   * Authorization has already happened in `ChildAccessService`, so this takes
   * a plain id — but it still filters `deletedAt: null`, because a soft-deleted
   * child must be invisible even to someone who could otherwise reach them.
   */
  async findChild(id: string) {
    return this.prisma.child.findFirst({
      where: { id, deletedAt: null },
      include: {
        kindergarten: { select: { id: true, name: true } },
        guardianships: {
          where: { deletedAt: null },
          include: {
            guardian: {
              select: { id: true, lastName: true, firstName: true, phone: true, email: true },
            },
          },
        },
        enrollments: {
          where: { deletedAt: null },
          orderBy: { startedOn: "desc" },
          include: {
            group: { select: { id: true, name: true, ageBand: true } },
            schoolYear: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  async createChild(data: CreateChildData) {
    return this.prisma.child.create({ data });
  }

  async updateChild(id: string, data: UpdateChildData) {
    return this.prisma.child.update({ where: { id }, data });
  }

  async softDeleteChild(id: string) {
    return this.prisma.child.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async findByNationalId(kindergartenId: string, nationalId: string) {
    return this.prisma.child.findFirst({
      where: { kindergartenId, nationalId, deletedAt: null },
      select: { id: true },
    });
  }

  // ── Guardianships ─────────────────────────────────────────────────────────

  async findGuardianship(id: string) {
    return this.prisma.guardianship.findFirst({
      where: { id, deletedAt: null },
      include: { child: { select: { id: true, kindergartenId: true } } },
    });
  }

  async findGuardianshipFor(childId: string, guardianUserId: string) {
    return this.prisma.guardianship.findFirst({
      where: { childId, guardianUserId, deletedAt: null },
    });
  }

  async createGuardianship(data: {
    kindergartenId: string;
    childId: string;
    guardianUserId: string;
    relation: GuardianRelation;
    isPrimary: boolean;
  }) {
    return this.prisma.guardianship.create({ data });
  }

  async updateGuardianship(
    id: string,
    data: { relation?: GuardianRelation; isPrimary?: boolean; canView?: boolean },
  ) {
    return this.prisma.guardianship.update({ where: { id }, data });
  }

  /** Lists a guardian's children — the parent's own view. */
  async listChildrenForGuardian(guardianUserId: string) {
    return this.prisma.child.findMany({
      where: {
        deletedAt: null,
        guardianships: { some: { guardianUserId, canView: true, deletedAt: null } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        lastName: true,
        firstName: true,
        dateOfBirth: true,
        photoMediaFileId: true,
      },
    });
  }

  // ── Enrollment ────────────────────────────────────────────────────────────

  async findEnrollment(id: string) {
    return this.prisma.enrollment.findFirst({
      where: { id, deletedAt: null },
      include: { child: { select: { id: true, kindergartenId: true } } },
    });
  }

  async listEnrollments(childId: string) {
    return this.prisma.enrollment.findMany({
      where: { childId, deletedAt: null },
      orderBy: { startedOn: "desc" },
      include: {
        group: { select: { id: true, name: true, ageBand: true } },
        schoolYear: { select: { id: true, name: true } },
        kindergarten: { select: { id: true, name: true } },
      },
    });
  }

  async findActiveEnrollment(childId: string, schoolYearId: string) {
    return this.prisma.enrollment.findFirst({
      where: { childId, schoolYearId, status: "ACTIVE", deletedAt: null },
    });
  }

  /**
   * Enrolls a child, ending any active enrollment for the same school year.
   *
   * ★ One transaction, and the order is forced by the database: a partial
   * unique index allows one ACTIVE enrollment per child per school year, so the
   * previous row must be ended before the new one is inserted. Doing it the
   * other way round fails on the insert and leaves the old enrollment intact —
   * a transfer that silently did nothing.
   *
   * The old row is **ended, never deleted**. It is the history that
   * authorization reads, and it is what keeps the previous teacher's own
   * observations reachable after the child moves.
   */
  async enrollChild(data: {
    kindergartenId: string;
    childId: string;
    groupId: string;
    schoolYearId: string;
    startedOn: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.enrollment.findFirst({
        where: {
          childId: data.childId,
          schoolYearId: data.schoolYearId,
          status: "ACTIVE",
          deletedAt: null,
        },
      });

      if (previous) {
        await tx.enrollment.update({
          where: { id: previous.id },
          data: { status: "TRANSFERRED", endedOn: new Date() },
        });
      }

      const enrollment = await tx.enrollment.create({ data });

      // The denormalised pointer follows the current enrollment. It drives
      // listing and filtering only — never authorization.
      await tx.child.update({
        where: { id: data.childId },
        data: { kindergartenId: data.kindergartenId },
      });

      return enrollment;
    });
  }

  async endEnrollment(id: string, status: EnrollmentStatus) {
    return this.prisma.enrollment.update({
      where: { id },
      data: { status, endedOn: new Date() },
    });
  }

  async findGroupInKindergarten(groupId: string, kindergartenId: string) {
    return this.prisma.group.findFirst({
      where: { id: groupId, kindergartenId, deletedAt: null },
      include: { schoolYear: { select: { id: true } } },
    });
  }
}

export interface ChildFilters {
  status?: ChildStatus;
  groupId?: string;
  schoolYearId?: string;
  enrollmentStatus?: EnrollmentStatus;
  q?: string;
}

export interface CreateChildData {
  kindergartenId: string;
  lastName: string;
  firstName: string;
  nationalId?: string | null;
  sex: Sex;
  dateOfBirth: Date;
  healthNotes?: string | null;
}

export interface UpdateChildData {
  lastName?: string;
  firstName?: string;
  nationalId?: string | null;
  sex?: Sex;
  dateOfBirth?: Date;
  healthNotes?: string | null;
  status?: ChildStatus;
}
