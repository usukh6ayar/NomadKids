import { BadRequestException, Injectable } from "@nestjs/common";
import type { ChatMessage, ChatRoom } from "@kinder/contracts";
import type { Actor } from "../authz/actor";
import { ChatAccessService } from "../authz/chat-access.service";
import { StorageService } from "../storage/storage.service";
import {
  CHAT_IMAGE_EDGE,
  CHAT_IMAGE_QUALITY,
  CHAT_MAX_UPLOAD_BYTES,
  MAX_CHAT_IMAGES,
  UploadRejected,
  sanitiseFilename,
  validateImageUpload,
} from "../media/upload-validation";
import { ChatRepository } from "./chat.repository";

/** One page of history. 30 fills a phone screen twice over. */
const PAGE_SIZE = 30;

/** A file as multer hands it over. */
export interface ChatUpload {
  buffer: Buffer;
  originalname: string;
}

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
    private readonly storage: StorageService,
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
        media: row.media,
      })),
      nextCursor: hasMore ? page[page.length - 1]!.createdAt.toISOString() : null,
    };
  }

  /**
   * Send a message, with up to four photographs.
   *
   * ★ One request, not two. The alternative — upload the files, then send a
   * message naming them — is how `MENU_DISH` works and it is wrong here: it
   * creates a window in which a stored file exists with no room to authorise
   * it against. `assertMember` runs first and once, and nothing is written
   * until it has.
   *
   * ★★ Storage before database, deliberately. A failure between the two
   * leaves objects in the bucket that no row points at; `storageKey` is a
   * random UUID, so they are unreachable rather than exposed. The other order
   * leaves rows pointing at objects that were never written — a broken image
   * in a parent's chat for as long as the message exists.
   */
  async send(
    actor: Actor,
    roomKey: string,
    body: string | undefined,
    files: ChatUpload[] = [],
  ): Promise<ChatMessage> {
    const room = await this.access.assertMember(actor, roomKey);

    const text = body?.trim() ?? "";

    /*
     * ★ The rule `sendChatMessageSchema` cannot express. `body` had to become
     * optional so a photograph can travel with nothing typed, and only this
     * layer knows how many files actually arrived — so the "not both empty"
     * check lives here rather than in the DTO.
     */
    if (!text && files.length === 0) {
      throw new BadRequestException("Мессеж хоосон байна");
    }

    if (files.length > MAX_CHAT_IMAGES) {
      throw new BadRequestException(`Нэг мессежид дээд тал нь ${MAX_CHAT_IMAGES} зураг хавсаргана`);
    }

    /*
     * Validated together, before a single object is written. A request whose
     * fourth file is not an image must leave nothing behind from the first
     * three.
     */
    const validated = [];
    for (const file of files) {
      try {
        validated.push({
          file,
          image: await validateImageUpload(file.buffer, {
            maxBytes: CHAT_MAX_UPLOAD_BYTES,
            maxEdge: CHAT_IMAGE_EDGE,
            quality: CHAT_IMAGE_QUALITY,
          }),
        });
      } catch (error) {
        if (error instanceof UploadRejected) throw new BadRequestException(error.reason);
        throw error;
      }
    }

    const media = [];
    for (const { file, image } of validated) {
      const storageKey = this.storage.buildKindergartenKey(room.kindergartenId, "chat");
      await this.storage.put(storageKey, image.buffer, image.mimeType);
      media.push({
        storageKey,
        originalName: sanitiseFilename(file.originalname),
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        width: image.width,
        height: image.height,
      });
    }

    const row = await this.repo.createMessage({
      room,
      authorId: actor.userId,
      body: text,
      media,
    });

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
      media: row.media,
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
