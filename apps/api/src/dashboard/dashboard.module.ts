import { Module } from "@nestjs/common";
import { AuditController, DashboardController } from "./dashboard.controller";
import { DashboardRepository } from "./dashboard.repository";
import { DashboardService } from "./dashboard.service";
import { AuditReadService } from "./audit-read.service";

@Module({
  controllers: [DashboardController, AuditController],
  providers: [DashboardService, DashboardRepository, AuditReadService],
  exports: [DashboardService],
})
export class DashboardModule {}
