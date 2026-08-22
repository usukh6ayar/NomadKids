import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { CatalogService } from "./catalog.service";
import {
  createDomainSchema,
  createLevelSchema,
  createObservationTypeSchema,
  updateDomainSchema,
  updateLevelSchema,
  updateObservationTypeSchema,
  type CreateDomainDto,
  type CreateLevelDto,
  type CreateObservationTypeDto,
  type UpdateDomainDto,
  type UpdateLevelDto,
  type UpdateObservationTypeDto,
} from "./catalog.dto";

/**
 * The administrator's configuration surface — RFP §2.1, §6.1, §6.2.
 *
 * ★ This is the *management* view, and it is admin-only. Everyone else reads
 * the same tables through `GET /kindergartens/:id/assessment-config` and
 * `GET /children/:id/observations/types`, which return only active rows and are
 * open to any member — a parent's screen has to render a domain's name.
 * Splitting them means the read path stays cheap and this one can show
 * deactivated rows without widening who sees them.
 *
 * `@Roles("ADMIN")` is a coarse gate that keeps a teacher out; the service
 * still checks that this admin administers *this* kindergarten. CLAUDE.md §2.1.
 */
@Controller("kindergartens/:id")
@Roles("ADMIN")
export class KindergartenCatalogController {
  constructor(private readonly service: CatalogService) {}

  // ── Development domains ────────────────────────────────────────────────────

  @Get("development-domains")
  async listDomains(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listDomains(actor, params.id);
  }

  @Post("development-domains")
  async createDomain(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createDomainSchema)) body: CreateDomainDto,
  ) {
    return this.service.createDomain(actor, params.id, body);
  }

  // ── Assessment levels ──────────────────────────────────────────────────────

  @Get("assessment-levels")
  async listLevels(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listLevels(actor, params.id);
  }

  @Post("assessment-levels")
  async createLevel(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createLevelSchema)) body: CreateLevelDto,
  ) {
    return this.service.createLevel(actor, params.id, body);
  }

  // ── Observation types ──────────────────────────────────────────────────────

  @Get("observation-types")
  async listObservationTypes(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listObservationTypes(actor, params.id);
  }

  @Post("observation-types")
  async createObservationType(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createObservationTypeSchema)) body: CreateObservationTypeDto,
  ) {
    return this.service.createObservationType(actor, params.id, body);
  }
}

/**
 * Editing one row.
 *
 * Addressed by the row's own id rather than nested under its kindergarten — the
 * same shape as `PATCH /school-years/:id` and `PATCH /terms/:id`. The
 * kindergarten is read from the row, never from the path, which is what makes
 * a pasted id from another tenant a 404 instead of a write.
 *
 * `DELETE` **deactivates**. See the note on `CatalogService`.
 */
@Controller("development-domains")
@Roles("ADMIN")
export class DevelopmentDomainsController {
  constructor(private readonly service: CatalogService) {}

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateDomainSchema)) body: UpdateDomainDto,
  ) {
    return this.service.updateDomain(actor, params.id, body);
  }

  @Delete(":id")
  async deactivate(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.deactivateDomain(actor, params.id);
  }
}

@Controller("assessment-levels")
@Roles("ADMIN")
export class AssessmentLevelsController {
  constructor(private readonly service: CatalogService) {}

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateLevelSchema)) body: UpdateLevelDto,
  ) {
    return this.service.updateLevel(actor, params.id, body);
  }

  @Delete(":id")
  async deactivate(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.deactivateLevel(actor, params.id);
  }
}

@Controller("observation-types")
@Roles("ADMIN")
export class ObservationTypesController {
  constructor(private readonly service: CatalogService) {}

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateObservationTypeSchema)) body: UpdateObservationTypeDto,
  ) {
    return this.service.updateObservationType(actor, params.id, body);
  }

  @Delete(":id")
  async deactivate(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.deactivateObservationType(actor, params.id);
  }
}
