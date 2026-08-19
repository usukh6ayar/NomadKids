import { Module } from "@nestjs/common";
import { ReportsModule } from "../reports/reports.module";
import { HealthController } from "./health.controller";

/**
 * `ReportsModule` supplies the Chromium and queue probes for `/health/readiness`
 * — the pre-launch check that an image really can render a Cyrillic PDF.
 */
@Module({
  imports: [ReportsModule],
  controllers: [HealthController],
})
export class HealthModule {}
