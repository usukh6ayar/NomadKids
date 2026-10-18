import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  listContractPaymentsQuerySchema,
  recordTransferSchema,
  setEbarimtSchema,
  type ListContractPaymentsQuery,
  type RecordTransferDto,
  type SetEbarimtDto,
} from "./contract-payments.dto";
import { ContractPaymentsService } from "./contract-payments.service";

/**
 * Every kindergarten's contract payments, for the platform operator — a bank
 * transfer recorded, an ebarimt number kept (the client, 2026-10-18).
 *
 * ★ No `@Roles`, as `PlatformRevenueController`: `isSuperAdmin` is a flag, and
 * `PlatformAccessService.assertSuperAdmin` — first in every service method —
 * is the only thing that reads it. Anyone else gets 404.
 */
@Controller("platform/contract-payments")
export class ContractPaymentsController {
  constructor(private readonly service: ContractPaymentsService) {}

  @Get()
  list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listContractPaymentsQuerySchema)) query: ListContractPaymentsQuery,
  ) {
    return this.service.list(actor, query);
  }

  @Post(":id/record")
  record(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(recordTransferSchema)) body: RecordTransferDto,
  ) {
    return this.service.recordTransfer(actor, params.id, body);
  }

  @Patch(":id/ebarimt")
  ebarimt(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(setEbarimtSchema)) body: SetEbarimtDto,
  ) {
    return this.service.setEbarimt(actor, params.id, body);
  }
}
