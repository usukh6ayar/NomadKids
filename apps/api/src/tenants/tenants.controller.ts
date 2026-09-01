import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { idParamSchema, uuidSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { TenantsService } from "./tenants.service";
import {
  assignTeacherSchema,
  createGroupSchema,
  createSchoolYearSchema,
  listGroupsQuerySchema,
  promoteGroupSchema,
  updateGroupSchema,
  updateKindergartenSchema,
  updateSchoolYearSchema,
  type AssignTeacherDto,
  type CreateGroupDto,
  type CreateSchoolYearDto,
  type ListGroupsQuery,
  type PromoteGroupDto,
  type UpdateGroupDto,
  type UpdateKindergartenDto,
  type UpdateSchoolYearDto,
} from "./tenants.dto";

/**
 * Controllers parse, delegate and shape. No authorization decisions, no
 * business rules, no Prisma — CLAUDE.md §2.1.
 *
 * `@Roles(...)` is a coarse gate that keeps a parent off admin routes. It is
 * never sufficient on its own: the service still checks that this admin
 * administers *this* kindergarten. A role says what kind of screens you use,
 * not which records you may touch.
 */
@Controller()
export class TenantsController {
  constructor(private readonly service: TenantsService) {}

  // ── Kindergartens ─────────────────────────────────────────────────────────

  @Get("kindergartens")
  async listKindergartens(@CurrentActor() actor: Actor) {
    return this.service.listKindergartens(actor);
  }

  @Get("kindergartens/:id")
  async getKindergarten(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.getKindergarten(actor, params.id);
  }

  @Patch("kindergartens/:id")
  @Roles("ADMIN")
  async updateKindergarten(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateKindergartenSchema)) body: UpdateKindergartenDto,
  ) {
    return this.service.updateKindergarten(actor, params.id, body);
  }

  // ── School years ──────────────────────────────────────────────────────────

  @Get("kindergartens/:id/school-years")
  async listSchoolYears(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listSchoolYears(actor, params.id);
  }

  @Post("kindergartens/:id/school-years")
  @Roles("ADMIN")
  async createSchoolYear(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createSchoolYearSchema)) body: CreateSchoolYearDto,
  ) {
    return this.service.createSchoolYear(actor, params.id, body);
  }

  @Patch("school-years/:id")
  @Roles("ADMIN")
  async updateSchoolYear(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateSchoolYearSchema)) body: UpdateSchoolYearDto,
  ) {
    return this.service.updateSchoolYear(actor, params.id, body);
  }

  // ── Groups ────────────────────────────────────────────────────────────────

  @Get("groups")
  @Roles("ADMIN", "TEACHER")
  async listGroups(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listGroupsQuerySchema)) query: ListGroupsQuery,
  ) {
    return this.service.listGroups(actor, query);
  }

  @Get("groups/:id")
  @Roles("ADMIN", "TEACHER")
  async getGroup(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.getGroup(actor, params.id);
  }

  /**
   * Order А/261, Annex 2 §1 item 9. Addressed at the group the children leave,
   * because that is the roster the director is looking at when they do this.
   */
  @Post("groups/:id/promotions")
  @Roles("ADMIN")
  async promoteGroup(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(promoteGroupSchema)) body: PromoteGroupDto,
  ) {
    return this.service.promoteGroup(actor, params.id, body);
  }

  @Post("kindergartens/:id/groups")
  @Roles("ADMIN")
  async createGroup(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createGroupSchema)) body: CreateGroupDto,
  ) {
    return this.service.createGroup(actor, params.id, body);
  }

  @Patch("groups/:id")
  @Roles("ADMIN")
  async updateGroup(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateGroupSchema)) body: UpdateGroupDto,
  ) {
    return this.service.updateGroup(actor, params.id, body);
  }

  @Delete("groups/:id")
  @Roles("ADMIN")
  async archiveGroup(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.archiveGroup(actor, params.id);
  }

  // ── Teacher assignments ───────────────────────────────────────────────────

  @Post("groups/:id/teachers")
  @Roles("ADMIN")
  async assignTeacher(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(assignTeacherSchema)) body: AssignTeacherDto,
  ) {
    return this.service.assignTeacher(actor, params.id, body);
  }

  @Delete("group-teachers/:id")
  @Roles("ADMIN")
  async endAssignment(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.endAssignment(actor, params.id);
  }
}

/** Re-exported so route params validate as UUIDs rather than arbitrary strings. */
export { uuidSchema };
