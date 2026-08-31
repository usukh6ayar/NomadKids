import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { RateLimit } from "../common/rate-limit/rate-limit.guard";
import type { Actor } from "../authz/actor";
import { qpayCallbackSchema, type QpayCallbackBody } from "../integrations/qpay/qpay.schemas";
import { QpayPaymentsService } from "./qpay-payments.service";

const MINUTE = 60_000;

/**
 * Starting and checking an online payment — `нэмэлт.md` §8.
 *
 * ★ No `@Roles`. A **guardian** is the intended caller — they are the one
 * holding the phone — and a role decorator listing ADMIN and ACCOUNTANT would
 * lock the parent out of the feature built for them. The service authorizes:
 * finance staff of the owning kindergarten, or one of the child's guardians,
 * and a 404 for everyone else including the child's teacher (§13).
 */
@Controller("invoices")
export class InvoiceQpayController {
  constructor(private readonly service: QpayPaymentsService) {}

  /** Creates a QPay invoice and returns the QR to scan. */
  @Post(":id/qpay")
  @RateLimit({ limit: 30, windowMs: 15 * MINUTE, byUser: true })
  async createQpayInvoice(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.createQpayInvoice(actor, params.id);
  }

  /**
   * "I paid but it still says unpaid" — re-checks with QPay.
   *
   * ★ Rate limited per user: it makes an outbound call to a third party, so an
   * impatient parent refreshing must not turn into a burst against QPay.
   */
  @Post(":id/qpay/sync")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, windowMs: 15 * MINUTE, byUser: true })
  async sync(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.syncInvoice(actor, params.id);
  }
}

/**
 * QPay's callback — **the one public endpoint in the payment flow.**
 *
 * ★ `@Public()` is unavoidable: QPay's servers dial this, and they hold no
 * session. That makes it the most exposed route in the system, so three things
 * are true of it deliberately:
 *
 *   1. **Nothing in the request is trusted.** The body supplies a payment id
 *      and nothing else is read from it. `QpayPaymentsService` then verifies
 *      that id against QPay over a connection we opened, and takes the amount
 *      from their answer. A forged POST achieves nothing.
 *   2. **Rate limited**, because an unauthenticated endpoint that triggers an
 *      outbound HTTP call is otherwise an amplifier: cheap for an attacker to
 *      call, expensive for us to serve.
 *   3. **Always 200, never a detailed error.** QPay retries a callback that
 *      fails, so a 500 for an unmatched payment produces a retry storm; and
 *      distinguishing "unknown payment" from "already settled" in the response
 *      would let anybody probe which payment ids exist. Operators read the log.
 *
 * ★★ CSRF: `CsrfGuard` exempts `@Public()` routes, protecting them with an
 * origin check instead. QPay sends no `Origin` header, so the check passes —
 * and it is not what protects this endpoint anyway. Verification is.
 */
@Controller("payments/qpay")
export class QpayCallbackController {
  constructor(private readonly service: QpayPaymentsService) {}

  @Public()
  @Post("callback")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 240, windowMs: MINUTE })
  async callback(
    @Body(new ZodValidationPipe(qpayCallbackSchema)) body: QpayCallbackBody,
    /**
     * QPay documents the payment id as a query parameter on some integrations
     * and a JSON body on others. Both are accepted; whichever arrives is
     * verified identically.
     */
    @Query("qpay_payment_id") queryPaymentId?: string,
    @Query("invoice_id") queryInvoiceId?: string,
  ) {
    const providerPaymentId = body.qpay_payment_id ?? body.payment_id ?? queryPaymentId;

    // The Zod schema requires one of the body fields, so this is belt and
    // braces for the query-only shape.
    if (!providerPaymentId) return { ok: true };

    return this.service.handleCallback(providerPaymentId, queryInvoiceId ?? body.object_id);
  }

  /**
   * The same handler for a GET.
   *
   * ★ QPay has been observed calling back with GET when the callback URL
   * carries its parameters in the query string. Registering it explicitly is
   * better than discovering in production that half the confirmations were
   * answered with 404 — and it mutates state on a GET only in the sense that
   * *QPay's* confirmation does; nothing here acts on unverified input.
   */
  @Public()
  @Get("callback")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 240, windowMs: MINUTE })
  async callbackGet(
    @Query("qpay_payment_id") queryPaymentId?: string,
    @Query("payment_id") altPaymentId?: string,
    @Query("invoice_id") queryInvoiceId?: string,
  ) {
    const providerPaymentId = queryPaymentId ?? altPaymentId;
    if (!providerPaymentId) return { ok: true };

    return this.service.handleCallback(providerPaymentId, queryInvoiceId);
  }
}
