import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { z } from "zod";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ServiceAccessService } from "./service-access.service";

const kindergartenQuerySchema = z.object({ kindergartenId: z.string().uuid().optional() });

const invoiceRequestSchema = z.object({
  period: z.enum(["term", "year"]),
  kindergartenId: z.string().uuid().optional(),
});

/**
 * «Үйлчилгээний эрх» for a director (#211) — `apps/web/app/(app)/admin/
 * service-access/page.tsx`. ★ The invoice is a job, not a direct PDF: Chromium
 * never runs inside a request (CLAUDE.md §6).
 */
@Controller("service-access")
@Roles("ADMIN")
export class ServiceAccessController {
  constructor(private readonly service: ServiceAccessService) {}

  @Get()
  status(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(kindergartenQuerySchema)) query: { kindergartenId?: string },
  ) {
    return this.service.status(actor, query.kindergartenId);
  }

  @Post("invoices")
  requestInvoice(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(invoiceRequestSchema))
    body: { period: "term" | "year"; kindergartenId?: string },
  ) {
    return this.service.requestInvoice(
      actor,
      body.period === "term" ? "TERM" : "YEAR",
      body.kindergartenId,
    );
  }

  @Get("invoices/:id")
  invoice(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.invoice(actor, params.id);
  }

  @Get("invoices/:id/download")
  download(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.downloadUrl(actor, params.id);
  }
}
