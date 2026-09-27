import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toSkipTake, type PageParams } from "../common/pagination";
import type { Role } from "../domain/enums";
import { searchWhere } from "../common/repository/search";
import type { StaffCategory } from "../generated/prisma/enums";

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
    const where = staffWhere(kindergartenIds, filters);

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip,
        take,
        select: staffSelect(kindergartenIds),
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Every matching member of staff, for the spreadsheet — not the page on
   * screen, with the same filters. Capped rather than unbounded (§3.4): a
   * kindergarten's staff is tens of people.
   */
  async listForExport(kindergartenIds: string[], filters: UserFilters) {
    return this.prisma.user.findMany({
      where: staffWhere(kindergartenIds, filters),
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: EXPORT_CAP,
      select: staffSelect(kindergartenIds),
    });
  }

  async updateMembershipProfile(
    id: string,
    data: {
      position?: string | null;
      staffCategory?: StaffCategory | null;
      startedOn?: Date | null;
    },
  ) {
    return this.prisma.membership.update({
      where: { id },
      data,
      select: {
        id: true,
        kindergartenId: true,
        role: true,
        position: true,
        staffCategory: true,
        startedOn: true,
      },
    });
  }

  /** A single user, visible only if they share a kindergarten with the actor. */
  async findInScope(id: string, kindergartenIds: string[]) {
    return this.prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
        memberships: { some: { kindergartenId: { in: kindergartenIds }, deletedAt: null } },
      },
      // The directory's own row, so the side panel shows what the table does —
      // plus the professional lines only the detail carries.
      select: {
        ...staffSelect(kindergartenIds),
        specialization: true,
        qualification: true,
        education: true,
        bio: true,
      },
    });
  }

  /**
   * The posts in use in these kindergartens — what «Албан тушаал» offers.
   * Free text, so the choices are the ones people actually typed.
   */
  async listPositions(kindergartenIds: string[], roles?: Role[]) {
    const rows = await this.prisma.membership.findMany({
      where: {
        kindergartenId: { in: kindergartenIds },
        deletedAt: null,
        position: { not: null },
        ...(roles?.length ? { role: { in: roles } } : {}),
        user: { deletedAt: null },
      },
      select: { position: true },
      distinct: ["position"],
      take: POSITIONS_CAP,
    });
    // Sorted here, in Mongolian order — the database collation does not know it.
    return rows
      .map((row) => row.position)
      .filter((p): p is string => Boolean(p?.trim()))
      .sort((x, y) => x.localeCompare(y, "mn"));
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

  /**
   * The account, if any, already tied to this ESIS person.
   *
   * ★ `esisPersonId` is globally unique (schema.prisma), which is what makes
   * this a yes/no question rather than a search: one person in the ministry's
   * database is one account, so `StaffRegistrationService` refuses a second
   * registration for the same person by checking this before it creates one.
   */
  async findByEsisPersonId(esisPersonId: string) {
    return this.prisma.user.findUnique({ where: { esisPersonId }, select: { id: true } });
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
        qualification: true,
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
   * Moves a member of staff from one role to another, atomically.
   *
   * ★ One transaction, because the intermediate state is a person with no role.
   *
   * `Membership` is unique on (`userId`, `kindergartenId`, `role`), so this
   * cannot be an update of the `role` column when a row for the target role
   * already exists — which it does whenever somebody held that role before and
   * it was revoked. Both branches live here rather than in the service so that
   * the "deactivate the old, activate or create the new" pair can never be
   * half-applied.
   *
   * ★★ Group assignments end with the old role, on `revokeMembership`'s own
   * reasoning: a teacher who becomes a cook must not keep the groups their
   * teaching membership carried, and `GroupTeacher` rows left `endedOn: null`
   * would silently restore them if the teaching role were ever granted again.
   */
  async changeMembershipRole(
    membershipId: string,
    userId: string,
    kindergartenId: string,
    role: Role,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: membershipId }, data: { isActive: false } });
      await tx.groupTeacher.updateMany({
        where: { membershipId, endedOn: null, deletedAt: null },
        data: { endedOn: new Date() },
      });

      const existing = await tx.membership.findFirst({
        where: { userId, kindergartenId, role, deletedAt: null },
      });

      if (existing) {
        return tx.membership.update({ where: { id: existing.id }, data: { isActive: true } });
      }

      return tx.membership.create({ data: { userId, kindergartenId, role } });
    });
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
  roles?: Role[];
  isActive?: boolean;
  q?: string;
  groupId?: string;
  hasGroup?: boolean;
  /** «Албан тушаал» — the membership's free-text post, matched whole, any case. */
  position?: string;
  /** «Ангилал». */
  staffCategory?: StaffCategory;
}

