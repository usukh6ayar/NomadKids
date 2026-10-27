import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import type { Request } from "express";
import { z } from "zod";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { AllowLapsed } from "../auth/decorators/allow-lapsed.decorator";
import type { Actor } from "../authz/actor";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { MAX_GROUP_COUNT, ServiceAccessService } from "./service-access.service";

const kindergartenQuerySchema = z.object({ kindergartenId: z.string().uuid().optional() });

const kindergartenBodySchema = z.object({ kindergartenId: z.string().uuid().optional() });

/**
 * The director's acceptance — `accepted: true` said out loud, and the
 * `version` they read (the user, 2026-10-18: «онлайнаар гэрээ байгуулдаг»).
 */
const acceptContractSchema = z
  .object({
    accepted: z.literal(true),
    version: z.number().int().min(1),
    kindergartenId: z.string().uuid().optional(),
  })
  .strict();

const invoiceRequestSchema = z.object({
  period: z.enum(["term", "year"]),
  kindergartenId: z.string().uuid().optional(),
  /** «Бүлэг − N +» — the groups to price; the service refuses fewer than run now. */
  groupCount: z.number().int().min(1).max(MAX_GROUP_COUNT).optional(),
});

type InvoiceRequest = z.infer<typeof invoiceRequestSchema>;

/**
 * «Үйлчилгээний эрх» for a director (#211) — `apps/web/app/(app)/admin/
 * service-access/page.tsx`. ★ The invoice is a job, not a direct PDF: Chromium
 * never runs inside a request (CLAUDE.md §6).
 */
@Controller("service-access")
@Roles("ADMIN")
// ★ Open to a director whose service has lapsed — paying is how it reopens (2026-10-27).
@AllowLapsed()
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
    @Body(new ZodValidationPipe(invoiceRequestSchema)) body: InvoiceRequest,
  ) {
    return this.service.requestInvoice(
      actor,
      body.period === "term" ? "TERM" : "YEAR",
      body.kindergartenId,
      body.groupCount,
    );
  }

  /** №6 — the next period of the contract, by QPay (the user, 2026-10-18). */
  @Post("qpay")
  payWithQpay(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(invoiceRequestSchema)) body: InvoiceRequest,
  ) {
    return this.service.payWithQpay(
      actor,
      body.period === "term" ? "TERM" : "YEAR",
      body.kindergartenId,
      body.groupCount,
    );
  }

  @Get("qpay/:id")
  qpayStatus(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(kindergartenQuerySchema)) query: { kindergartenId?: string },
  ) {
    return this.service.qpayStatus(actor, params.id, query.kindergartenId);
  }

  /** The contract's PDF for its own director — the document they accept. */
  @Get("contracts/:id/download")
  contractPdf(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(kindergartenQuerySchema)) query: { kindergartenId?: string },
  ) {
    return this.service.contractPdfUrl(actor, params.id, query.kindergartenId);
  }

  /** The director accepts the contract online; it becomes ACTIVE (2026-10-18). */
  @Post("contracts/:id/accept")
  acceptContract(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(acceptContractSchema))
    body: { version: number; kindergartenId?: string },
    @Req() req: Request,
  ) {
    return this.service.acceptContract(actor, params.id, body, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });
  }

  /** The contract's first period, by QPay, at the accepted figure. */
  @Post("qpay/:id")
  payDueWithQpay(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(kindergartenBodySchema)) body: { kindergartenId?: string },
  ) {
    return this.service.payDueWithQpay(actor, params.id, body.kindergartenId);
  }

  /** An invoice for one unpaid period — a state kindergarten pays it by transfer. */
  @Post("payments/:id/invoice")
  paymentInvoice(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(kindergartenBodySchema)) body: { kindergartenId?: string },
  ) {
    return this.service.paymentInvoice(actor, params.id, body.kindergartenId);
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
