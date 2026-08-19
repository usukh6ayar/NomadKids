import { Module } from "@nestjs/common";
import { ReportsModule } from "../reports/reports.module";
import { MaintenanceRepository } from "./maintenance.repository";
import { MaintenanceScheduler } from "./maintenance.scheduler";
import { MaintenanceService } from "./maintenance.service";

/**
 * `ReportsModule` supplies the retention sweep. The dependency runs one way —
 * reports know nothing about maintenance — so there is no cycle to break.
 */
@Module({
  imports: [ReportsModule],
  providers: [MaintenanceService, MaintenanceRepository, MaintenanceScheduler],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