/**
 * Users holding a membership in one of the given kindergartens, narrowed by
 * the directory's filters.
 *
 * ★ `role` narrows to one; `roles` narrows to a set. Both are applied when both
 * are given — the intersection is the honest reading of "teachers, out of the
 * staff roles".
 */
function staffWhere(kindergartenIds: string[], filters: UserFilters) {
  return {
    deletedAt: null,
    memberships: {
      some: {
        kindergartenId: { in: kindergartenIds },
        deletedAt: null,
        ...(filters.role ? { role: filters.role } : {}),
        ...(filters.roles?.length ? { role: { in: filters.roles } } : {}),
        ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
        // «Бүлэг хариуцсан / Бүлэггүй» and one group — through the live
        // assignment rows, the same ones `canAccessChild` reads.
        ...(filters.groupId
          ? { assignments: { some: { ...ACTIVE_ASSIGNMENT, groupId: filters.groupId } } }
          : {}),
        ...(filters.hasGroup === true ? { assignments: { some: ACTIVE_ASSIGNMENT } } : {}),
        ...(filters.hasGroup === false ? { assignments: { none: ACTIVE_ASSIGNMENT } } : {}),
        ...(filters.position
          ? { position: { equals: filters.position, mode: "insensitive" as const } }
          : {}),
        ...(filters.staffCategory ? { staffCategory: filters.staffCategory } : {}),
      },
    },
    ...(searchWhere(filters.q, ["lastName", "firstName", "username", "phone", "registerNumber"]) ??
      {}),
  };
}

/** How many distinct posts the position filter offers — a ceiling, not a page (§3.4). */
const POSITIONS_CAP = 200;

/** A group assignment that is live today — not ended, not soft-deleted. */
const ACTIVE_ASSIGNMENT = { deletedAt: null, endedOn: null } as const;

const EXPORT_CAP = 2000;

/**
 * One member of staff as the directory draws them.
 *
 * ★ Memberships narrowed to the admin's own kindergartens — the same second
 * filter `list` explains: without it an admin of A would learn what a person
 * does at B.
 */
function staffSelect(kindergartenIds: string[]) {
  return {
    id: true,
    username: true,
    email: true,
    phone: true,
    lastName: true,
    firstName: true,
    registerNumber: true,
    dateOfBirth: true,
    // The join key to an ESIS staff row — see `adminUserSchema`.
    esisPersonId: true,
    isActive: true,
    lastLoginAt: true,
    memberships: {
      where: { kindergartenId: { in: kindergartenIds }, deletedAt: null },
      select: {
        id: true,
        kindergartenId: true,
        role: true,
        isActive: true,
        position: true,
        staffCategory: true,
        startedOn: true,
        assignments: {
          where: ACTIVE_ASSIGNMENT,
          select: { role: true, group: { select: { id: true, name: true } } },
        },
      },
    },
  } as const;
}

export interface CreateUserData {
  username: string;
  email?: string | null;
  phone?: string | null;
  passwordHash: string;
  lastName: string;
  firstName: string;
  /**
   * The ministry identity, when the account is created by self-registration.
   *
   * ★ It is no longer "set only by self-registration" — a director may attach
   * one to an invited account afterwards (`linkStaffToEsisPerson`). At
   * *creation* time self-registration is still the only source, which is why
   * it stays here and why `selfRegisteredAt` is set alongside it.
   */
  esisPersonId?: string | null;
  /** When the person made their own account. NULL for an invitation. */
  selfRegisteredAt?: Date | null;
}

export interface UpdateUserData {
  email?: string | null;
  phone?: string | null;
  registerNumber?: string | null;
  dateOfBirth?: Date | null;
  lastName?: string;
  firstName?: string;
  specialization?: string | null;
  qualification?: string | null;
  education?: string | null;
  bio?: string | null;
  isActive?: boolean;
}
