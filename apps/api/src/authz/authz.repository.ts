import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Actor, ActorMembership } from "./actor";
import { teacherMembershipIds } from "./actor";
import type { ChildAccessFacts } from "./child-access";
import type { ChatAccessFacts } from "./chat-access";

/**
 * Loads the facts authorization decisions are made from.
 *
 * A repository, so it may touch Prisma — CLAUDE.md §2.2. It contains no
 * decisions: it fetches rows and hands them to the pure functions in
 * `child-access.ts`. Keeping the two apart is what lets the rules be tested
 * exhaustively without a database.
 */
@Injectable()
export class AuthzRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The actor's active memberships. Read on every authenticated request rather
   * than baked into the JWT, so revoking a role takes effect immediately.
   */
  async loadMemberships(userId: string): Promise<ActorMembership[]> {
    const rows = await this.prisma.membership.findMany({
      where: { userId, isActive: true, deletedAt: null },
      select: { id: true, kindergartenId: true, role: true },
    });
    return rows;
  }

  /**
   * Everything needed to decide access to one child.
   *
   * Returns `null` when the child does not exist or is soft-deleted — the
   * caller turns that into the same 404 an unauthorized child produces, so the
   * two are indistinguishable. docs/SECURITY.md §5.4.
   *
   * One round trip: the child, its enrollments and guardianships come back
   * together, and the actor's teaching assignments are a second query only when
   * the actor actually holds a teacher membership.
   */
  async loadChildAccessFacts(actor: Actor, childId: string): Promise<ChildAccessFacts | null> {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, deletedAt: null },
      select: {
        id: true,
        kindergartenId: true,
        enrollments: {
          where: { deletedAt: null },
          select: { groupId: true, kindergartenId: true },
        },
        guardianships: {
          where: { deletedAt: null },
          select: { guardianUserId: true, canView: true },
        },
      },
    });

    if (!child) return null;

    return {
      childId: child.id,
      childKindergartenId: child.kindergartenId,
      enrollments: child.enrollments,
      guardianships: child.guardianships,
      actorActiveTeachingGroupIds: await this.loadActiveTeachingGroupIds(actor),
    };
  }

  /**
   * Groups the actor is *currently* assigned to teach.
   *
   * `endedOn: null` is the revocation mechanism: ending an assignment removes
   * the group from this list, and with it the teacher's access — while the
   * GroupTeacher row survives so historical attribution still works.
   */
  /**
   * Whether this child has a paid, unexpired portal subscription.
   *
   * ★ Called only when a fee is configured — `ChildAccessService` checks that
   * first, so the default deployment (`ACCESS_FEE_AMOUNT=0`) adds no query to
   * the hottest authorization path in the product.
   */
  async loadPortalAccessActive(childId: string, asOf: Date): Promise<boolean> {
    const row = await this.prisma.accessSubscription.findFirst({
      where: {
        childId,
        deletedAt: null,
        status: "ACTIVE",
        expiresAt: { gte: asOf },
      },
      select: { id: true },
    });
    return row !== null;
  }

  async loadActiveTeachingGroupIds(actor: Actor): Promise<string[]> {
    const membershipIds = teacherMembershipIds(actor);
    if (membershipIds.length === 0) return [];

    const rows = await this.prisma.groupTeacher.findMany({
      where: {
        membershipId: { in: membershipIds },
        endedOn: null,
        deletedAt: null,
        group: { deletedAt: null },
      },
      select: { groupId: true },
    });
    return [...new Set(rows.map((r) => r.groupId))];
  }

  /**
   * Child ids the actor may see, as a WHERE fragment rather than a list.
   *
   * Returning a filter instead of ids keeps list endpoints to one query and
   * avoids loading every child id into memory to build an `IN (...)`.
   */
  /**
   * How many of these children are actively enrolled in one of these groups.
   *
   * ★ One query for the whole list, not one per child.
   *
   * A notice may name up to fifty children, and the question "are all of these
   * in a group I teach" asked child by child is fifty round trips inside a
   * request somebody is waiting on (§3.4). The caller compares this against
   * `new Set(childIds).size` — anything short means at least one child is
   * outside the teacher's groups, and it does not need to know which.
   *
   * ★★ `status: "ACTIVE"`, like every other "which group is this child in
   * today" read. `child-access.ts` deliberately reads enrolment *history* for
   * authorization; this is not that question — a teacher does not gain the
   * right to write to a family because the child was in their group last year.
   */
  async countChildrenEnrolledInGroups(childIds: string[], groupIds: string[]): Promise<number> {
    if (childIds.length === 0 || groupIds.length === 0) return 0;

    const rows = await this.prisma.child.findMany({
      where: {
        id: { in: childIds },
        deletedAt: null,
        enrollments: { some: { groupId: { in: groupIds }, status: "ACTIVE", deletedAt: null } },
      },
      select: { id: true },
    });

    return rows.length;
  }

  async visibleChildrenWhere(actor: Actor): Promise<VisibleChildrenFilter> {
    const teachingGroupIds = await this.loadActiveTeachingGroupIds(actor);
    const adminKindergartenIds = actor.memberships
      .filter((m) => m.role === "ADMIN")
      .map((m) => m.kindergartenId);

    return {
      deletedAt: null,
      OR: [
        // Guardian chain.
        {
          guardianships: {
            some: { guardianUserId: actor.userId, canView: true, deletedAt: null },
          },
        },
        // Teacher chain — via enrollment history, so a transferred child stays
        // reachable to the teacher who taught them.
        ...(teachingGroupIds.length > 0
          ? [
              {
                enrollments: {
                  some: { groupId: { in: teachingGroupIds }, deletedAt: null },
                },
              },
            ]
          : []),
        // Admin chain, in two parts that must together mirror
        // `childKindergartenIds` exactly.
        ...(adminKindergartenIds.length > 0
          ? [
              // History is authoritative when any live enrollment exists.
              {
                enrollments: {
                  some: { kindergartenId: { in: adminKindergartenIds }, deletedAt: null },
                },
              },
              // The fallback: a child with NO live enrollments resolves to the
              // denormalised column.
              //
              // `none` must carry `deletedAt: null` for the same reason `some`
              // does. Without it, a child whose only enrollment is soft-deleted
              // counts as "has enrollments" here but as "has none" in
              // loadChildAccessFacts — which filters deleted rows out. The
              // result was a child reachable by URL but absent from the list.
              // Caught by test/authz-consistency.test.ts, which exists to keep
              // these two definitions of "no enrollments" identical.
              {
                kindergartenId: { in: adminKindergartenIds },
                enrollments: { none: { deletedAt: null } },
              },
            ]
          : []),
      ],
    };
  }

  /**
   * Child ids a kindergarten's finance staff may invoice, as the same kind of
   * WHERE fragment `visibleChildrenWhere` returns.
   *
   * ★ Kept separate rather than folded into `visibleChildrenWhere`, the same
   * way `canViewChildFinance` (child-access.ts) is kept apart from
   * `canAccessChild`: нэмэлт.md §13 gives an accountant every child's invoice
   * and no developmental record, so widening the general roster filter to
   * admit them would leak the wrong axis of access into `GET /children` and
   * every screen built on it. This is that predicate's list-shaped twin.
   *
   * ★★ Takes `kindergartenId` directly rather than deriving it from the
   * actor's memberships. The one caller, `ChildrenService.financeRoster`, has
   * already run `TenantAccessService.assertCanReadFinance` for this exact
   * kindergarten, so there is nothing left to decide except *which children* —
   * the same enrollment-history-plus-fallback shape the admin chain above
   * uses, mirrored here for one kindergarten instead of a list of them.
   */
  visibleChildrenForFinanceWhere(kindergartenId: string): VisibleChildrenFilter {
    return {
      deletedAt: null,
      OR: [
        // History is authoritative when any live enrollment exists.
        {
          enrollments: {
            some: { kindergartenId, deletedAt: null },
          },
        },
        // The fallback: a child with NO live enrollments resolves to the
        // denormalised column — same D8 exception `visibleChildrenWhere`'s
        // admin chain applies, and `deletedAt: null` on `none` for the same
        // reason: a soft-deleted-only enrollment must not count as "has one".
        {
          kindergartenId,
          enrollments: { none: { deletedAt: null } },
        },
      ],
    };
  }

  /**
   * The groups this actor teaches, and the groups their children are in.
   *
   * ★ Two queries, both scoped to the actor, neither reaching for a room.
   *
   * `GroupTeacher` gives the teaching side: active assignments only
   * (`endedOn IS NULL`), restricted to groups that are not soft-deleted.
   * `Guardianship` → `Child` → `Enrollment` gives the family side, and it is
   * restricted to **ACTIVE** enrollments — `chat-access.ts` explains why a
   * room reads current membership where child access reads history.
   *
   * A guardian whose `canView` is false is excluded, matching `isGuardianOf`:
   * a person who may not see the child may not sit in their group's room.
   */
  async loadChatAccessFacts(actor: Actor): Promise<ChatAccessFacts> {
    const membershipIds = teacherMembershipIds(actor);

    const [teaching, guarded] = await Promise.all([
      /*
        ★ Scoped by `membershipId`, not by `userId` — `GroupTeacher` has no
        user column. `teacherMembershipIds` is what narrows it to the actor's
        *teacher* memberships, so an admin membership in the same kindergarten
        does not silently widen the set. `loadActiveTeachingGroupIds` above
        does exactly this and this mirrors it deliberately: two definitions of
        "groups I teach" that could drift is the thing to avoid.
      */
      membershipIds.length === 0
        ? Promise.resolve([])
        : this.prisma.groupTeacher.findMany({
            where: {
              membershipId: { in: membershipIds },
              endedOn: null,
              deletedAt: null,
              group: { deletedAt: null },
            },
            select: { group: { select: { id: true, name: true, kindergartenId: true } } },
          }),
      this.prisma.guardianship.findMany({
        where: {
          guardianUserId: actor.userId,
          canView: true,
          deletedAt: null,
          child: { deletedAt: null },
        },
        select: {
          child: {
            select: {
              enrollments: {
                where: { status: "ACTIVE", deletedAt: null, group: { deletedAt: null } },
                select: { group: { select: { id: true, name: true, kindergartenId: true } } },
              },
            },
          },
        },
      }),
    ]);

    const teachingGroups = teaching.map((row) => row.group);
    const guardianGroups = guarded.flatMap((row) => row.child.enrollments.map((e) => e.group));

    return {
      teachingGroups,
      guardianGroups,
      directPeers: await this.loadDirectPeers(actor, teachingGroups, guardianGroups),
    };
  }

  /**
   * Who this actor may hold a private conversation with — 2026-09-20's «эцэг эх
   * багш руу хувиараа бичих».
   *
   * ★ **Both directions from the same two queries**, and the symmetry is not a
   * coincidence to be maintained: a guardian's peers are the teachers of the
   * groups their children are in, a teacher's peers are the guardians of the
   * children in the groups they teach, and both are read off the groups
   * computed just above. If A appears for B then B appears for A, which is
   * what lets one sorted `roomKey` serve both sides.
   *
   * ★★ The actor is excluded from their own list. A teacher who is also a
   * parent in a group they teach would otherwise find themselves in it, and
   * `DIRECT_ROOM(x, x)` is a room with one member.
   *
   * ★★★ Scoped to the group, not to the kindergarten. A parent may write to
   * their own child's teachers and to nobody else's — the client's answer when
   * asked, and the narrower of the two readings. Widening it later is a change
   * to this method and to nothing else.
   */
  private async loadDirectPeers(
    actor: Actor,
    teachingGroups: readonly { id: string; kindergartenId: string }[],
    guardianGroups: readonly { id: string; kindergartenId: string }[],
  ): Promise<{ userId: string; name: string; kindergartenId: string }[]> {
    const kindergartenOf = new Map<string, string>();
    for (const group of [...teachingGroups, ...guardianGroups]) {
      kindergartenOf.set(group.id, group.kindergartenId);
    }

    const guardianGroupIds = guardianGroups.map((group) => group.id);
    const teachingGroupIds = teachingGroups.map((group) => group.id);

    const [teachersOfMyChildren, guardiansOfMyPupils] = await Promise.all([
      guardianGroupIds.length === 0
        ? Promise.resolve([])
        : this.prisma.groupTeacher.findMany({
            where: {
              groupId: { in: guardianGroupIds },
              endedOn: null,
              deletedAt: null,
              membership: { deletedAt: null, isActive: true },
            },
            select: {
              groupId: true,
              membership: {
                select: {
                  user: { select: { id: true, lastName: true, firstName: true } },
                },
              },
            },
          }),
      teachingGroupIds.length === 0
        ? Promise.resolve([])
        : this.prisma.guardianship.findMany({
            where: {
              canView: true,
              deletedAt: null,
              child: {
                deletedAt: null,
                enrollments: {
                  some: { groupId: { in: teachingGroupIds }, status: "ACTIVE", deletedAt: null },
                },
              },
            },
            select: {
              guardian: { select: { id: true, lastName: true, firstName: true } },
              child: {
                select: {
                  enrollments: {
                    where: { groupId: { in: teachingGroupIds }, status: "ACTIVE", deletedAt: null },
                    select: { groupId: true },
                  },
                },
              },
            },
          }),
    ]);

    const peers = new Map<string, { userId: string; name: string; kindergartenId: string }>();

    const add = (
      user: { id: string; lastName: string; firstName: string },
      groupId: string | undefined,
    ) => {
      const kindergartenId = groupId ? kindergartenOf.get(groupId) : undefined;
      if (!kindergartenId || user.id === actor.userId || peers.has(user.id)) return;
      peers.set(user.id, {
        userId: user.id,
        name: `${user.lastName} ${user.firstName}`.trim(),
        kindergartenId,
      });
    };

    for (const row of teachersOfMyChildren) {
      add(row.membership.user, row.groupId);
    }
    for (const row of guardiansOfMyPupils) {
      add(row.guardian, row.child.enrollments[0]?.groupId);
    }

    return [...peers.values()];
  }

  /**
   * The names of the kindergartens the actor belongs to.
   *
   * Only the staff room needs one, and only to disambiguate for somebody with
   * memberships in two — see `roomsFor`. One query over ids the actor already
   * carries, so it discloses nothing their memberships do not.
   */
  /**
   * Every kindergarten the actor is a member of, by name — the desktop top
   * bar's «БЗД 115-р цэцэрлэг» (2026-09-26).
   *
   * ★ Not `loadKindergartenNames`, which returns nothing below two memberships
   * on purpose: it exists to disambiguate chat rooms, where one kindergarten
   * needs no name. The top bar needs the name precisely when there is one.
   */
  async loadOwnKindergartens(actor: Actor): Promise<{ id: string; name: string }[]> {
    const ids = [...new Set(actor.memberships.map((m) => m.kindergartenId))];
    if (ids.length === 0) return [];
    return this.prisma.kindergarten.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  async loadKindergartenNames(actor: Actor): Promise<Record<string, string | undefined>> {
    const ids = [...new Set(actor.memberships.map((m) => m.kindergartenId))];
    if (ids.length < 2) return {};

    const rows = await this.prisma.kindergarten.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return Object.fromEntries(rows.map((row) => [row.id, row.name]));
  }
}

/** Shape of the generated `where` fragment. Loose by necessity — it is spread. */
export interface VisibleChildrenFilter {
  deletedAt: null;
  OR: Record<string, unknown>[];
}
