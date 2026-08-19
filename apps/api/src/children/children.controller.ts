import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { ChildrenService } from "./children.service";
import {
  addGuardianSchema,
  createChildSchema,
  endEnrollmentSchema,
  enrollSchema,
  listChildrenQuerySchema,
  updateChildSchema,
  updateGuardianshipSchema,
  type AddGuardianDto,
  type CreateChildDto,
  type EndEnrollmentDto,
  type EnrollDto,
  type ListChildrenQuery,
  type UpdateChildDto,
  type UpdateGuardianshipDto,
} from "./children.dto";

@Controller()
export class ChildrenController {
  constructor(private readonly service: ChildrenService) {}

  /**
   * A parent's own children.
   *
   * Declared before `/children/:id` so the literal path is not captured by the
   * parameterised route.
   */
  @Get("children/mine")
  async listOwn(@CurrentActor() actor: Actor) {
    return this.service.listOwnChildren(actor);
  }

  /** No `@Roles` — every role has children they may see, and the service decides which. */
  @Get("children")
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listChildrenQuerySchema)) query: ListChildrenQuery,
  ) {
    return this.service.list(actor, query);
  }

  @Get("children/:id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.get(actor, params.id);
  }

  @Post("kindergartens/:id/children")
  @Roles("ADMIN", "TEACHER")
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createChildSchema)) body: CreateChildDto,
  ) {
    return this.service.create(actor, params.id, body);
  }

  @Patch("children/:id")
  @Roles("ADMIN", "TEACHER")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateChildSchema)) body: UpdateChildDto,
  ) {
    return this.service.update(actor, params.id, body);
  }

  @Delete("children/:id")
  @Roles("ADMIN")
  async archive(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.archive(actor, params.id);
  }

  // ── Guardianships ─────────────────────────────────────────────────────────

  @Get("children/:id/guardians")
  async listGuardians(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listGuardians(actor, params.id);
  }

  @Post("children/:id/guardians")
  @Roles("ADMIN")
  async addGuardian(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(addGuardianSchema)) body: AddGuardianDto,
  ) {
    return this.service.addGuardian(actor, params.id, body);
  }

  /** `canView: false` here is the revocation path. */
  @Patch("guardianships/:id")
  @Roles("ADMIN")
  async updateGuardianship(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateGuardianshipSchema)) body: UpdateGuardianshipDto,
  ) {
    return this.service.updateGuardianship(actor, params.id, body);
  }

  // ── Enrollment ────────────────────────────────────────────────────────────

  @Get("children/:id/enrollments")
  async listEnrollments(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listEnrollments(actor, params.id);
  }

  @Post("children/:id/enrollments")
  @Roles("ADMIN")
  async enroll(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(enrollSchema)) body: EnrollDto,
  ) {
    return this.service.enroll(actor, params.id, body);
  }

  @Patch("enrollments/:id")
  @Roles("ADMIN")
  async endEnrollment(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(endEnrollmentSchema)) body: EndEnrollmentDto,
  ) {
    return this.service.endEnrollment(actor, params.id, body);
  }
}
