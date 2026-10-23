import { Body, Controller, Get, Param, Put, Query } from "@nestjs/common";
import {
  a79ProgressQuerySchema,
  a79SummaryQuerySchema,
  idParamSchema,
  observationA79LinksSchema,
  type A79SummaryQuery,
  type ObservationA79Links,
} from "@kinder/contracts";
import { z } from "zod";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { A79Service } from "./a79.service";

/**
 * Three resources, three controllers: a note's links authorise through the
 * note, a child's progress through the child, a group's summary through the
 * group — one controller answering to three authorization paths is the shape
 * CLAUDE.md §1.1 exists to prevent.
 */
@Controller("observations/:id/a79-links")
export class ObservationA79LinksController {
  constructor(private readonly service: A79Service) {}

  @Get()
  @Roles("TEACHER", "ADMIN")
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.links(actor, params.id);
  }

  @Put()
  @Roles("TEACHER", "ADMIN")
  async replace(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(observationA79LinksSchema)) body: ObservationA79Links,
  ) {
    return this.service.replaceLinks(actor, params.id, body);
  }
}

@Controller("children/:id/a79-progress")
export class ChildA79ProgressController {
  constructor(private readonly service: A79Service) {}

  @Get()
  @Roles("TEACHER", "ADMIN")
  async progress(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(a79ProgressQuerySchema))
    query: z.infer<typeof a79ProgressQuerySchema>,
  ) {
    return this.service.progress(actor, params.id, query.level);
  }
}

@Controller("groups/:id/a79-summary")
export class GroupA79SummaryController {
  constructor(private readonly service: A79Service) {}

  @Get()
  @Roles("TEACHER", "ADMIN")
  async summary(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(a79SummaryQuerySchema)) query: A79SummaryQuery,
  ) {
    return this.service.groupSummary(actor, params.id, query);
  }
}
