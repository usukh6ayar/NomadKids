import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";
import { sendChatMessageSchema, type SendChatMessageDto } from "@kinder/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { ChatService } from "./chat.service";

/**
 * A room key in a URL path.
 *
 * ★ Validated for *shape*, never trusted for access. `group:<uuid>` is
 * guessable by construction, so this only keeps malformed strings out of the
 * database layer — `ChatAccessService` is what decides whether the caller is in
 * the room, on every single request.
 */
const roomParamSchema = z.object({
  roomKey: z
    .string()
    .max(80)
    .regex(/^(group|staff):[0-9a-fA-F-]{36}$/, "Өрөөний түлхүүр буруу байна"),
});

/** `before` is an ISO timestamp cursor — see `ChatService.listMessages`. */
const historyQuerySchema = z.object({ before: z.string().datetime().optional() });

/**
 * Chat.
 *
 * ★ No `@Roles`. Membership of a room is not a role — a parent belongs to
 * their child's group room and to no staff room, and a teacher's staff room is
 * decided by their `Membership`, not by a decorator. `ChatAccessService`
 * answers all of it, and answers 404 rather than 403 (§1.7).
 *
 * The controller parses, calls one service method and shapes nothing — §2.1.
 */
@Controller("chat")
export class ChatController {
  constructor(private readonly service: ChatService) {}

  /**
   * The floating button's badge.
   *
   * Declared before `rooms/:roomKey` so the literal path is not captured by
   * the parameterised route — the same ordering `NotificationsController`
   * documents for `unread-count`.
   */
  @Get("unread-count")
  async unreadCount(@CurrentActor() actor: Actor) {
    return this.service.unreadTotal(actor);
  }

  /** Every room this person is in. Never every room in the kindergarten. */
  @Get("rooms")
  async rooms(@CurrentActor() actor: Actor) {
    return this.service.listRooms(actor);
  }

  @Get("rooms/:roomKey/messages")
  async messages(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(roomParamSchema)) params: { roomKey: string },
    @Query(new ZodValidationPipe(historyQuerySchema)) query: { before?: string },
  ) {
    return this.service.listMessages(actor, params.roomKey, query.before);
  }

  @Post("rooms/:roomKey/messages")
  async send(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(roomParamSchema)) params: { roomKey: string },
    @Body(new ZodValidationPipe(sendChatMessageSchema)) body: SendChatMessageDto,
  ) {
    return this.service.send(actor, params.roomKey, body.body);
  }

  /** Moves this reader's cursor to now. No body — the time is the server's. */
  @Post("rooms/:roomKey/read")
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(roomParamSchema)) params: { roomKey: string },
  ) {
    await this.service.markRead(actor, params.roomKey);
  }
}
