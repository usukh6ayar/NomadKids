import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Room } from "../authz/chat-access";

/**
 * The only layer that may touch Prisma for chat — CLAUDE.md §2.2.
 *
 * ★ Every method takes rooms the caller has **already** authorized.
 *
 * There is no `findRoom(key)` here, deliberately. A repository method that
 * accepted a raw key would be one call site away from reading a room the actor
 * is not in, and §2.2's own note says the reason the rule matters is that
 * Prisma has no tenant scoping of its own. `ChatAccessService` resolves keys;
 * this file only ever sees the results.
 */
@Injectable()
export class ChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The base filter every read extends and none replaces — §2.2. */
  private readonly visible = { deletedAt: null } as const;

  /**
   * The newest message in each of several rooms, in one query.
   *
   * ★ `distinct` on `roomKey` with a descending sort, not N queries.
   *
   * The room list renders a preview line per room, and a teacher can be in
   * half a dozen — one query per room is the N+1 §3.4 forbids, moved to the
   * service layer where the rule reads as if it does not apply.
   */
  async lastMessagePerRoom(roomKeys: string[]) {
    if (roomKeys.length === 0) return [];

    return this.prisma.chatMessage.findMany({
      where: { ...this.visible, roomKey: { in: roomKeys } },
      distinct: ["roomKey"],
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        roomKey: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, lastName: true, firstName: true, photoMediaFileId: true } },
      },
    });
  }

  /** This reader's cursor in each room. Absent means "has never opened it". */
  async readCursors(userId: string, roomKeys: string[]) {
    if (roomKeys.length === 0) return [];

    return this.prisma.chatRead.findMany({
      where: { userId, roomKey: { in: roomKeys } },
      select: { roomKey: true, lastReadAt: true },
    });
  }

  /**
   * Unread counts, one query for every room at once.
   *
   * `groupBy` rather than a count per room, for the reason above. A room the
   * reader has never opened has no cursor, so its whole history counts — which
   * is why the caller passes `null` for those rather than omitting them.
   */
  async unreadCounts(rooms: { roomKey: string; since: Date | null }[]) {
    if (rooms.length === 0) return new Map<string, number>();

    const rows = await this.prisma.chatMessage.groupBy({
      by: ["roomKey"],
      where: {
        ...this.visible,
        OR: rooms.map(({ roomKey, since }) => ({
          roomKey,
          ...(since ? { createdAt: { gt: since } } : {}),
        })),
      },
      _count: { _all: true },
    });

    return new Map(rows.map((row) => [row.roomKey, row._count._all]));
  }

  /**
   * One room's history, newest first.
   *
   * ★ Cursor paginated, never unbounded — §3.4. A room that has run for a year
   * is thousands of rows, and `take` without a ceiling is how a list endpoint
   * becomes a denial of service against your own API.
   */
  async listMessages(roomKey: string, opts: { before?: Date; take: number }) {
    return this.prisma.chatMessage.findMany({
      where: {
        ...this.visible,
        roomKey,
        ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: opts.take,
      select: {
        id: true,
        roomKey: true,
        body: true,
        createdAt: true,
        authorId: true,
        author: { select: { id: true, lastName: true, firstName: true, photoMediaFileId: true } },
      },
    });
  }

  async createMessage(input: { room: Room; authorId: string; body: string }) {
    const { room, authorId, body } = input;

    return this.prisma.chatMessage.create({
      data: {
        kindergartenId: room.kindergartenId,
        kind: room.kind,
        groupId: room.groupId,
        roomKey: room.key,
        authorId,
        body,
      },
      select: {
        id: true,
        roomKey: true,
        body: true,
        createdAt: true,
        authorId: true,
        author: { select: { id: true, lastName: true, firstName: true, photoMediaFileId: true } },
      },
    });
  }

  /**
   * Move this reader's cursor to now.
   *
   * `upsert` on the `(userId, roomKey)` unique index — the constraint is what
   * makes "mark read twice at once" impossible rather than merely unlikely.
   */
  async markRead(input: { userId: string; room: Room; at: Date }) {
    const { userId, room, at } = input;

    await this.prisma.chatRead.upsert({
      where: { userId_roomKey: { userId, roomKey: room.key } },
      create: {
        userId,
        roomKey: room.key,
        kindergartenId: room.kindergartenId,
        lastReadAt: at,
      },
      update: { lastReadAt: at },
    });
  }

  /**
   * How many people can see each room — the list's "24 гишүүн".
   *
   * ★ Counted from the same relations that decide membership, never from a
   * roster table. A staff room is every active teacher and admin of the
   * kindergarten; a group room is its assigned teachers plus the guardians of
   * its currently enrolled children, deduplicated by user.
   */
  async memberCounts(rooms: Room[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();

    for (const room of rooms) {
      if (room.kind === "STAFF") {
        counts.set(
          room.key,
          await this.prisma.membership.count({
            where: {
              kindergartenId: room.kindergartenId,
              isActive: true,
              deletedAt: null,
              role: { in: ["TEACHER", "ADMIN"] },
            },
          }),
        );
        continue;
      }

      const [teachers, guardians] = await Promise.all([
        this.prisma.groupTeacher.findMany({
          where: { groupId: room.groupId!, endedOn: null, deletedAt: null },
          select: { membership: { select: { userId: true } } },
        }),
        this.prisma.guardianship.findMany({
          where: {
            canView: true,
            deletedAt: null,
            child: {
              deletedAt: null,
              enrollments: { some: { groupId: room.groupId!, status: "ACTIVE", deletedAt: null } },
            },
          },
          select: { guardianUserId: true },
        }),
      ]);

      const people = new Set<string>([
        ...teachers.map((t) => t.membership.userId),
        ...guardians.map((g) => g.guardianUserId),
      ]);
      counts.set(room.key, people.size);
    }

    return counts;
  }
}
