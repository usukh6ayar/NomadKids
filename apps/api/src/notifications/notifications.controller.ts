import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { NotificationsService } from "./notifications.service";
import {
  createNotificationSchema,
  listNotificationsQuerySchema,
  updateNotificationSchema,
  type CreateNotificationDto,
  type ListNotificationsQuery,
  type UpdateNotificationDto,
} from "./notifications.dto";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  /**
   * Polled at 60 s while the tab is visible — the MVP's answer to realtime.
   *
   * Declared before `:id` so the literal path is not captured by the
   * parameterised route.
   */
  @Get("unread-count")
  async unreadCount(@CurrentActor() actor: Actor) {
    return this.service.unreadCount(actor);
  }

  /** No `@Roles`: the audience filter decides, not the role. */
  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ) {
    return this.service.list(actor, query);
  }

  @Get(":id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.get(actor, params.id);
  }

  @Patch(":id")
  @Roles("TEACHER", "ADMIN")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateNotificationSchema)) body: UpdateNotificationDto,
  ) {
    return this.service.update(actor, params.id, body);
  }

  @Post(":id/publish")
  @Roles("TEACHER", "ADMIN")
  async publish(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.publish(actor, params.id);
  }

  @Delete(":id")
  @Roles("TEACHER", "ADMIN")
  async archive(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.archive(actor, params.id);
  }

  /**
   * Likes an announcement.
   *
   * ★ Anyone who can read the notice can like it, including guardians — that is
   * the point. There is deliberately **no comment endpoint**: a class board
   * parents can reply to is a moderation surface, and nobody has been given the
   * job of moderating it. Posting stays with staff, reacting is open.
   *
   * Returns the updated notice so the button can show the new count without a
   * second request.
   */
  @Post(":id/like")
  @HttpCode(HttpStatus.OK)
  async like(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.setReaction(actor, params.id, true);
  }

  /** Removes a like. Idempotent — un-liking twice is not an error. */
  @Delete(":id/like")
  @HttpCode(HttpStatus.OK)
  async unlike(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.setReaction(actor, params.id, false);
  }

  /** Idempotent — reading twice is not an error. */
  @Post(":id/read")
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ): Promise<void> {
    await this.service.markRead(actor, params.id);
  }
}

@Controller("kindergartens/:id/notifications")
export class KindergartenNotificationsController {
  constructor(private readonly service: NotificationsService) {}

  /** Creates a DRAFT — publishing is a separate, deliberate act. */
  @Post()
  @Roles("TEACHER", "ADMIN")
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createNotificationSchema)) body: CreateNotificationDto,
  ) {
    return this.service.create(actor, params.id, body);
  }
}
