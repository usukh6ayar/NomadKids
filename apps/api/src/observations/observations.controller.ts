import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { idParamSchema, paginationQuerySchema } from "@kinder/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { ObservationsService } from "./observations.service";
import {
  createObservationSchema,
  createParentObservationSchema,
  listObservationsQuerySchema,
  reviewObservationSchema,
  updateObservationSchema,
  type CreateObservationDto,
  type CreateParentObservationDto,
  type ListObservationsQuery,
  type ReviewObservationDto,
  type UpdateObservationDto,
} from "./observations.dto";

const observationParamsSchema = z.object({
  id: z.uuid(),
  observationId: z.uuid(),
});

/**
 * Child-scoped observation routes.
 *
 * No `@Roles` on the read paths: which observations a person sees is decided by
 * `ChildAccessService` plus the visibility filter, not by role. The teacher
 * create route is the exception — it is gated on record access inside the
 * service, and a role hint here would still not be sufficient.
 */
@Controller("children/:id/observations")
export class ChildObservationsController {
  constructor(private readonly service: ObservationsService) {}

  @Get("types")
  async listTypes(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listTypes(actor, params.id);
  }

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listObservationsQuerySchema)) query: ListObservationsQuery,
  ) {
    return this.service.list(actor, params.id, query);
  }

  @Get(":observationId")
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(observationParamsSchema))
    params: { id: string; observationId: string },
  ) {
    return this.service.get(actor, params.id, params.observationId);
  }

  /** Teachers and admins. Guardians use `/parent-observations`. */
  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createObservationSchema)) body: CreateObservationDto,
  ) {
    return this.service.createTeacherObservation(actor, params.id, body);
  }
}

/**
 * A guardian's own submission — RFP §5.4.
 *
 * A separate route rather than a `source` flag on the teacher endpoint. The
 * accepted fields differ, the defaults differ, and a flag would mean one
 * handler deciding which of two shapes it received — the kind of branch that
 * eventually lets a parent post a teacher observation.
 */
@Controller("children/:id/parent-observations")
export class ParentObservationsController {
  constructor(private readonly service: ObservationsService) {}

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createParentObservationSchema)) body: CreateParentObservationDto,
  ) {
    return this.service.createParentObservation(actor, params.id, body);
  }
}

/** Observation-scoped routes, where the child is derived from the record. */
@Controller("observations")
export class ObservationsController {
  constructor(private readonly service: ObservationsService) {}

  /**
   * The teacher's review queue.
   *
   * Declared before `:id` so the literal path is not captured by the
   * parameterised route.
   */
  @Get("review-queue")
  @Roles("TEACHER", "ADMIN")
  async reviewQueue(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: { page: number; pageSize: number },
  ) {
    return this.service.reviewQueue(actor, query);
  }

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateObservationSchema)) body: UpdateObservationDto,
  ) {
    return this.service.update(actor, params.id, body);
  }

  @Delete(":id")
  @Roles("TEACHER", "ADMIN")
  async archive(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.archive(actor, params.id);
  }

  @Post(":id/review")
  @Roles("TEACHER", "ADMIN")
  async review(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(reviewObservationSchema)) body: ReviewObservationDto,
  ) {
    return this.service.review(actor, params.id, body);
  }
}
