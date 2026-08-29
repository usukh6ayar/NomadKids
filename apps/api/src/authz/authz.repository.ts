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

    return {
      teachingGroups: teaching.map((row) => row.group),
      guardianGroups: guarded.flatMap((row) => row.child.enrollments.map((e) => e.group)),
    };
  }

  /**
   * The names of the kindergartens the actor belongs to.
   *
   * Only the staff room needs one, and only to disambiguate for somebody with
   * memberships in two — see `roomsFor`. One query over ids the actor already
   * carries, so it discloses nothing their memberships do not.
   */
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
