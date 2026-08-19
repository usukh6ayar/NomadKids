import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Actor, ActorMembership } from "./actor";
import { teacherMembershipIds } from "./actor";
import type { ChildAccessFacts } from "./child-access";

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
}

/** Shape of the generated `where` fragment. Loose by necessity — it is spread. */
export interface VisibleChildrenFilter {
  deletedAt: null;
  OR: Record<string, unknown>[];
}
