import { Injectable } from "@nestjs/common";
// Types only, and only reachable here: CLAUDE.md §2.2 exempts `*.repository.ts`
// precisely so a query shape can be typed at the layer that builds queries.
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { childKey } from "./child-import";
import { toSkipTake, type PageParams } from "../common/pagination";
import type { VisibleChildrenFilter } from "../authz/authz.repository";
import type { ChildStatus, EnrollmentStatus, GuardianRelation, Sex } from "../domain/enums";

/**
 * An age range, as a birth-date range — RFP §11's "нас … шүүх".
 *
 * ★ The bounds are inverted, and that is not a slip.
 *
 * A *higher* age means an *earlier* birth date, so `ageMin` produces the upper
 * bound on the date and `ageMax` the lower one. Written out because this reads
 * wrong at a glance and every future reader will want to swap it back:
 *
 *   at least 3 years old  →  born on or before today − 3 years
 *   at most  4 years old  →  born after         today − 5 years
 *
 * ★★ The lower bound is `ageMax + 1` and it is **exclusive**.
 *
 * "At most 4" means every child who has not yet turned 5 — including one who is
 * 4 years and 364 days. Using `today − 4 years` as an inclusive lower bound
 * would return only children who are *exactly* 4 to the day, which is almost
 * nobody. This is the off-by-one that makes an age filter quietly return an
 * empty roster.
 *
 * Computed in UTC to match `@db.Date`, which Prisma stores as UTC midnight.
 */
export function ageRangeWhere(ageMin?: number, ageMax?: number) {
  if (ageMin === undefined && ageMax === undefined) return {};

  const today = new Date();
  const shiftYears = (years: number) =>
    new Date(
      Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0),
    );

  return {
    dateOfBirth: {
      ...(ageMin !== undefined ? { lte: shiftYears(ageMin) } : {}),
      ...(ageMax !== undefined ? { gt: shiftYears(ageMax + 1) } : {}),
    },
  };
}

/**
 * The roster's sort order — RFP §11.
 *
 * ★ `age` maps to `dateOfBirth` with the direction reversed, in one place.
 *
 * Age decreases as the birth date increases, so "youngest first" is
 * `dateOfBirth desc`. Doing that flip here rather than at the call site is what
 * stops the list and its summary from disagreeing about which end is which.
 *
 * Every order falls back to the name, so a page boundary is stable: two
 * children born on the same day would otherwise be returned in whatever order
 * Postgres happened to produce, and one of them could appear on both page one
 * and page two.
 */
