import { Module } from "@nestjs/common";
import { ChildHealthController, HealthRecordsController } from "./health-records.controller";
import { HealthRecordsRepository } from "./health-records.repository";
import { HealthRecordsService } from "./health-records.service";

@Module({
  controllers: [ChildHealthController, HealthRecordsController],
  providers: [HealthRecordsService, HealthRecordsRepository],
  // Exported for the menu cross-check, which reads every live allergy in a
  // kindergarten at once — RFP Module 2's automatic warning.
  exports: [HealthRecordsService, HealthRecordsRepository],
})
export class HealthRecordsModule {}
