import { Module } from "@nestjs/common";
import { InvoicesModule } from "../invoices/invoices.module";
import { AuditController, DashboardController } from "./dashboard.controller";
import { DashboardRepository } from "./dashboard.repository";
import { DashboardService } from "./dashboard.service";
import { AuditReadService } from "./audit-read.service";

@Module({
  imports: [InvoicesModule],
  controllers: [DashboardController, AuditController],
  providers: [DashboardService, DashboardRepository, AuditReadService],
  // DashboardRepository is exported so PlatformModule can reuse the same
  // per-kindergarten aggregation queries for the superadmin detail view,
  // instead of duplicating them.
  exports: [DashboardService, DashboardRepository],
})
export class DashboardModule {}
