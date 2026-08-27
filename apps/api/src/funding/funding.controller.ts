import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { FundingService } from "./funding.service";
import {
  calculateMonthSchema,
  createFundingRuleSchema,
  listFundingQuerySchema,
  settleFundingSchema,
  updateFundingRuleSchema,
  type CalculateMonthDto,
  type CreateFundingRuleDto,
  type ListFundingQuery,
  type SettleFundingDto,
  type UpdateFundingRuleDto,
} from "./funding.dto";

/**
 * Funding rules and the monthly calculation — нэмэлт.md §4, §5, §6.
 *
 * ★ Administrator only. §13 asks for a dedicated accountant role and says
 * teachers may not see full financial information; that role does not exist
 * yet, and `assertAdmin` is the closest correct answer until it does — see
 * `FundingService`.
 */
@Controller("kindergartens/:id/funding")
@Roles("ADMIN")
export class KindergartenFundingController {
  constructor(private readonly service: FundingService) {}

  @Get("rules")
  async listRules(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listRules(actor, params.id);
  }

  @Post("rules")
  async createRule(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createFundingRuleSchema)) body: CreateFundingRuleDto,
  ) {
    return this.service.createRule(actor, params.id, body);
  }

  /** The month's rows and totals — §6. */
  @Get()
  async listMonth(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listFundingQuerySchema)) query: ListFundingQuery,
  ) {
    return this.service.listMonth(actor, params.id, query);
  }

  /** Runs the month from the attendance and meal registers — §6, §17. */
  @Post("calculate")
  async calculate(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(calculateMonthSchema)) body: CalculateMonthDto,
  ) {
    return this.service.calculateMonth(actor, params.id, body);
  }
}

@Controller()
@Roles("ADMIN")
export class FundingController {
  constructor(private readonly service: FundingService) {}

  @Patch("funding-rules/:id")
  async updateRule(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateFundingRuleSchema)) body: UpdateFundingRuleDto,
  ) {
    return this.service.updateRule(actor, params.id, body);
  }

  @Delete("funding-rules/:id")
  async removeRule(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.removeRule(actor, params.id);
  }

  /** Approved and received amounts — §6's later states. */
  @Patch("funding-calculations/:id")
  async settle(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(settleFundingSchema)) body: SettleFundingDto,
  ) {
    return this.service.settle(actor, params.id, body);
  }
}
