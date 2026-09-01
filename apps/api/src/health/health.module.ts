import { Module } from "@nestjs/common";
import { EsisModule } from "../integrations/esis/esis.module";
import { QpayModule } from "../integrations/qpay/qpay.module";
import { ReportsModule } from "../reports/reports.module";
import { HealthController } from "./health.controller";

/**
 * `ReportsModule` supplies the Chromium and queue probes for `/health/readiness`
 * — the pre-launch check that an image really can render a Cyrillic PDF.
 *
 * `EsisModule` supplies the ministry-integration status. It is imported rather
 * than reached globally for the reason `esis.module.ts` gives: a module that
 * consumes ESIS should have to say so.
 */
@Module({
  imports: [ReportsModule, EsisModule, QpayModule],
  controllers: [HealthController],
})
export class HealthModule {}
