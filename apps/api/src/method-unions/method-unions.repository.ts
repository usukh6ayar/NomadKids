import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toSkipTake, type PageParams } from "../common/pagination";
import { searchWhere } from "../common/repository/search";

/** A membership as a union shows it — never the user's contact details. */
const PERSON = {
  id: true,
  userId: true,
  user: { select: { lastName: true, firstName: true } },
} as const;

const LIVE_MEMBER = { deletedAt: null } as const;

const UNION_INCLUDE = {
  schoolYear: { select: { id: true, name: true } },
  lead: { select: PERSON },
  _count: { select: { members: { where: LIVE_MEMBER } } },
} as const;

/**
 * The seats on one union's detail. Bounded: a union is drawn from one
 * kindergarten's teachers, and this is a ceiling a real one never nears
 * (CLAUDE.md §3.4 — no unbounded list, even an implausible one).
 */
const MEMBERS_ON_DETAIL = 500;

/**
 * «Заах аргын нэгдэл» — teaching-method unions.
 *
 * Kindergarten-scoped staff records, not child data: the tenant filter is the
 * isolation, which is why reads take a `kindergartenId` or read it back from
 * the row for the service to check.
 */
@Injectable()
export class MethodUnionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    kindergartenId: string,
    filters: { q?: string; schoolYearId?: string },
    page: PageParams,
  ) {
    const { skip, take } = toSkipTake(page);
    const where = {
      kindergartenId,
      deletedAt: null,
      ...(filters.schoolYearId ? { schoolYearId: filters.schoolYearId } : {}),
      ...(searchWhere(filters.q, ["name"]) ?? {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.methodUnion.findMany({
        where,
        orderBy: [{ startsOn: "desc" }, { name: "asc" }, { id: "asc" }],
        skip,
        take,
        include: UNION_INCLUDE,
      }),
      this.prisma.methodUnion.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string) {
    return this.prisma.methodUnion.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...UNION_INCLUDE,
        members: {
          where: LIVE_MEMBER,
          orderBy: { createdAt: "asc" },
          take: MEMBERS_ON_DETAIL,
          select: { id: true, createdAt: true, membership: { select: PERSON } },
        },
      },
    });
  }

  async findSchoolYear(id: string, kindergartenId: string) {
    return this.prisma.schoolYear.findFirst({
      where: { id, kindergartenId, deletedAt: null },
      select: { id: true },
    });
  }

  /**
   * An active TEACHER membership of this kindergarten, or null.
   *
   * ★ The one check a lead and a member both pass through. The id arrives from
   * a client, so "a teacher" is not enough — it has to be a teacher **here**,
   * still active, or another kindergarten's staff could be written into this
   * one's union.
   */
  async findActiveTeacher(membershipId: string, kindergartenId: string) {
    return this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        kindergartenId,
        role: "TEACHER",
        isActive: true,
        deletedAt: null,
        user: { deletedAt: null },
      },
      select: { id: true },
    });
  }

  async create(data: {
    kindergartenId: string;
    name: string;
    schoolYearId: string;
    leadMembershipId: string | null;
    startsOn: Date;
    endsOn: Date | null;
    esisAcademicOrgId: string | null;
  }) {
    return this.prisma.methodUnion.create({ data, include: UNION_INCLUDE });
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      schoolYearId: string;
      leadMembershipId: string | null;
      startsOn: Date;
      endsOn: Date | null;
      esisAcademicOrgId: string | null;
    }>,
  ) {
    return this.prisma.methodUnion.update({ where: { id }, data, include: UNION_INCLUDE });
  }

  /** The union and its live seats go together — a seat in a removed union is not one. */
  async softDelete(id: string) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.methodUnionMember.updateMany({
        where: { unionId: id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.methodUnion.update({ where: { id }, data: { deletedAt: now } }),
    ]);
  }

  /** A live seat, with its union's tenant — null if either is gone. */
  async findMember(id: string) {
    return this.prisma.methodUnionMember.findFirst({
      where: { id, deletedAt: null, union: { deletedAt: null } },
      select: { id: true, kindergartenId: true, unionId: true, membershipId: true },
    });
  }

  async findLiveSeat(unionId: string, membershipId: string) {
    return this.prisma.methodUnionMember.findFirst({
      where: { unionId, membershipId, deletedAt: null },
      select: { id: true },
    });
  }

  async addMember(data: { kindergartenId: string; unionId: string; membershipId: string }) {
    return this.prisma.methodUnionMember.create({
      data,
      select: { id: true, createdAt: true, membership: { select: PERSON } },
    });
  }

  async removeMember(id: string) {
    await this.prisma.methodUnionMember.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
