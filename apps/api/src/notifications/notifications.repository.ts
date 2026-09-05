import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { NotificationCategory } from "../domain/enums";
import { toSkipTake, type PageParams } from "../common/pagination";
import { searchWhere } from "../common/repository/search";

/**
 * Announcements, their targeting, and read receipts.
 *
 * ★ The audience question — "which announcements is this family entitled to
 * see?" — is answered in one place, `guardianWhere`. §8.1 allows a notice to be
 * aimed at groups, at individual children, or at nobody in particular (the
 * whole kindergarten), and the third case is expressed as **having no target
 * rows** rather than a nullable flag. A flag can go stale when a target is
 * added later; the absence of rows cannot.
 */
@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What a guardian may see.
   *
   * ★ The scope is derived from **their own children** — their groups, their
   * child ids, their kindergartens — not from their memberships. That is what
   * makes it impossible for a family to be reached by a notice about a child
   * they are not connected to, whatever the targeting rows say.
   *
   * `PUBLISHED` and inside its date window. A draft is the author's.
   */
  guardianWhere(scope: GuardianScope, now: Date) {
    return {
      deletedAt: null,
      status: "PUBLISHED" as const,
      kindergartenId: { in: scope.kindergartenIds },
      AND: [
        { OR: [{ startsOn: null }, { startsOn: { lte: now } }] },
        { OR: [{ endsOn: null }, { endsOn: { gte: now } }] },
        {
          OR: [
            { targets: { some: { groupId: { in: scope.groupIds }, deletedAt: null } } },
            { targets: { some: { childId: { in: scope.childIds }, deletedAt: null } } },
            // Whole kindergarten: no targets at all.
            { targets: { none: {} } },
          ],
        },
      ],
    };
  }

  /** Staff see published notices in their kindergartens, plus their own drafts. */
  staffWhere(kindergartenIds: string[], userId: string) {
    return {
      deletedAt: null,
      kindergartenId: { in: kindergartenIds },
      OR: [{ status: "PUBLISHED" as const }, { authorId: userId }],
    };
  }

  async list(
    where: Record<string, unknown>,
    userId: string,
    page: PageParams,
    unreadOnly: boolean,
    q?: string,
    filters: {
      /** One group's board — RFP §8.1's targeting, read back. See below. */
      groupId?: string;
      category?: NotificationCategory;
      from?: Date;
      to?: Date;
    } = {},
  ) {
    const { skip, take } = toSkipTake(page);

    // Same composition `unreadOnly` already used: extra conditions folded into
    // one `AND` alongside the audience filter, never replacing it — a search
    // term must narrow what this actor may see, not widen it.
    const extra: Record<string, unknown>[] = [];
    if (unreadOnly) extra.push({ reads: { none: { userId } } });
    /*
     * One group's board — the notices aimed at it, plus the ones aimed at
     * nobody in particular.
     *
     * ★ `none: { deletedAt: null }` is how "aimed at everyone" is asked for.
     *
     * This module's convention is that a notice with no live target rows is
     * for the whole kindergarten (`targetSchema`), so a group's board is the
     * union of the two. Written as `some OR none` rather than as a computed
     * flag on the notice, because the flag would be a second copy of the same
     * fact and could disagree with the rows the moment a target is added.
     */
    if (filters.groupId) {
      extra.push({
        OR: [
          { targets: { some: { groupId: filters.groupId, deletedAt: null } } },
          { targets: { none: { deletedAt: null } } },
        ],
      });
    }
    const search = searchWhere(q, ["title", "body"]);
    if (search) extra.push(search);
    // One kind of notice. A plain equality rather than the group filter's
    // `some OR none` — a category is a column on the notice itself, so there
    // is no "aimed at nobody" case to fold in.
    if (filters.category) extra.push({ category: filters.category });

    /*
      The range reads `publishedAt` — see the query DTO's note. `to` is
      inclusive of its whole day: a parent choosing 2026-08-30 as the end means
      "up to and including the 30th", and `lte` against a bare date would stop
      at midnight and silently drop everything posted that day.
    */
    if (filters.from) extra.push({ publishedAt: { gte: filters.from } });
    if (filters.to) {
      const endOfDay = new Date(filters.to);
      endOfDay.setUTCHours(23, 59, 59, 999);
      extra.push({ publishedAt: { lte: endOfDay } });
    }

    const finalWhere = extra.length > 0 ? { AND: [where, ...extra] } : where;

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: finalWhere,
        orderBy: [{ isImportant: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
        skip,
        take,
        include: {
          author: { select: { id: true, lastName: true, firstName: true } },
          // Only this user's receipt, so the response says "have I read it"
          // rather than listing everyone who has.
          reads: { where: { userId }, select: { readAt: true } },
          // The count everyone sees, and this user's own reaction — never the
          // list of who liked it. A parent should not learn which other
          // families are reading the board.
          reactions: { where: { userId, deletedAt: null }, select: { id: true } },
          _count: { select: { reactions: { where: { deletedAt: null } } } },
          media: {
            where: { deletedAt: null, status: "READY" },
            orderBy: { order: "asc" },
            select: { id: true, caption: true, width: true, height: true },
          },
          targets: {
            where: { deletedAt: null },
            select: {
              groupId: true,
              childId: true,
              group: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.notification.count({ where: finalWhere }),
    ]);

    return { items, total };
  }

  async countUnread(where: Record<string, unknown>, userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { AND: [where, { reads: { none: { userId } } }] },
    });
  }

  async findReadable(id: string, where: Record<string, unknown>, userId: string) {
    return this.prisma.notification.findFirst({
      where: { AND: [where, { id }] },
      include: {
        author: { select: { id: true, lastName: true, firstName: true } },
        reads: { where: { userId }, select: { readAt: true } },
        reactions: { where: { userId, deletedAt: null }, select: { id: true } },
        _count: { select: { reactions: { where: { deletedAt: null } } } },
        media: {
          where: { deletedAt: null, status: "READY" },
          orderBy: { order: "asc" },
          select: { id: true, caption: true, width: true, height: true },
        },
        targets: {
          where: { deletedAt: null },
          select: {
            groupId: true,
            childId: true,
            group: { select: { id: true, name: true } },
            child: { select: { id: true, lastName: true, firstName: true } },
          },
        },
      },
    });
  }

  /** Raw row for authorization — no audience filter. */
  async findForAuthorization(id: string) {
    return this.prisma.notification.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, kindergartenId: true, authorId: true, status: true },
    });
  }

  async create(
    data: {
      kindergartenId: string;
      /** Null when the author wrote a body and no heading — see the DTO. */
      title: string | null;
      category: NotificationCategory;
      body: string;
      isImportant: boolean;
      startsOn: Date | null;
      endsOn: Date | null;
      authorId: string;
    },
    targets: { groupId?: string; childId?: string }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const notification = await tx.notification.create({ data });

      if (targets.length > 0) {
        await tx.notificationTarget.createMany({
          data: targets.map((t) => ({
            kindergartenId: data.kindergartenId,
            notificationId: notification.id,
            groupId: t.groupId ?? null,
            childId: t.childId ?? null,
          })),
        });
      }

      return notification;
    });
  }

  async update(
    id: string,
    data: Record<string, unknown>,
    targets?: { groupId?: string; childId?: string }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const notification = await tx.notification.update({ where: { id }, data });

      // Replace rather than merge — the form sends the complete audience, so a
      // removed group must actually disappear.
      if (targets) {
        await tx.notificationTarget.deleteMany({ where: { notificationId: id } });
        if (targets.length > 0) {
          await tx.notificationTarget.createMany({
            data: targets.map((t) => ({
              kindergartenId: notification.kindergartenId,
              notificationId: id,
              groupId: t.groupId ?? null,
              childId: t.childId ?? null,
            })),
          });
        }
      }

      return notification;
    });
  }

  async publish(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
  }

  async softDelete(id: string) {
    return this.prisma.notification.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Idempotent: reading twice is not an error, and must not duplicate. */
  async markRead(notificationId: string, userId: string) {
    return this.prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId, userId } },
      create: { notificationId, userId },
      update: {},
    });
  }

  /**
   * Likes or un-likes, in one statement.
   *
   * ★ An upsert, not an insert-or-delete. The unique pair means a second like
   * from the same person must update the row that already exists — and because
   * un-liking soft-deletes rather than removing, that row is still there. A
   * plain create would fail on the constraint the moment anyone changed their
   * mind twice.
   */
  async setReaction(input: {
    notificationId: string;
    userId: string;
    kindergartenId: string;
    liked: boolean;
  }) {
    const { notificationId, userId, kindergartenId, liked } = input;
    const deletedAt = liked ? null : new Date();

    return this.prisma.notificationReaction.upsert({
      where: { notificationId_userId: { notificationId, userId } },
      create: { notificationId, userId, kindergartenId, deletedAt },
      update: { deletedAt },
    });
  }

  /**
   * The audience scope for a guardian: their children, those children's active
   * groups, and the kindergartens they attend.
   */
  async loadGuardianScope(userId: string): Promise<GuardianScope> {
    const children = await this.prisma.child.findMany({
      where: {
        deletedAt: null,
        guardianships: { some: { guardianUserId: userId, canView: true, deletedAt: null } },
      },
      select: {
        id: true,
        enrollments: {
          where: { deletedAt: null },
          select: { groupId: true, kindergartenId: true, status: true },
        },
      },
    });

    const childIds = children.map((c) => c.id);
    const groupIds = new Set<string>();
    const kindergartenIds = new Set<string>();

    for (const child of children) {
      for (const enrollment of child.enrollments) {
        kindergartenIds.add(enrollment.kindergartenId);
        // Only ACTIVE enrollments contribute a group: a notice to last year's
        // group is not for this family any more.
        if (enrollment.status === "ACTIVE") groupIds.add(enrollment.groupId);
      }
    }

    return {
      childIds,
      groupIds: [...groupIds],
      kindergartenIds: [...kindergartenIds],
    };
  }

  async findGroupsInKindergarten(groupIds: string[], kindergartenId: string): Promise<number> {
    if (groupIds.length === 0) return 0;
    return this.prisma.group.count({
      where: { id: { in: groupIds }, kindergartenId, deletedAt: null },
    });
  }

  async findChildrenInKindergarten(childIds: string[], kindergartenId: string): Promise<number> {
    if (childIds.length === 0) return 0;
    return this.prisma.child.count({
      where: {
        id: { in: childIds },
        deletedAt: null,
        OR: [
          { enrollments: { some: { kindergartenId, deletedAt: null } } },
          { kindergartenId, enrollments: { none: { deletedAt: null } } },
        ],
      },
    });
  }
}

export interface GuardianScope {
  childIds: string[];
  groupIds: string[];
  kindergartenIds: string[];
}
