import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  feedbackInboxQuerySchema,
  feedbackReplySchema,
  newFeedbackSchema,
  paginationQuerySchema,
  uuidSchema,
  type FeedbackInboxQuery,
  type FeedbackReply,
  type NewFeedback,
  type PaginationQuery,
} from "@kinder/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RateLimit, RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { FeedbackService } from "./feedback.service";

const DAY = 24 * 60 * 60 * 1000;

const ownParamSchema = z.object({ feedbackId: uuidSchema });
const inboxParamSchema = z.object({ id: uuidSchema, feedbackId: uuidSchema });

/** A family's own feedback. */
@Controller("me/feedback")
@UseGuards(RateLimitGuard)
export class OwnFeedbackController {
  constructor(private readonly service: FeedbackService) {}

  @Get()
  @Roles("PARENT")
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.service.listOwn(actor, query);
  }

  /** Ten a day per person — enough for a family, too few to flood an inbox. */
  @Post()
  @Roles("PARENT")
  @RateLimit({ limit: 10, windowMs: DAY, byUser: true })
  async create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(newFeedbackSchema)) body: NewFeedback,
  ) {
    return this.service.create(actor, body);
  }

  @Delete(":feedbackId")
  @Roles("PARENT")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(ownParamSchema)) params: { feedbackId: string },
  ) {
    await this.service.removeOwn(actor, params.feedbackId);
  }
}

/** The administration's inbox. No teacher route — `FeedbackService` says why. */
@Controller("kindergartens/:id/feedback")
export class FeedbackInboxController {
  constructor(private readonly service: FeedbackService) {}

  @Get()
  @Roles("ADMIN")
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(z.object({ id: uuidSchema }))) params: { id: string },
    @Query(new ZodValidationPipe(feedbackInboxQuerySchema)) query: FeedbackInboxQuery,
  ) {
    return this.service.inbox(actor, params.id, query);
  }

  @Post(":feedbackId/acknowledge")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.OK)
  async acknowledge(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(inboxParamSchema)) params: { id: string; feedbackId: string },
  ) {
    return this.service.acknowledge(actor, params.id, params.feedbackId);
  }

  @Post(":feedbackId/reply")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.OK)
  async reply(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(inboxParamSchema)) params: { id: string; feedbackId: string },
    @Body(new ZodValidationPipe(feedbackReplySchema)) body: FeedbackReply,
  ) {
    return this.service.reply(actor, params.id, params.feedbackId, body);
  }

  @Delete(":feedbackId")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(inboxParamSchema)) params: { id: string; feedbackId: string },
  ) {
    await this.service.removeFromInbox(actor, params.id, params.feedbackId);
  }
}