export function childOrderBy(sorting: ChildSorting): Prisma.ChildOrderByWithRelationInput[] {
  const order: Prisma.SortOrder = sorting.order;
  const flipped: Prisma.SortOrder = order === "asc" ? "desc" : "asc";
  const byName: Prisma.ChildOrderByWithRelationInput[] = [
    { lastName: order },
    { firstName: order },
  ];

  switch (sorting.sort) {
    case "dateOfBirth":
      return [{ dateOfBirth: order }, ...byName];
    case "age":
      return [{ dateOfBirth: flipped }, ...byName];
    case "updatedAt":
      return [{ updatedAt: order }, ...byName];
    case "name":
    default:
      return [...byName];
  }
}

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

  /**
   * The roster filter — visibility plus the caller's search terms.
   *
   * ★ Extracted so the list and its summary cannot diverge.
   *
   * It was inline in `listChildren`, and `rosterAges` needs the identical
   * predicate: a total computed over a second, hand-copied `where` is how a
   * header ends up reporting a number the rows beneath it contradict — or, far
   * worse, counting children the caller may not see. One expression, two
   * callers, no opportunity to drift.
   */
  private childWhere(visible: VisibleChildrenFilter, filters: ChildFilters) {
    return {
      AND: [
        visible,
        {
          ...(filters.ids ? { id: { in: filters.ids } } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.sex ? { sex: filters.sex } : {}),
          ...ageRangeWhere(filters.ageMin, filters.ageMax),
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
  }

  async listChildren(
    visible: VisibleChildrenFilter,
    filters: ChildFilters,
    page: PageParams,
    sorting: ChildSorting = { sort: "name", order: "asc" },
  ) {
    const { skip, take } = toSkipTake(page);
    const where = this.childWhere(visible, filters);

    const [items, total] = await Promise.all([
      this.prisma.child.findMany({
        where,
        orderBy: childOrderBy(sorting),
        skip,
        take,
        select: {
          id: true,
          lastName: true,
          firstName: true,
          nationalId: true,
          isForeign: true,
          foreignId: true,
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
          /*
            ★ Read to be counted, never to be returned — see the mapping below.

            `healthNotes` is a child's medical history and a guardian's phone
            number is personal data; both are legitimately on the detail
            endpoint behind `canAccessChild`, and neither belongs in a payload
            whose job is to draw thirty rows. They are selected here so the
            three booleans can be computed on the server and the values
            dropped before anything leaves it.

            ★★ `take: 1` on the guardianships, and `phone` is the only field.
            One reachable guardian is what the check asks; loading all of them
            to answer a yes/no would be a bigger query for no more answer.
          */
          healthNotes: true,
          guardianships: {
            where: { deletedAt: null, guardian: { phone: { not: null } } },
            select: { id: true },
            take: 1,
          },
        },
      }),
      this.prisma.child.count({ where }),
    ]);

    /*
     * ★ The sensitive fields are stripped here, not trusted to a DTO downstream.
     *
     * A `select` that reads `healthNotes` and a response that omits it are two
     * different files, and the one that forgets is the one that ships. Doing it
     * in the same function that asked for them keeps the two edits together.
     */
    const rows = items.map(({ healthNotes, guardianships, ...child }) => ({
      ...child,
      profile: {
        photo: Boolean(child.photoMediaFileId),
        health: Boolean(healthNotes?.trim()),
        guardianContact: guardianships.length > 0,
      },
    }));

    return { items: rows, total };
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
  /**
   * The roster's size, mean age and sex split — over the *same* filter the list
   * uses.
   *
   * ★ It takes the caller's `visible` filter and `filters` rather than
   * rebuilding a query. Authorization lives in one module (CLAUDE.md §1.1), and
   * a summary that assembled its own `where` would be a second place deciding
   * who is counted — the kind of divergence that shows up as a roster total
   * that disagrees with the rows beneath it, or worse, counts children the
   * caller may not see.
   *
   * ★★ Selects `dateOfBirth` alone and averages in the service.
   *
   * Postgres cannot average a `date` directly, and the alternatives are worse:
   * `$queryRaw` would mean expressing the visibility filter a second time in
   * SQL, which is exactly what the note above forbids. The projection is one
   * column over a kindergarten's roster — hundreds of rows at most, none of
   * which leaves the server — so the cost is a rounding error against the risk.
   */
  async rosterFacts(visible: VisibleChildrenFilter, filters: ChildFilters) {
    return this.prisma.child.findMany({
      where: this.childWhere(visible, filters),
      select: { dateOfBirth: true, sex: true },
    });
  }

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
   * The child's identity plus every enrollment — the "Цэцэрлэг, бүлгийн архив"
   * read.
   *
   * Wider than `listEnrollments`: the kindergarten contact fields and the
   * group's schedule/rules feed the "Одоогийн цэцэрлэг, бүлгийн мэдээлэл" card,
   * so they are selected here and nowhere else. Access is gated by
   * `assertCanAccess` in the service before this runs — same contract as
   * `listEnrollments`.
   */
  async findEnrollmentArchive(childId: string) {
    return this.prisma.child.findFirst({
      where: { id: childId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        enrollments: {
          where: { deletedAt: null },
          orderBy: { startedOn: "desc" },
          select: {
            id: true,
            status: true,
            startedOn: true,
            endedOn: true,
            kindergarten: {
              select: {
                id: true,
                name: true,
                address: true,
                phone: true,
                email: true,
                description: true,
              },
            },
            group: { select: { id: true, name: true, schedule: true, rules: true } },
            schoolYear: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /** The current homeroom teachers of a group — LEAD before ASSISTANT. */
  async listActiveGroupTeachers(groupId: string) {
    return this.prisma.groupTeacher.findMany({
      where: { groupId, endedOn: null, deletedAt: null },
      orderBy: { role: "asc" },
      select: {
        role: true,
        membership: {
          select: { user: { select: { id: true, lastName: true, firstName: true } } },
        },
      },
    });
  }

  /**
   * Enrolls a child, ending whatever active enrollment they already hold.
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
   *
   * ★★ Any school year, not just this one — corrected 2026-09-01.
   *
   * The lookup used to carry `schoolYearId: data.schoolYearId`, which matched
   * the partial unique index and read as if the index were the rule being
   * enforced. It is not: the index permits one ACTIVE row *per year*, so a move
   * into next year's group ended nothing and the child held two. `GET /groups`
   * is not filtered by year and the transfer form lists everything it returns,
   * so this was reachable from the screen, not merely in theory.
   *
   * Two ACTIVE enrollments have no meaning anywhere downstream. "The current
   * group" is `find(e => e.status === "ACTIVE")` in the child header, the
   * enrolment archive and the general-info panel, and with two rows each picks
   * whichever Postgres returned first. The funding register counts active
   * enrollments, so the child is billed twice.
   *
   * Enrolling a child in next year's group *in advance* is a real thing to want
   * and this is not it — that needs a start date in the future and a state that
   * says "not yet", neither of which exists. Until it does, the honest
   * behaviour is that enrolling a child moves them.
   */
  async enrollChild(data: {
    kindergartenId: string;
    childId: string;
    groupId: string;
    schoolYearId: string;
    startedOn: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      // `updateMany`, not `update`: a child may already hold more than one
      // ACTIVE row from before this was corrected, and closing one of them
      // would leave the other to collide with the row inserted below.
      await tx.enrollment.updateMany({
        where: { childId: data.childId, status: "ACTIVE", deletedAt: null },
        data: { status: "TRANSFERRED", endedOn: new Date() },
      });

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

  // ── Excel import — RFP §3.4 ────────────────────────────────────────────────

  /**
   * Every visible child, for the export — no pagination.
   *
   * ★ The one deliberate exception to CLAUDE.md §3.4's "every list is
   * paginated", and it is bounded in a different way: a hard cap, and the same
   * `visibleChildrenWhere` filter the paginated list uses.
   *
   * A roster export that stopped at page one would be worse than none — the
   * administrator would not notice, and would upload a truncated file back.
   * The cap is what keeps it from becoming an unbounded query; a kindergarten
   * past it has outgrown a single spreadsheet anyway.
   *
   * ★ 2000 here against the importer's 500 per upload is deliberate. The export
   * is for reading and for archiving, and truncating a roster silently is the
   * one thing it must not do; the import's lower cap is about how much work one
   * transaction should carry, and re-importing a large export is a rarer case
   * than exporting one. The importer says so explicitly when a file is too
   * long, rather than dropping the tail.
   */
  async listChildrenForExport(visible: VisibleChildrenFilter, filters: ChildFilters) {
    return this.prisma.child.findMany({
      where: this.childWhere(visible, filters),
      orderBy: childOrderBy({ sort: "name", order: "asc" }),
      take: 2000,
      select: {
        lastName: true,
        firstName: true,
        sex: true,
        dateOfBirth: true,
        nationalId: true,
        healthNotes: true,
        status: true,
        enrollments: {
          where: { status: "ACTIVE", deletedAt: null },
          select: { group: { select: { name: true } } },
          take: 1,
        },
      },
    });
  }

  /** The kindergarten's name, for the exported file's provenance sheet. */
  async kindergartenName(kindergartenId: string) {
    const row = await this.prisma.kindergarten.findFirst({
      where: { id: kindergartenId, deletedAt: null },
      select: { name: true },
    });

    return row?.name ?? "";
  }

  /** The kindergarten's groups, for resolving a spreadsheet's group names. */
  async groupsForImport(kindergartenId: string) {
    return this.prisma.group.findMany({
      where: { kindergartenId, deletedAt: null },
      select: { id: true, name: true, schoolYear: { select: { id: true } } },
    });
  }

  /**
   * The kindergarten's existing children, as the import's two identity keys.
   *
   * ★ One query for the whole file, not one per row — the N+1 CLAUDE.md §3.4
   * forbids, in a request an administrator is watching a spinner for.
   *
   * ★★ Returns name-and-birth-date as well as national ids, because a register
   * column is often empty in the files §3.4 describes. Matching on the id alone
   * meant exporting a roster and uploading it back duplicated every
   * register-less child. See `childKey`.
   */
  async existingChildKeys(kindergartenId: string) {
    const rows = await this.prisma.child.findMany({
      where: { kindergartenId, deletedAt: null },
      select: { lastName: true, firstName: true, dateOfBirth: true, nationalId: true },
    });

    const nationalIds = new Set<string>();
    const nameAndDate = new Set<string>();

    for (const row of rows) {
      if (row.nationalId) nationalIds.add(row.nationalId);

      if (row.dateOfBirth) {
        nameAndDate.add(
          childKey(row.lastName, row.firstName, row.dateOfBirth.toISOString().slice(0, 10)),
        );
      }
    }

    return { nationalIds, nameAndDate };
  }

  /**
   * Writes a whole import — every child, or none of them.
   *
   * ★ One transaction, deliberately.
   *
   * A roster half-loaded is worse than one not loaded at all: the
   * administrator cannot tell which rows landed, and re-uploading the file
   * collides with the half that did. All-or-nothing means the fix is always
   * "correct the spreadsheet and upload it again".
   *
   * ★★ Enrollment happens inside the same transaction rather than through
   * `enrollChild`, whose own transaction would nest. The interactive timeout is
   * raised because five hundred children is five hundred inserts plus their
   * enrollments, and the default 5 s is not generous for that on a cold
   * connection.
   */
  async importChildren(
    rows: {
      child: CreateChildData;
      groupId: string | null;
      schoolYearId: string | null;
    }[],
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const created: { id: string; lastName: string; firstName: string }[] = [];

        for (const row of rows) {
          const child = await tx.child.create({
            data: row.child,
            select: { id: true, lastName: true, firstName: true },
          });

          if (row.groupId && row.schoolYearId) {
            await tx.enrollment.create({
              data: {
                kindergartenId: row.child.kindergartenId,
                childId: child.id,
                groupId: row.groupId,
                schoolYearId: row.schoolYearId,
                startedOn: new Date(),
                status: "ACTIVE",
              },
            });
          }

          created.push(child);
        }

        return created;
      },
      { timeout: 30_000 },
    );
  }
}

export interface ChildFilters {
  status?: ChildStatus;
  groupId?: string;
  schoolYearId?: string;
  enrollmentStatus?: EnrollmentStatus;
  q?: string;
  sex?: Sex;
  /** Whole years, inclusive at both ends — RFP §11. */
  ageMin?: number;
  ageMax?: number;
  /**
   * An explicit set, ANDed with everything else rather than replacing it.
   *
   * Narrowing only: `childWhere` puts `visible` first, so ids the caller may
   * not see drop out instead of being fetched. See `listChildrenQuerySchema`.
   */
  ids?: string[];
}

export interface ChildSorting {
  sort: "name" | "dateOfBirth" | "age" | "updatedAt";
  order: "asc" | "desc";
}

export interface CreateChildData {
  kindergartenId: string;
  lastName: string;
  firstName: string;
  nationalId?: string | null;
  /** Гадаад иргэн — see the `isForeign` note on `model Child`. */
  isForeign?: boolean;
  foreignId?: string | null;
  sex: Sex;
  dateOfBirth: Date;
  healthNotes?: string | null;
}

export interface UpdateChildData {
  lastName?: string;
  firstName?: string;
  nationalId?: string | null;
  isForeign?: boolean;
  foreignId?: string | null;
  sex?: Sex;
  dateOfBirth?: Date;
  healthNotes?: string | null;
  status?: ChildStatus;
}
