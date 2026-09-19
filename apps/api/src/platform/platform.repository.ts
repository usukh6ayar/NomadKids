import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toSkipTake, type PageParams } from "../common/pagination";
import { searchWhere } from "../common/repository/search";

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
          /*
           * ★ All three together or none of them. A kindergarten holding an
           * institution id with no `esisMappedAt` is a mapping nobody can date,
           * and the ESIS screens read the three as one fact.
           *
           * ★★ `esisEnvironment` is a literal, not a choice. The client
           * confirmed there is no ESIS test environment — everything runs
           * against the real one — and the TEST/PRODUCTION column is on its way
           * out. Nothing here derives it, offers it or accepts it from a body.
           */
          esisInstitutionId: input.esis?.institutionId ?? null,
          esisEnvironment: input.esis ? "PRODUCTION" : null,
          esisMappedAt: input.esis ? new Date() : null,
        },
      });

      /*
       * The roster the ministry already answered with, kept so that
       * self-registration has something to match a register number against on
       * day one rather than after the first refresh.
       */
      if (input.esis && input.esis.staff.length > 0) {
        await tx.esisStaffRoster.createMany({
          data: input.esis.staff.map((person) => ({
            kindergartenId: kindergarten.id,
            esisPersonId: person.personId,
            registerNumber: person.registerNumber,
            lastName: person.lastName,
            firstName: person.firstName,
            jobCode: person.jobCode,
            positionName: person.positionName,
            /*
             * ★ `isInstructor` is left at its default `false` on purpose.
             *
             * It records whether `teacher/list` **also** returned this person,
             * and the institution lookup does not read `teacher/list` at all —
             * so the fact is unknown here, not false. The next roster refresh
             * reads both lists and fills it in.
             *
             * It is deliberately NOT derived from `suggestedRole`: "their job
             * code looks like a teacher's" is a different fact wearing the same
             * name, and writing it here would make the two lists' disagreement
             * — the only reason this column exists — unmeasurable.
             */
          })),
          /*
           * ★ ESIS's staff lists are known to repeat a person, and the table
           * carries two unique indexes. A duplicate row must not roll the whole
           * kindergarten back: the operator would see "this username is taken"
           * for a request whose username was fine.
           */
          skipDuplicates: true,
        });
      }

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
      ...(searchWhere(filters.q, ["name"]) ?? {}),
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
  /**
   * The institution this kindergarten is created mapped to, and the staff the
   * ministry listed for it. Absent for a deployment with no ESIS presence.
   */
  esis?: {
    institutionId: string;
    staff: {
      personId: string;
      registerNumber: string;
      lastName: string;
      firstName: string;
      jobCode: string | null;
      positionName: string | null;
    }[];
  } | null;
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
