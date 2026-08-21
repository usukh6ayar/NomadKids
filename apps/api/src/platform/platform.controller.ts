import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { SuperAdmin } from "../auth/decorators/super-admin.decorator";
import type { Actor } from "../authz/actor";
import { updateKindergartenSchema, type UpdateKindergartenDto } from "../tenants/tenants.dto";
import { PlatformService } from "./platform.service";
import {
  createKindergartenSchema,
  listPlatformKindergartensQuerySchema,
  type CreateKindergartenDto,
  type ListPlatformKindergartensQuery,
} from "./platform.dto";

/**
 * Platform routes.
 *
 * Under their own prefix rather than folded into `/kindergartens`, so that
 * `TenantsService.memberScope()` — the tenant isolation every teacher and
 * parent request passes through — stays free of "…unless the actor is a
 * superadmin" branches. CLAUDE.md §1.1.
 *
 * No DELETE: deactivation is `PATCH { isActive: false }`. §3.2.
 */
@Controller("platform")
@SuperAdmin()
export class PlatformController {
  constructor(private readonly service: PlatformService) {}

  @Post("kindergartens")
  async create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createKindergartenSchema)) body: CreateKindergartenDto,
  ) {
    return this.service.create(actor, body);
  }

  @Get("kindergartens")
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listPlatformKindergartensQuerySchema))
    query: ListPlatformKindergartensQuery,
  ) {
    return this.service.list(actor, query);
  }

  @Get("kindergartens/:id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.get(actor, params.id);
  }

  @Patch("kindergartens/:id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateKindergartenSchema)) body: UpdateKindergartenDto,
  ) {
    return this.service.update(actor, params.id, body);
  }
}
