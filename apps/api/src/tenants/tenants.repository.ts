import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { scopedWhere, type TenantScope } from "../common/repository/tenant-scope";
import { toSkipTake, type PageParams } from "../common/pagination";
import type { AgeBand, GroupStatus, TeacherRole } from "../domain/enums";

/**
 * Kindergartens, school years, groups and teacher assignments.
 *
 * ★ The template every later repository follows. Two rules, both applied
 * without exception:
 *
 *  1. **Every tenant-scoped query composes `scopedWhere(scope, …)`.** It nests
 *     the caller's conditions under `AND` alongside `deletedAt: null` and the
 *     kindergarten filter, so a caller cannot overwrite either — passing
 *     `{ deletedAt: { not: null } }` produces a contradiction that matches
 *     nothing rather than a silently disabled guard.
 *
 *  2. **The scope comes from the actor's memberships**, never from a request
 *     parameter. A handler that passes a body-supplied kindergarten id has
 *     asked the caller to authorize themselves.
 */
@Injectable()
export class TenantsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Kindergartens ─────────────────────────────────────────────────────────

  /**
   * `Kindergarten` is the tenant root, so it has no `kindergartenId` of its
   * own — the scope filters by primary key instead. This is the one place the
   * `scopedWhere` shape does not fit, and writing the filter out is clearer
   * than contorting the helper.
   */
  async listKindergartens(scope: TenantScope) {
    return this.prisma.kindergarten.findMany({
      where: { deletedAt: null, id: { in: [...scope.kindergartenIds] } },
      orderBy: { name: "asc" },
    });
  }

  async findKindergarten(scope: TenantScope, id: string) {
    return this.prisma.kindergarten.findFirst({
      where: { deletedAt: null, id, AND: [{ id: { in: [...scope.kindergartenIds] } }] },
    });
  }

  async updateKindergarten(id: string, data: KindergartenUpdate) {
    return this.prisma.kindergarten.update({ where: { id }, data });
  }

  // ── School years ──────────────────────────────────────────────────────────

  async listSchoolYears(scope: TenantScope, kindergartenId: string) {
    return this.prisma.schoolYear.findMany({
      where: scopedWhere(scope, { kindergartenId }),
      orderBy: { startsOn: "desc" },
    });
  }

  async findSchoolYear(scope: TenantScope, id: string) {
    return this.prisma.schoolYear.findFirst({ where: scopedWhere(scope, { id }) });
  }

  /**
   * Creates a school year, demoting the previous current one first when needed.
   *
   * ★ Order matters and is enforced by the database. A partial unique index
   * allows one `isCurrent = true` row per kindergarten, so creating a second
   * current year fails on insert — clearing the old one afterwards never runs.
   * The demotion has to happen first, and both statements have to be atomic or
   * a failure between them leaves the kindergarten with no current year at all.
   */
  async createSchoolYear(data: SchoolYearInput & { kindergartenId: string }) {
    return this.prisma.$transaction(async (tx) => {
      if (data.isCurrent) {
        await tx.schoolYear.updateMany({
          where: { kindergartenId: data.kindergartenId, isCurrent: true },
          data: { isCurrent: false },
        });
      }
      return tx.schoolYear.create({ data });
    });
  }

  /** Same ordering constraint as `createSchoolYear`, same transaction. */
  async updateSchoolYear(id: string, kindergartenId: string, data: Partial<SchoolYearInput>) {
    return this.prisma.$transaction(async (tx) => {
      if (data.isCurrent) {
        await tx.schoolYear.updateMany({
          where: { kindergartenId, isCurrent: true, id: { not: id } },
          data: { isCurrent: false },
        });
      }
      return tx.schoolYear.update({ where: { id }, data });
    });
  }

  // ── Groups ────────────────────────────────────────────────────────────────

  async listGroups(scope: TenantScope, filters: GroupFilters, page: PageParams) {
    const { skip, take } = toSkipTake(page);
    const where = scopedWhere(scope, {
      ...(filters.kindergartenId ? { kindergartenId: filters.kindergartenId } : {}),
      ...(filters.schoolYearId ? { schoolYearId: filters.schoolYearId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      // Restricts a teacher to their own groups. Undefined for admins, who see
      // every group in their kindergartens.
      ...(filters.groupIds ? { id: { in: filters.groupIds } } : {}),
    });

    const [items, total] = await Promise.all([
      this.prisma.group.findMany({
        where,
        orderBy: [{ ageBand: "asc" }, { name: "asc" }],
        skip,
        take,
        include: {
          schoolYear: { select: { id: true, name: true } },
          _count: { select: { enrollments: { where: { status: "ACTIVE", deletedAt: null } } } },
        },
      }),
      this.prisma.group.count({ where }),
    ]);

    return { items, total };
  }

  async findGroup(scope: TenantScope, id: string) {
    return this.prisma.group.findFirst({
      where: scopedWhere(scope, { id }),
      include: {
        schoolYear: { select: { id: true, name: true } },
        teachers: {
          where: { endedOn: null, deletedAt: null },
          include: {
            membership: {
              include: { user: { select: { id: true, lastName: true, firstName: true } } },
            },
          },
        },
      },
    });
  }

  async createGroup(data: GroupInput & { kindergartenId: string; schoolYearId: string }) {
    return this.prisma.group.create({ data });
  }

  async updateGroup(id: string, data: Partial<GroupInput>) {
    return this.prisma.group.update({ where: { id }, data });
  }

  /**
   * Soft delete.
   *
   * Records only `deletedAt`. "Who deleted this" lives in `AuditLog`, which the
   * service writes in the same operation — carrying `createdById` /
   * `updatedById` / `deletedById` on all 25 tenant tables as well would
   * duplicate that, and two sources of the same fact drift.
   */
  async softDeleteGroup(id: string) {
    return this.prisma.group.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Live enrollments in a group — checked before archiving one. */
  async countActiveEnrollments(groupId: string): Promise<number> {
    return this.prisma.enrollment.count({
      where: { groupId, status: "ACTIVE", deletedAt: null },
    });
  }

  // ── Teacher assignments ───────────────────────────────────────────────────

  async findAssignment(scope: TenantScope, id: string) {
    return this.prisma.groupTeacher.findFirst({ where: scopedWhere(scope, { id }) });
  }

  async assignTeacher(data: {
    kindergartenId: string;
    groupId: string;
    membershipId: string;
    role: TeacherRole;
  }) {
    return this.prisma.groupTeacher.create({ data });
  }

  /**
   * Ends an assignment — the revocation path.
   *
   * Sets `endedOn` rather than deleting the row, so the record of who taught
   * whom survives while the teacher's access stops immediately.
   */
  async endAssignment(id: string) {
    return this.prisma.groupTeacher.update({
      where: { id },
      data: { endedOn: new Date() },
    });
  }

  async findActiveAssignment(groupId: string, membershipId: string) {
    return this.prisma.groupTeacher.findFirst({
      where: { groupId, membershipId, endedOn: null, deletedAt: null },
    });
  }

  /** Verifies a membership is a TEACHER in this kindergarten before assigning. */
  async findTeacherMembership(membershipId: string, kindergartenId: string) {
    return this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        kindergartenId,
        role: "TEACHER",
        isActive: true,
        deletedAt: null,
      },
    });
  }
}

export interface KindergartenUpdate {
  name?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export interface SchoolYearInput {
  name: string;
  startsOn: Date;
  endsOn: Date;
  isCurrent: boolean;
}

export interface GroupInput {
  name: string;
  ageBand: AgeBand;
  status?: GroupStatus;
}

export interface GroupFilters {
  kindergartenId?: string;
  schoolYearId?: string;
  status?: GroupStatus;
  /** Restricts to specific groups — how a teacher's list is narrowed. */
  groupIds?: string[];
}
