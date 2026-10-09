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
   * A message's photographs, in attachment order.
   *
   * ★ `deletedAt: null` here too. A soft-deleted `MediaFile` is gone from
   * every other surface in the product, and a chat bubble that kept drawing
   * one would be the single place a deleted photograph still renders.
   *
   * ★★ Included in the message `select` rather than fetched per message —
   * §3.4. A page is thirty messages, and a query each would be thirty round
   * trips to draw one screen.
   */
  private readonly mediaSelect = {
    where: { deletedAt: null },
    orderBy: { order: "asc" },
    select: {
      id: true,
      width: true,
      height: true,
      mimeType: true,
      status: true,
      durationSec: true,
    },
  } as const;

  /**
   * How many of a message's attachments have expired — the bubble says
   * "removed after seven days" rather than silently showing less than was
   * sent. A count in the same query, so a page stays one round trip (§3.4).
   */
  private readonly expiredCount = {
    select: { media: { where: { status: "EXPIRED" as const } } },
  };

  /**
   * The children a room's guardian authors are there for — «эцэг эхийн
   * мессежийг хүүхдийн нэрээр» (client, 2026-09-25).
   *
   * ★ Scoped to the room: a group or parents' room names only the children
   * actively enrolled in **that** group, so a family with two children in two
   * groups is named by the right one in each. A direct room is scoped to the
   * groups the reader shares with the author — `childScopeFor` decides which,
   * and an empty list names nobody. One query for a whole page of messages
   * (§3.4); bounded by the page's authors.
   */
  async guardianChildren(
    authorIds: string[],
    scope: { kindergartenId: string; groupIds: string[] },
  ) {
    if (authorIds.length === 0 || scope.groupIds.length === 0) return [];
    return this.prisma.guardianship.findMany({
      where: {
        deletedAt: null,
        kindergartenId: scope.kindergartenId,
        guardianUserId: { in: authorIds },
        child: {
          deletedAt: null,
          enrollments: {
            some: {
              status: "ACTIVE",
              deletedAt: null,
              groupId: { in: scope.groupIds },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: {
        guardianUserId: true,
        relation: true,
        child: { select: { id: true, lastName: true, firstName: true, photoMediaFileId: true } },
      },
    });
  }

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
        /*
         * ★ A count, not the rows. The preview line needs to know only *that*
         * the newest message carried photographs — a message may now be a
         * picture with no text at all, and without this the room list drew an
         * unread badge above an empty line.
         *
         * `_count` is one aggregate in the same query, so the room list keeps
         * its fixed number of queries for any number of rooms (§3.4).
         */
        _count: { select: { media: { where: { deletedAt: null } } } },
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
        media: this.mediaSelect,
        _count: this.expiredCount,
      },
    });
  }

  /**
   * A message and its photographs, in one transaction.
   *
   * ★ The bytes are already in the bucket by the time this runs — see
   * `ChatService.send`. Storage first, database second, deliberately: a
   * failure here leaves objects nobody points at, which are unreachable
   * because `storageKey` is a random UUID. The other order leaves rows
   * pointing at objects that were never written, which is a broken image in a
   * parent's chat for as long as the message exists.
   *
   * ★★ `kindergartenId` on every media row, from the room — §3.1. It is
   * reachable through the message, and denormalised anyway so that one filter
   * enforces the isolation.
   */
  async createMessage(input: {
    room: Room;
    authorId: string;
    body: string;
    media?: {
      storageKey: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      width: number | null;
      height: number | null;
      /** `PROCESSING` for a raw video waiting for the transcoder. */
      status?: "READY" | "PROCESSING";
    }[];
  }) {
    const { room, authorId, body, media = [] } = input;

    return this.prisma.chatMessage.create({
      data: {
        kindergartenId: room.kindergartenId,
        kind: room.kind,
        groupId: room.groupId,
        roomKey: room.key,
        authorId,
        body,
        media: {
          create: media.map((file, index) => ({
            kindergartenId: room.kindergartenId,
            purpose: "CHAT_MESSAGE" as const,
            order: index,
            storageKey: file.storageKey,
            originalName: file.originalName,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            width: file.width,
            height: file.height,
            status: file.status ?? "READY",
            uploadedById: authorId,
          })),
        },
      },
      select: {
        id: true,
        roomKey: true,
        body: true,
        createdAt: true,
        authorId: true,
        author: { select: { id: true, lastName: true, firstName: true, photoMediaFileId: true } },
        media: this.mediaSelect,
        _count: this.expiredCount,
      },
    });
  }

  // ── Video ──────────────────────────────────────────────────────────────────

  /**
   * Bytes of chat video currently held, across the deployment — the budget
   * `CHAT_VIDEO_STORAGE_BUDGET_MB` is checked against. Deliberately not tenant
   * scoped: the disk is shared, so the ceiling is too. An aggregate, never rows.
   */
  async liveVideoBytes(): Promise<number> {
    const result = await this.prisma.mediaFile.aggregate({
      where: {
        purpose: "CHAT_MESSAGE",
        deletedAt: null,
        status: { in: ["READY", "PROCESSING"] },
        mimeType: { startsWith: "video/" },
      },
      _sum: { sizeBytes: true },
    });
    return result._sum.sizeBytes ?? 0;
  }

  /** A raw video for the transcoder, only while it is still waiting. */
  async findPendingVideo(mediaId: string) {
    return this.prisma.mediaFile.findFirst({
      where: { id: mediaId, purpose: "CHAT_MESSAGE", status: "PROCESSING", deletedAt: null },
      select: { id: true, storageKey: true, originalName: true },
    });
  }

  /**
   * The transcoded file replaces the raw one on the same row. `status` in the
   * filter, so a row the sweep expired in the meantime is left alone and the
   * caller learns it from the count.
   */
  async finishVideo(
    mediaId: string,
    data: {
      storageKey: string;
      originalName: string;
      sizeBytes: number;
      width: number;
      height: number;
      durationSec: number;
    },
  ): Promise<boolean> {
    const result = await this.prisma.mediaFile.updateMany({
      where: { id: mediaId, status: "PROCESSING", deletedAt: null },
      data: { ...data, mimeType: "video/mp4", status: "READY" },
    });
    return result.count === 1;
  }

  async failVideo(mediaId: string): Promise<void> {
    await this.prisma.mediaFile.updateMany({
      where: { id: mediaId, status: "PROCESSING" },
      data: { status: "FAILED", sizeBytes: 0 },
    });
  }

  // ── Retention ──────────────────────────────────────────────────────────────

  /**
   * Chat attachments past their life, oldest first, in bounded batches (§3.4).
   * A video stuck in `PROCESSING` that long is collected with the rest.
   */
  async expiredMedia(createdBefore: Date, take: number) {
    return this.prisma.mediaFile.findMany({
      where: {
        purpose: "CHAT_MESSAGE",
        deletedAt: null,
        createdAt: { lt: createdBefore },
      },
      orderBy: { createdAt: "asc" },
      take,
      select: { id: true, storageKey: true },
    });
  }

  /**
   * Soft, per §3.2 — the row stays with `EXPIRED`, which is what lets the
   * bubble say a photograph used to be there. Only the object is removed.
   */
  async markExpired(ids: string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.mediaFile.updateMany({
      where: { id: { in: ids } },
      data: { status: "EXPIRED", deletedAt: at },
    });
  }

  /** Raw uploads the transcoder never finished — a crash, or a lost job. */
  async stuckVideos(createdBefore: Date, take: number) {
    return this.prisma.mediaFile.findMany({
      where: {
        purpose: "CHAT_MESSAGE",
        status: "PROCESSING",
        deletedAt: null,
        createdAt: { lt: createdBefore },
      },
      take,
      select: { id: true, storageKey: true },
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

      /*
       * ★ A DIRECT room is always two people, and neither query below would
       * find them — it has no `groupId` at all. Counting it as 2 without
       * asking the database is not a shortcut: the pair *is* the room, and
       * `ChatAccessService` has already established that this actor is one
       * half of it before any of this runs.
       */
      if (room.kind === "DIRECT") {
        counts.set(room.key, 2);
        continue;
      }

      const [teachers, guardians] = await Promise.all([
        /*
         * ★ The parents' room has no teachers in it — that is what it is for
         * (2026-09-20, "багшгүй дан эцэг эхийн чат"). Skipping the query
         * rather than filtering its result keeps the count honest for the one
         * case that would otherwise be wrong in a way nobody notices: a
         * teacher who is also a parent in this group is in the room, as a
         * parent, and the guardian query below already returns them.
         */
        room.kind === "PARENTS"
          ? Promise.resolve([])
          : this.prisma.groupTeacher.findMany({
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
