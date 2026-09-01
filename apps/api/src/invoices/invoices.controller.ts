import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { InvoicesService } from "./invoices.service";
import {
  generateInvoiceSchema,
  generateMonthSchema,
  listInvoicesQuerySchema,
  markRefundedSchema,
  recordPaymentSchema,
  updateInvoiceSchema,
  voidPaymentSchema,
  type GenerateInvoiceDto,
  type GenerateMonthDto,
  type ListInvoicesQuery,
  type MarkRefundedDto,
  type RecordPaymentDto,
  type UpdateInvoiceDto,
  type VoidPaymentDto,
} from "./invoices.dto";

/**
 * Parent invoices and the payments against them — нэмэлт.md §7, §8.
 *
 * ★ The accountant and the administrator, same as `funding.controller.ts` —
 * §13 named a dedicated role for exactly this data and said plainly teachers
 * may not see full financial information.
 */
/**
 * A child's own invoices — the guardian-facing read.
 *
 * ★ No `@Roles`. Same reasoning `growth.controller.ts` gives for its own
 * child-scoped route: the service decides who may read via
 * `assertCanViewFinance`, which admits this child's guardian, an admin, or an
 * accountant — and deliberately not a teacher (нэмэлт.md §13).
 */
@Controller("children/:id/invoices")
export class ChildInvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listInvoicesQuerySchema)) query: ListInvoicesQuery,
  ) {
    return this.service.listForChild(actor, params.id, query);
  }
}

@Controller("kindergartens/:id/invoices")
@Roles("ADMIN", "ACCOUNTANT")
export class KindergartenInvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listInvoicesQuerySchema)) query: ListInvoicesQuery,
  ) {
    return this.service.list(actor, params.id, query);
  }

  @Post()
  async generate(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(generateInvoiceSchema)) body: GenerateInvoiceDto,
  ) {
    return this.service.generate(actor, params.id, body);
  }

  /**
   * A whole month, billed from the `PARENT` tariffs — `нэмэлт.md` §3, §7.
   *
   * ★ Beside `POST ""` rather than replacing it. That route bills one child
   * from lines somebody typed, which is what a correction needs; this one reads
   * `FundingRule` and the month's attendance and meal days, which is what a
   * month needs. Neither is a special case of the other.
   *
   * Returns what it did and what it left alone — an existing invoice for the
   * month is skipped, never overwritten.
   */
  @Post("generate-month")
  async generateMonth(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(generateMonthSchema)) body: GenerateMonthDto,
  ) {
    return this.service.generateMonth(actor, params.id, body);
  }
}

@Controller("invoices")
@Roles("ADMIN", "ACCOUNTANT")
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get(":id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.get(actor, params.id);
  }

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateInvoiceSchema)) body: UpdateInvoiceDto,
  ) {
    return this.service.update(actor, params.id, body);
  }

  @Delete(":id")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.remove(actor, params.id);
  }

  @Post(":id/payments")
  async recordPayment(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(recordPaymentSchema)) body: RecordPaymentDto,
  ) {
    return this.service.recordPayment(actor, params.id, body);
  }

  @Post(":id/refund")
  async markRefunded(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(markRefundedSchema)) body: MarkRefundedDto,
  ) {
    return this.service.markRefunded(actor, params.id, body);
  }
}

@Controller("payments")
@Roles("ADMIN", "ACCOUNTANT")
export class PaymentsController {
  constructor(private readonly service: InvoicesService) {}

  @Patch(":id/void")
  async void(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(voidPaymentSchema)) body: VoidPaymentDto,
  ) {
    return this.service.voidPayment(actor, params.id, body);
  }
}
