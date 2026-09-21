import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { SuperAdmin } from "../auth/decorators/super-admin.decorator";
import type { Actor } from "../authz/actor";
import { updateKindergartenSchema, type UpdateKindergartenDto } from "../tenants/tenants.dto";
import { PlatformService } from "./platform.service";
import {
  createKindergartenAdminSchema,
  createKindergartenSchema,
  deleteKindergartenSchema,
  listPlatformKindergartensQuerySchema,
  type CreateKindergartenAdminDto,
  type CreateKindergartenDto,
  type DeleteKindergartenDto,
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
 * ★ `DELETE` retires a tenant and is a **soft** delete — §3.2 holds, nothing
 * is removed. It sits beside `PATCH { isActive }` rather than replacing it:
 * deactivating is a suspension a director can be told about and reversed in one
 * click, and retiring is neither. `PlatformService.remove` is where the
 * difference is argued.
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

  @Get("stats")
  async stats(@CurrentActor() actor: Actor) {
    return this.service.stats(actor);
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

  /**
   * ★ A tenant-scoped action on the platform prefix, and that is the point.
   *
   * `POST /kindergartens/:id/users` does the same thing for a director, gated
   * on `@Roles("ADMIN")` — which a superadmin, holding no membership, can
   * never satisfy. Rather than adding "…unless they are a superadmin" to that
   * guard, which is exactly the branch CLAUDE.md §1.1 keeps out of the tenant
   * path, the operator gets their own route under their own prefix.
   */
  @Post("kindergartens/:id/admins")
  async addAdmin(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createKindergartenAdminSchema)) body: CreateKindergartenAdminDto,
  ) {
    return this.service.addAdmin(actor, params.id, body);
  }

  @Delete("kindergartens/:id")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(deleteKindergartenSchema)) body: DeleteKindergartenDto,
  ) {
    return this.service.remove(actor, params.id, body);
  }
}
