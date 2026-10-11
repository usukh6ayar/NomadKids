import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import {
  clubInputSchema,
  newClubRequestSchema,
  routineItemsInputSchema,
  routinePlanInputSchema,
  uuidSchema,
  type ClubInput,
  type NewClubRequest,
  type RoutineItemsInput,
  type RoutinePlanInput,
} from "@kinder/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { RoutineService } from "./routine.service";

const groupParams = z.object({ groupId: uuidSchema });
const clubParams = z.object({ groupId: uuidSchema, clubId: uuidSchema });
const requestParams = z.object({ groupId: uuidSchema, requestId: uuidSchema });
const childParams = z.object({ childId: uuidSchema });

/**
 * A group's routine and clubs. The director reads; every write is the group
 * teacher's — the web gives the director no buttons, and `RoutineService`
 * refuses them too.
 */
@Controller("groups/:groupId")
export class GroupRoutineController {
  constructor(private readonly service: RoutineService) {}

  @Get("routine")
  @Roles("TEACHER", "ADMIN")
  async read(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(groupParams)) params: { groupId: string },
  ) {
    return this.service.forGroup(actor, params.groupId);
  }

  @Put("routine/items")
  @Roles("TEACHER")
  async saveItems(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(groupParams)) params: { groupId: string },
    @Body(new ZodValidationPipe(routineItemsInputSchema)) body: RoutineItemsInput,
  ) {
    return this.service.saveItems(actor, params.groupId, body.items);
  }

  @Put("routine/plan")
  @Roles("TEACHER")
  async savePlan(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(groupParams)) params: { groupId: string },
    @Body(new ZodValidationPipe(routinePlanInputSchema)) body: RoutinePlanInput,
  ) {
    return this.service.savePlan(actor, params.groupId, body.plan);
  }

  @Post("clubs")
  @Roles("TEACHER")
  async createClub(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(groupParams)) params: { groupId: string },
    @Body(new ZodValidationPipe(clubInputSchema)) body: ClubInput,
  ) {
    return this.service.createClub(actor, params.groupId, body);
  }

  @Put("clubs/:clubId")
  @Roles("TEACHER")
  async updateClub(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(clubParams)) params: { groupId: string; clubId: string },
    @Body(new ZodValidationPipe(clubInputSchema)) body: ClubInput,
  ) {
    return this.service.updateClub(actor, params.groupId, params.clubId, body);
  }

  @Delete("clubs/:clubId")
  @Roles("TEACHER")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteClub(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(clubParams)) params: { groupId: string; clubId: string },
  ) {
    await this.service.deleteClub(actor, params.groupId, params.clubId);
  }

  @Post("club-requests/:requestId/approve")
  @Roles("TEACHER")
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(requestParams)) params: { groupId: string; requestId: string },
  ) {
    return this.service.decide(actor, params.groupId, params.requestId, true);
  }

  @Post("club-requests/:requestId/reject")
  @Roles("TEACHER")
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(requestParams)) params: { groupId: string; requestId: string },
  ) {
    return this.service.decide(actor, params.groupId, params.requestId, false);
  }
}

/** A child's routine, as the family reads it, and the family's request to join a club. */
@Controller("children/:childId")
export class ChildRoutineController {
  constructor(private readonly service: RoutineService) {}

  @Get("routine")
  @Roles("PARENT", "TEACHER", "ADMIN")
  async read(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(childParams)) params: { childId: string },
  ) {
    return this.service.forChild(actor, params.childId);
  }

  @Post("club-requests")
  @Roles("PARENT")
  async requestClub(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(childParams)) params: { childId: string },
    @Body(new ZodValidationPipe(newClubRequestSchema)) body: NewClubRequest,
  ) {
    return this.service.requestClub(actor, params.childId, body);
  }
}
