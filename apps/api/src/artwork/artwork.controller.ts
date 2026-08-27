import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { ArtworkService } from "./artwork.service";
import {
  createComparisonSchema,
  updateComparisonSchema,
  type CreateComparisonDto,
  type UpdateComparisonDto,
} from "./artwork.dto";

/**
 * Artwork development comparison — RFP §5.3.
 *
 * The timeline is readable by the family: seeing their child's drawings improve
 * is the point of keeping them. Drawing the *conclusion* is a teacher's
 * professional judgement, so writing is staff-only.
 */
@Controller("children/:id/artwork")
export class ChildArtworkController {
  constructor(private readonly service: ArtworkService) {}

  @Get()
  async timeline(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.timeline(actor, params.id);
  }

  @Post("comparisons")
  @Roles("TEACHER", "ADMIN")
  async compare(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createComparisonSchema)) body: CreateComparisonDto,
  ) {
    return this.service.compare(actor, params.id, body);
  }
}

@Controller("artwork-comparisons")
export class ArtworkComparisonController {
  constructor(private readonly service: ArtworkService) {}

  @Patch(":id")
  @Roles("TEACHER", "ADMIN")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateComparisonSchema)) body: UpdateComparisonDto,
  ) {
    return this.service.update(actor, params.id, body);
  }

  @Delete(":id")
  @Roles("TEACHER", "ADMIN")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.remove(actor, params.id);
  }
}
