import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { MilestonesService } from "./milestones.service";
import {
  createMilestoneSchema,
  updateMilestoneSchema,
  type CreateMilestoneDto,
  type UpdateMilestoneDto,
} from "./milestones.dto";

/**
 * Milestones — RFP §4.5.
 *
 * No `@Roles`: a guardian records these (§2.3 lists it among what a parent
 * does) and staff may too. The service decides, including the rule that a
 * guardian may edit only what they wrote themselves.
 */
@Controller("children/:id/milestones")
export class ChildMilestonesController {
  constructor(private readonly service: MilestonesService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.list(actor, params.id);
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createMilestoneSchema)) body: CreateMilestoneDto,
  ) {
    return this.service.create(actor, params.id, body);
  }
}

@Controller("milestones")
export class MilestonesController {
  constructor(private readonly service: MilestonesService) {}

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateMilestoneSchema)) body: UpdateMilestoneDto,
  ) {
    return this.service.update(actor, params.id, body);
  }

  @Delete(":id")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.remove(actor, params.id);
  }
}
