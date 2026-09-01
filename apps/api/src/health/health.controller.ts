import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/decorators/public.decorator";
import { AllowSuperAdmin } from "../auth/decorators/allow-super-admin.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { StorageService } from "../storage/storage.service";
import { PdfRendererService } from "../reports/pdf-renderer.service";
import { ReportsQueue } from "../reports/reports.queue";
import { bundledFontDir, checkCyrillicFont } from "../reports/font-check";
import { MailService } from "../mail/mail.service";
import { EsisService } from "../integrations/esis/esis.service";

/**
 * Liveness and readiness.
 *
 * ★ `@Public()` is load-bearing, not decoration. Authentication is global, so
 * without it this returns 401 and every platform liveness probe fails —
 * Railway and Fly read that as an unhealthy container and restart-loop the
 * deployment. The endpoint has no test that would have caught it either;
 * running the built app is what found it.
 *
 * It deliberately reveals nothing: no version, no database name, no dependency
 * detail. An unauthenticated endpoint that enumerates your infrastructure is
 * free reconnaissance.
 */
@Controller("health")
export class HealthController {
  constructor(
    private readonly storage: StorageService,
    private readonly renderer: PdfRendererService,
    private readonly queue: ReportsQueue,
    private readonly mail: MailService,
    private readonly esis: EsisService,
  ) {}

  @Public()
  @Get()
  check(): { status: "ok" } {
    return { status: "ok" };
  }

  /**
   * The detailed readiness view — **authenticated, admin only**.
   *
   * Separate from `/health` precisely because it names dependencies. It exists
   * for the pre-launch checklist in docs/DEPLOYMENT.md, where the failure it
   * catches is the expensive one: an image built without fonts renders every
   * PDF completely blank and reports success while doing it
   * (docs/PDF_SPIKE.md §4). That is invisible until a parent opens a portfolio.
   */
  @Roles("ADMIN")
  @AllowSuperAdmin()
  @Get("readiness")
  async readiness() {
    const font = checkCyrillicFont(bundledFontDir());

    const [storage, chromium, redis, smtp] = await Promise.all([
      this.storage.isReachable(),
      this.renderer.isReady(),
      this.queue.isReachable(),
      this.mail.verify(),
    ]);

    return {
      // ★ SMTP is reported but does NOT gate the status. A deployment without
      // mail is a real, workable state — tokens are still issued and an
      // administrator can hand the link over. Failing readiness for it would
      // make a working system look broken. The other four genuinely break the
      // product.
      status: storage && chromium && redis && font.ok ? "ok" : "degraded",
      storage,
      chromium,
      redis,
      cyrillicFont: font.ok,
      cyrillicFontDetail: font.detail,
      smtp,
      smtpConfigured: this.mail.isConfigured,
      /*
       * ★ The ministry integration, reported for the same reason as SMTP and
       * gating the status for neither: an unconfigured ESIS is the normal
       * state until БМТТ issues a token (журам A/465 §3.7 — one token per
       * developer, after the data-exchange contract), and a deployment that
       * called itself degraded for the whole of that period would be crying
       * wolf for months.
       *
       * ★★ It answers exactly one question — "would a call be attempted, and
       * against which address?" — and it is `describe()`, not the config, so
       * the token cannot leak through it: presence only, never a value, never
       * a length. There is no live probe here on purpose. Reaching ESIS to see
       * whether it answers means choosing an endpoint, and choosing one before
       * the documentation arrives is the guess `esis.service.ts` exists to
       * prevent.
       */
      esis: this.esis.status(),
    };
  }
}
