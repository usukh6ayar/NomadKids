import { Injectable } from "@nestjs/common";
import type { ChatMessage, ChatRoom } from "@kinder/contracts";
import type { Actor } from "../authz/actor";
import { ChatAccessService } from "../authz/chat-access.service";
import { ChatRepository } from "./chat.repository";

/** One page of history. 30 fills a phone screen twice over. */
const PAGE_SIZE = 30;

/**
 * Chat — the rules and the ordering, and nothing about storage.
 *
 * ★ Every method opens by resolving the room through `ChatAccessService`,
 * which throws 404 for a room the actor is not in (§1.7). Nothing below reads
 * or writes a message without that line having run first — a `roomKey` is a
 * string the client chose, and `group:` plus any uuid is trivial to construct.
 *
 * ★★ **No AI.** There is no assistant here, no generated reply, no model call.
 * The client said so three times and CLAUDE.md §7 records it: this is a message
 * board between people who already share a group.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly access: ChatAccessService,
    private readonly repo: ChatRepository,
  ) {}

  /**
   * The actor's rooms, each with a preview line and an unread count.
   *
   * ★ A fixed number of queries for any number of rooms, not a fixed number
   * *per* room: membership comes from one pair of queries, then the last
   * message, the read cursors, the member counts and the unread totals are
   * each batched. §3.4 is about the database not being asked N times, and a
   * room list with a preview per row is exactly where that goes wrong.
   */
  async listRooms(actor: Actor): Promise<ChatRoom[]> {
    const rooms = await this.access.listRooms(actor);
    if (rooms.length === 0) return [];

    const keys = rooms.map((room) => room.key);
    const [lastMessages, cursors, memberCounts] = await Promise.all([
      this.repo.lastMessagePerRoom(keys),
      this.repo.readCursors(actor.userId, keys),
      this.repo.memberCounts(rooms),
    ]);

    const lastByRoom = new Map(lastMessages.map((m) => [m.roomKey, m]));
    const cursorByRoom = new Map(cursors.map((c) => [c.roomKey, c.lastReadAt]));

    const unread = await this.repo.unreadCounts(
      keys.map((roomKey) => ({ roomKey, since: cursorByRoom.get(roomKey) ?? null })),
    );

    const list: ChatRoom[] = rooms.map((room) => {
      const last = lastByRoom.get(room.key);
      return {
        key: room.key,
        kind: room.kind,
        kindergartenId: room.kindergartenId,
        groupId: room.groupId,
        name: room.name,
        memberCount: memberCounts.get(room.key) ?? 0,
        lastMessage: last
          ? {
              id: last.id,
              body: last.body,
              createdAt: last.createdAt.toISOString(),
              author: last.author,
            }
          : null,
        unreadCount: unread.get(room.key) ?? 0,
      };
    });

    /*
      Busiest first, then most recent, then by name — a room with something new
      in it is what the reader opened the list for. The name is the final tie
      break so the order is stable between renders rather than depending on
      whatever order the database returned.
    */
    return list.sort(
      (a, b) =>
        b.unreadCount - a.unreadCount ||
        (b.lastMessage?.createdAt ?? "").localeCompare(a.lastMessage?.createdAt ?? "") ||
        a.name.localeCompare(b.name),
    );
  }

  /**
   * One room's history, newest first, paginated by `before`.
   *
   * ★ A cursor rather than a page number. A chat grows at the end the reader
   * is looking at, so an offset shifts under them between requests and the
   * same message arrives on two pages.
   */
  async listMessages(
    actor: Actor,
    roomKey: string,
    before?: string,
  ): Promise<{ items: ChatMessage[]; nextCursor: string | null }> {
    await this.access.assertMember(actor, roomKey);

    const rows = await this.repo.listMessages(roomKey, {
      before: before ? new Date(before) : undefined,
      take: PAGE_SIZE + 1,
    });

    // One row beyond the page is fetched purely to answer "is there more",
    // then dropped — cheaper and more honest than a second `count`.
    const hasMore = rows.length > PAGE_SIZE;
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    return {
      items: page.map((row) => ({
        id: row.id,
        roomKey: row.roomKey,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
        author: row.author,
        mine: row.authorId === actor.userId,
      })),
      nextCursor: hasMore ? page[page.length - 1]!.createdAt.toISOString() : null,
    };
  }

  async send(actor: Actor, roomKey: string, body: string): Promise<ChatMessage> {
    const room = await this.access.assertMember(actor, roomKey);
    const row = await this.repo.createMessage({ room, authorId: actor.userId, body });

    /*
      Sending is reading. The author has by definition seen everything up to
      their own message, so leaving the cursor behind would show them an unread
      badge for what they just typed.
    */
    await this.repo.markRead({ userId: actor.userId, room, at: row.createdAt });

    return {
      id: row.id,
      roomKey: row.roomKey,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      author: row.author,
      mine: true,
    };
  }

  async markRead(actor: Actor, roomKey: string): Promise<void> {
    const room = await this.access.assertMember(actor, roomKey);
    await this.repo.markRead({ userId: actor.userId, room, at: new Date() });
  }

  /** The badge on the floating button: every room's unread, summed. */
  async unreadTotal(actor: Actor): Promise<{ count: number }> {
    const rooms = await this.listRooms(actor);
    return { count: rooms.reduce((sum, room) => sum + room.unreadCount, 0) };
  }
}
