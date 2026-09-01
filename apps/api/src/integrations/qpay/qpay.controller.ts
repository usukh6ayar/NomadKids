import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { idParamSchema, uuidSchema } from "@kinder/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../../auth/decorators/actor.decorator";
import { Public } from "../../auth/decorators/public.decorator";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit/rate-limit.guard";
import type { Actor } from "../../authz/actor";
import { QpayService } from "./qpay.service";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const childInvoiceParamsSchema = idParamSchema.extend({ invoiceId: uuidSchema });
type ChildInvoiceParams = z.infer<typeof childInvoiceParamsSchema>;

/**
 * Paying one invoice through QPay — the guardian-facing side.
 *
 * ★ No `@Roles`. `QpayService` decides via `assertCanViewFinance`, same as
 * `ChildInvoicesController` — a guardian, an admin or an accountant, never a
 * teacher.
 */
@Controller("children/:id/invoices/:invoiceId/qpay")
@UseGuards(RateLimitGuard)
export class ChildInvoiceQpayController {
  constructor(private readonly service: QpayService) {}

  @Post()
  @RateLimit({ limit: 10, windowMs: HOUR, byUser: true })
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(childInvoiceParamsSchema)) params: ChildInvoiceParams,
  ) {
    return this.service.createForInvoice(actor, params.id, params.invoiceId);
  }

  @Get()
  @RateLimit({ limit: 60, windowMs: 10 * MINUTE, byUser: true })
  async status(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(childInvoiceParamsSchema)) params: ChildInvoiceParams,
  ) {
    return this.service.status(actor, params.id, params.invoiceId);
  }
}

/**
 * QPay's own server calling back after a payment — нэмэлт.md §8.
 *
 * ★ `@Public()`. There is no session to authenticate here; the endpoint's
 * only real protection is that it does not trust anything in the request —
 * see `QpayService.reconcile`'s own comment — so a forged call can, at worst,
 * trigger a status re-check that finds nothing to credit. The `origin` check
 * in `CsrfGuard` still runs, but QPay's server-to-server call sends no
 * `Origin` header, so it passes through the same way `login`/password-reset
 * already do (that guard's own comment).
 *
 * ★★ The exact field QPay's callback carries the invoice id under is not
 * confirmed against a live sandbox (see `docs/reference/QPAY_INTEGRATION.md`)
 * — every plausible key is checked so a naming guess being wrong degrades to
 * "the webhook does nothing" rather than a crash, and correctness does not
 * depend on this guess anyway: `ChildInvoiceQpayController.status` polls the
 * same `reconcile()` while the QR is on screen, off `checkPayment` alone.
 */
@Controller("qpay")
@UseGuards(RateLimitGuard)
export class QpayCallbackController {
  constructor(private readonly service: QpayService) {}

  @Post("callback")
  @Public()
  @HttpCode(200)
  @RateLimit({ limit: 30, windowMs: MINUTE })
  async callback(@Query() query: Record<string, unknown>, @Body() body: unknown) {
    const id = extractQpayInvoiceId(query, body);
    if (id) await this.service.handleCallback(id);
    // 200 unconditionally — QPay retries a non-2xx, and a retry storm over an
    // id this deployment does not recognise helps nobody.
    return { received: true };
  }
}

function extractQpayInvoiceId(query: Record<string, unknown>, body: unknown): string | null {
  const candidates = [
    query.qpay_invoice_id,
    query.invoice_id,
    query.object_id,
    query.id,
    ...(isRecord(body)
      ? [body.qpay_invoice_id, body.invoice_id, body.object_id, body.id]
      : []),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
