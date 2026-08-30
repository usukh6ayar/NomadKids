import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
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
  registerQuerySchema,
  settleFundingSchema,
  updateFundingRuleSchema,
  type CalculateMonthDto,
  type CreateFundingRuleDto,
  type ListFundingQuery,
  type RegisterQuery,
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

  /**
   * The month's register — every enrolled child, their days, and the money.
   *
   * ★ Separate from `listMonth` above rather than replacing it.
   *
   * `listMonth` answers "what did the calculation produce", which is what a
   * reconciliation against a bank statement needs and what §6's totals are.
   * This answers "what does the month look like", which includes children the
   * calculation skipped — a child no rule covers has no calculation row and
   * would simply vanish from a screen built on the other endpoint, which is
   * the one child an administrator most needs to see.
   */
  @Get("register")
  async register(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(registerQuerySchema)) query: RegisterQuery,
  ) {
    return this.service.monthlyRegister(actor, params.id, query);
  }

  /**
   * The same register, as a file — нэмэлт.md §16.
   *
   * Takes the register's own query, so the filters set on screen apply to the
   * download. The row limit does not: a file is the whole month.
   */
  @Get("register/export")
  async exportRegister(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(registerQuerySchema)) query: RegisterQuery,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportRegister(actor, params.id, query);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
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
