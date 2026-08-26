import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toSkipTake, type PageParams } from "../common/pagination";

/**
 * Platform-level kindergarten queries.
 *
 * ★ The one repository in the system with no tenant filter, because its caller
 * is not a member of anything. `deletedAt: null` still applies everywhere; it
 * is the *tenant* scope that is absent, and it is absent by design rather than
 * by omission. `PlatformService.assertSuperAdmin` is the only thing standing in
 * front of it — which is why nothing outside this module may inject it.
 */
@Injectable()
export class PlatformRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Kindergarten, director, membership and invitation — atomically.
   *
   * All four or none. A kindergarten with no membership is unreachable, and a
   * user with no invitation token can never set a password, so a partial
   * success here is worse than a failure.
   *
   * The password hash and the token hash are computed by the service: hashing
   * is expensive and belongs outside the transaction, and the token's plaintext
   * must never reach a repository.
   */
  async createWithAdmin(input: CreateWithAdminInput) {
    return this.prisma.$transaction(async (tx) => {
      const kindergarten = await tx.kindergarten.create({
        data: {
          name: input.kindergarten.name,
          address: input.kindergarten.address ?? null,
          phone: input.kindergarten.phone ?? null,
          email: input.kindergarten.email ?? null,
          description: input.kindergarten.description ?? null,
        },
      });

      const admin = await tx.user.create({
        data: {
          username: input.admin.username,
          email: input.admin.email,
          phone: input.admin.phone,
          lastName: input.admin.lastName,
          firstName: input.admin.firstName,
          passwordHash: input.admin.passwordHash,
        },
        select: {
          id: true,
          username: true,
          email: true,
          phone: true,
          lastName: true,
          firstName: true,
        },
      });

      await tx.membership.create({
        data: { userId: admin.id, kindergartenId: kindergarten.id, role: "ADMIN" },
      });

      await tx.authToken.create({
        data: {
          userId: admin.id,
          purpose: "INVITATION",
          tokenHash: input.admin.invitationTokenHash,
          expiresAt: input.admin.invitationExpiresAt,
          requestedIp: null,
        },
      });

      return { kindergarten, admin };
    });
  }

  async list(filters: KindergartenFilters, page: PageParams) {
    const { skip, take } = toSkipTake(page);
    const where = {
      deletedAt: null,
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...(filters.q ? { name: { contains: filters.q, mode: "insensitive" as const } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.kindergarten.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take,
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          email: true,
          isActive: true,
          createdAt: true,
        },
      }),
      this.prisma.kindergarten.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * The base row only. Live counts, coverage and activity for the detail view
   * come from `DashboardRepository`'s per-kindergarten queries, not from here
   * — §3.4, one query per concern rather than an ad-hoc `_count` growing a
   * field at a time.
   */
  async findById(id: string) {
    return this.prisma.kindergarten.findFirst({ where: { id, deletedAt: null } });
  }

  async update(id: string, data: KindergartenUpdate) {
    return this.prisma.kindergarten.update({ where: { id }, data });
  }

  /**
   * System-wide totals — RFP §12.2's "Администраторын хяналтын самбар": нийт
   * цэцэрлэг/бүлэг/хүүхэд/багш/идэвхтэй эцэг эх.
   *
   * Same shape as `DashboardRepository.kindergartenCounts`, minus its
   * `kindergartenId: { in: [...] }` filter — this repository is the one place
   * in the system that legitimately counts across every tenant at once.
   */
  async platformTotals() {
    const [kindergartens, groups, children, staff, guardians] = await Promise.all([
      this.prisma.kindergarten.count({ where: { deletedAt: null } }),
      this.prisma.group.count({ where: { deletedAt: null, status: "ACTIVE" } }),
      this.prisma.child.count({ where: { deletedAt: null, status: "ACTIVE" } }),
      this.prisma.membership.count({
        where: { deletedAt: null, isActive: true, role: { in: ["TEACHER", "ADMIN"] } },
      }),
      this.prisma.membership.count({
        where: { deletedAt: null, isActive: true, role: "PARENT" },
      }),
    ]);

    return { kindergartens, groups, children, staff, guardians };
  }
}

export interface CreateWithAdminInput {
  kindergarten: {
    name: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    description?: string | null;
  };
  admin: {
    username: string;
    email: string | null;
    phone: string | null;
    lastName: string;
    firstName: string;
    passwordHash: string;
    invitationTokenHash: string;
    invitationExpiresAt: Date;
  };
}

export interface KindergartenFilters {
  q?: string;
  isActive?: boolean;
}

export interface KindergartenUpdate {
  name?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  description?: string | null;
  isActive?: boolean;
}
