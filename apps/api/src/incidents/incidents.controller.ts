import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { idParamSchema, paginationQuerySchema } from "@kinder/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { IncidentsService } from "./incidents.service";
import {
  createIncidentSchema,
  listIncidentsQuerySchema,
  reportIncidentSchema,
  updateIncidentSchema,
  type CreateIncidentDto,
  type ReportIncidentDto,
  type UpdateIncidentDto,
} from "./incidents.dto";

const listQuerySchema = paginationQuerySchema.extend(listIncidentsQuerySchema.shape);
type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * Safety incidents for one child — RFP Module 2.1.
 *
 * ★ The list has no `@Roles`, and that is deliberate: a family reads their own
 * child's incidents, including before the formal notice is sent. `reportedAt`
 * records whether they were *told*, not whether they may know.
 */
@Controller("children/:id/incidents")
export class ChildIncidentsController {
  constructor(private readonly service: IncidentsService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listForChild(actor, params.id);
  }

  @Post()
  @Roles("TEACHER", "ADMIN")
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createIncidentSchema)) body: CreateIncidentDto,
  ) {
    return this.service.create(actor, params.id, body);
  }
}

/** The kindergarten's log and the unreported queue. Staff only. */
@Controller("kindergartens/:id/incidents")
export class KindergartenIncidentsController {
  constructor(private readonly service: IncidentsService) {}

  @Get()
  @Roles("TEACHER", "ADMIN")
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return this.service.listForKindergarten(actor, params.id, query, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }
}

@Controller("incidents")
export class IncidentsController {
  constructor(private readonly service: IncidentsService) {}

  @Patch(":id")
  @Roles("TEACHER", "ADMIN")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateIncidentSchema)) body: UpdateIncidentDto,
  ) {
    return this.service.update(actor, params.id, body);
  }

  /** Tells the family, through the notice machinery that owns read receipts. */
  @Post(":id/report")
  @Roles("TEACHER", "ADMIN")
  async report(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(reportIncidentSchema)) body: ReportIncidentDto,
  ) {
    return this.service.report(actor, params.id, body);
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
