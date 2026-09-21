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
           * ★★ There is no environment to record. The client confirmed on
           * 2026-09-19 that the ministry runs no ESIS test environment —
           * everything goes to the production hub — so the TEST/PRODUCTION
           * column was dropped in `20260919150000_drop_esis_environment`
           * rather than written with a constant.
           */
          esisInstitutionId: input.esis?.institutionId ?? null,
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
   * The kindergarten's Захирал/Эрхлэгч accounts.
   *
   * ★ `lastLoginAt` comes along because the operator's question is "can
   * anybody get in", not "who is listed" — a director who never accepted
   * their invitation reads identically to a working one without it.
   */
  async listAdmins(kindergartenId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { kindergartenId, role: "ADMIN", deletedAt: null },
      select: {
        user: {
          select: {
            id: true,
            username: true,
            lastName: true,
            firstName: true,
            email: true,
            isActive: true,
            lastLoginAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return memberships.map((membership) => membership.user);
  }

  /**
   * A second (or replacement) director for a kindergarten that already exists.
   *
   * ★ The same three writes as `createWithAdmin`'s admin half — user,
   * membership, invitation — in one transaction, for the same reason: an
   * account with no membership reaches nothing, and one with no invitation can
   * never set a password, so a partial success is worse than a failure.
   *
   * ★★ It does **not** reuse `createWithAdmin`. That method's whole shape is
   * "a kindergarten and its first director, atomically", including the ESIS
   * mapping and the staff roster; threading a "the tenant already exists"
   * branch through it would make the one transaction this system most needs to
   * be obviously correct harder to read for the sake of thirty shared lines.
   */
  async createAdminForExisting(input: CreateAdminForExistingInput) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: input.username,
          email: input.email ?? null,
          lastName: input.lastName,
          firstName: input.firstName,
          passwordHash: input.passwordHash,
          isActive: true,
          authTokens: {
            create: {
              purpose: "INVITATION",
              tokenHash: input.invitationTokenHash,
              expiresAt: input.invitationExpiresAt,
              requestedIp: null,
            },
          },
        },
        select: {
          id: true,
          username: true,
          lastName: true,
          firstName: true,
          email: true,
          isActive: true,
          lastLoginAt: true,
        },
      });

      await tx.membership.create({
        data: { userId: user.id, kindergartenId: input.kindergartenId, role: "ADMIN" },
      });

      return user;
    });
  }

  /**
   * What a deletion would take with it — shown to the operator before they
   * confirm, and recorded in the audit row afterwards.
   *
   * ★ Counted rather than described. "This kindergarten has records" is the
   * kind of warning people click through; "83 хүүхэд, 14 ажилтан" is not.
   */
  async footprint(kindergartenId: string) {
    const [children, groups, staff, guardians] = await Promise.all([
      this.prisma.child.count({ where: { kindergartenId, deletedAt: null } }),
      this.prisma.group.count({ where: { kindergartenId, deletedAt: null } }),
      this.prisma.membership.count({
        where: { kindergartenId, deletedAt: null, role: { not: "PARENT" } },
      }),
      this.prisma.membership.count({ where: { kindergartenId, deletedAt: null, role: "PARENT" } }),
    ]);

    return { children, groups, staff, guardians };
  }

  /**
   * Retires a tenant: `deletedAt` on the kindergarten, and every membership
   * that reaches it closed in the same transaction.
   *
   * ★★ **A soft delete, and the memberships are the point.** CLAUDE.md §3.2
   * forbids removing the rows, and nothing here removes any: the children,
   * their portfolios, the invoices and the audit trail all stay exactly where
   * they are, which is what makes this recoverable and what an auditor asking
   * "what happened to that kindergarten" needs. But a `deletedAt` on the
   * tenant alone changes nothing a person can see — `Membership` is what
   * decides who may reach a tenant on every request (§1.3), so leaving them
   * open would delete the kindergarten from the operator's list while its
   * director carried on signing in and recording attendance.
   *
   * ★★★ The ESIS mapping is **released**, not kept. `esisInstitutionId` is
   * `@unique` at the database level and the constraint does not know about
   * `deletedAt` — so a retired tenant holding institution 42778 would make
   * that institution impossible to register ever again, with an error naming a
   * kindergarten the operator can no longer see. A deleted tenant has no claim
   * on a ministry institution.
   *
   * That does **not** make `PlatformService.create`'s `esisInstitutionId`
   * conflict branch dead code: it covers rows soft-deleted before this method
   * existed, which still hold theirs, and the database constraint is the only
   * thing either of us is really talking to.
   *
   * ★★★★ **Releasing it now also closes staff self-registration**, which it
   * did not have to do before 2026-09-20. The public form's first field was an
   * issued code, cleared here by two lines that this method no longer needs;
   * it is the institution number itself, so the null above is what stops a
   * retired tenant's roster from being reachable. `deletedAt: null` in
   * `StaffRegistrationRepository.findKindergartenIdByEsisInstitutionId` is the
   * second of the two locks, and the roster deletion below is the third.
   *
   * ★ `EsisStaffRoster` rows are deleted outright, the one hard delete here:
   * they are a cache of what the ministry said, keyed by register number, and
   * `staff-registration` matches against them on an unauthenticated route.
   * Leaving them behind a soft-deleted tenant means strangers can still probe
   * "does this register number work here" against a kindergarten that no
   * longer exists. The ministry is the record; this table never was.
   */
  async softDelete(id: string) {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const memberships = await tx.membership.updateMany({
        where: { kindergartenId: id, deletedAt: null },
        data: { deletedAt: now, isActive: false },
      });

      await tx.esisStaffRoster.deleteMany({ where: { kindergartenId: id } });

      const kindergarten = await tx.kindergarten.update({
        where: { id },
        data: {
          deletedAt: now,
          isActive: false,
          esisInstitutionId: null,
          esisMappedAt: null,
        },
      });

      return { kindergarten, closedMemberships: memberships.count };
    });
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

/** `PlatformRepository.createAdminForExisting`. */
export interface CreateAdminForExistingInput {
  kindergartenId: string;
  username: string;
  email: string | null;
  lastName: string;
  firstName: string;
  passwordHash: string;
  invitationTokenHash: string;
  invitationExpiresAt: Date;
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
