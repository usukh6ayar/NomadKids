import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { PlatformRevenueService } from "./platform-revenue.service";
import {
  createPartnerSchema,
  revenueMonthQuerySchema,
  updatePartnerSchema,
  type CreatePartnerDto,
  type RevenueMonthQuery,
  type UpdatePartnerDto,
} from "./platform-revenue.dto";

/**
 * The platform operator's income, and how it is divided.
 *
 * ★ No `@Roles`. `isSuperAdmin` is a flag on the user, not a role, and
 * `PlatformAccessService.assertSuperAdmin` is the only thing that reads it —
 * the service calls it first in every method. A `@Roles` decorator here would
 * be a second gate that could one day disagree with the first.
 *
 * ★★ 404, never 403 (§1.7): `assertSuperAdmin` throws `NotFoundException`, so
 * a kindergarten administrator probing `/platform/revenue` learns only that
 * there is nothing at that address.
 */
@Controller("platform")
export class PlatformRevenueController {
  constructor(private readonly service: PlatformRevenueService) {}

  /** One month across every kindergarten. Totals, never per-child rows. */
  @Get("revenue")
  async revenue(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(revenueMonthQuerySchema)) query: RevenueMonthQuery,
  ) {
    return this.service.monthRevenue(actor, query.month);
  }

  /** The same month, divided by the shares in force. */
  @Get("revenue/distribution")
  async distribution(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(revenueMonthQuerySchema)) query: RevenueMonthQuery,
  ) {
    return this.service.distribution(actor, query.month);
  }

  @Get("partners")
  async listPartners(@CurrentActor() actor: Actor) {
    return this.service.listPartners(actor);
  }

  @Post("partners")
  async createPartner(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createPartnerSchema)) body: CreatePartnerDto,
  ) {
    return this.service.createPartner(actor, body);
  }

  @Patch("partners/:id")
  async updatePartner(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updatePartnerSchema)) body: UpdatePartnerDto,
  ) {
    return this.service.updatePartner(actor, params.id, body);
  }

  @Delete("partners/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePartner(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    await this.service.removePartner(actor, params.id);
  }
}
