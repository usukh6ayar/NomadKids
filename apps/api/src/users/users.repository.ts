import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toSkipTake, type PageParams } from "../common/pagination";
import type { Role } from "../domain/enums";

/**
 * Users and their memberships.
 *
 * `User` is a platform-level table with no `kindergartenId` — one person may
 * hold roles in several kindergartens. Scoping therefore happens through
 * `memberships`, which is why these queries filter on the relation rather than
 * composing `scopedWhere`.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Users holding a membership in one of the given kindergartens.
   *
   * ★ The membership filter appears twice, deliberately: once in `where` to
   * select the right users, and once in the `include` so the response carries
   * only the memberships this admin may see. Without the second, an admin of
   * kindergarten A would learn that a parent also has a child at kindergarten B.
   */
  async list(kindergartenIds: string[], filters: UserFilters, page: PageParams) {
    const { skip, take } = toSkipTake(page);

    const where = {
      deletedAt: null,
      memberships: {
        some: {
          kindergartenId: { in: kindergartenIds },
          deletedAt: null,
          ...(filters.role ? { role: filters.role } : {}),
          ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
        },
      },
      ...(filters.q
        ? {
            OR: [
              { lastName: { contains: filters.q, mode: "insensitive" as const } },
              { firstName: { contains: filters.q, mode: "insensitive" as const } },
              { username: { contains: filters.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip,
        take,
        select: {
          id: true,
          username: true,
          email: true,
          phone: true,
          lastName: true,
          firstName: true,
          isActive: true,
          lastLoginAt: true,
          memberships: {
            where: { kindergartenId: { in: kindergartenIds }, deletedAt: null },
            select: { id: true, kindergartenId: true, role: true, isActive: true },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total };
  }

  /** A single user, visible only if they share a kindergarten with the actor. */
  async findInScope(id: string, kindergartenIds: string[]) {
    return this.prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
        memberships: { some: { kindergartenId: { in: kindergartenIds }, deletedAt: null } },
      },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        lastName: true,
        firstName: true,
        specialization: true,
        education: true,
        bio: true,
        isActive: true,
        lastLoginAt: true,
        memberships: {
          where: { kindergartenId: { in: kindergartenIds }, deletedAt: null },
          select: { id: true, kindergartenId: true, role: true, isActive: true },
        },
      },
    });
  }

  async findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username }, select: { id: true } });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email }, select: { id: true } });
  }

  async findByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
  }

  async create(data: CreateUserData) {
    return this.prisma.user.create({
      data,
      select: { id: true, username: true, lastName: true, firstName: true },
    });
  }

  async update(id: string, data: UpdateUserData) {
    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        lastName: true,
        firstName: true,
        isActive: true,
      },
    });
  }

  async findProfile(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        lastName: true,
        firstName: true,
        specialization: true,
        education: true,
        bio: true,
        // RFP §3.3 — профайл зураг. The settings screen previews it, so the id
        // has to come back with the rest of the profile.
        photoMediaFileId: true,
      },
    });
  }

  // ── Memberships ───────────────────────────────────────────────────────────

  async createMembership(userId: string, kindergartenId: string, role: Role) {
    return this.prisma.membership.create({ data: { userId, kindergartenId, role } });
  }

  async findMembership(id: string, kindergartenIds: string[]) {
    return this.prisma.membership.findFirst({
      where: { id, kindergartenId: { in: kindergartenIds }, deletedAt: null },
    });
  }

  async findMembershipFor(userId: string, kindergartenId: string, role: Role) {
    return this.prisma.membership.findFirst({
      where: { userId, kindergartenId, role, deletedAt: null },
    });
  }

  /**
   * Deactivates a membership — the revocation path.
   *
   * ★ Never deletes. `isActive: false` stops access on the user's next request
   * while preserving the record that they once held the role, which every
   * audit trail depends on.
   */
  async deactivateMembership(id: string) {
    return this.prisma.membership.update({ where: { id }, data: { isActive: false } });
  }

  async reactivateMembership(id: string) {
    return this.prisma.membership.update({ where: { id }, data: { isActive: true } });
  }

  /**
   * Ends every group assignment attached to a membership.
   *
   * Deactivating a teacher's membership must also end their assignments, or the
   * GroupTeacher rows stay `endedOn: null` and reactivating the membership
   * later silently restores access to groups nobody re-granted.
   */
  async endAssignmentsForMembership(membershipId: string) {
    await this.prisma.groupTeacher.updateMany({
      where: { membershipId, endedOn: null },
      data: { endedOn: new Date() },
    });
  }
}

export interface UserFilters {
  role?: Role;
  isActive?: boolean;
  q?: string;
}

export interface CreateUserData {
  username: string;
  email?: string | null;
  phone?: string | null;
  passwordHash: string;
  lastName: string;
  firstName: string;
}

export interface UpdateUserData {
  email?: string | null;
  phone?: string | null;
  lastName?: string;
  firstName?: string;
  specialization?: string | null;
  education?: string | null;
  bio?: string | null;
  isActive?: boolean;
}
