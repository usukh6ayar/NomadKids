import { Module } from "@nestjs/common";
import { MealsController } from "./meals.controller";
import { MealsRepository } from "./meals.repository";
import { MealsService } from "./meals.service";
import { HealthRecordsModule } from "../health-records/health-records.module";

@Module({
  // For the allergy cross-check — RFP Module 2's automatic menu warning.
  imports: [HealthRecordsModule],
  controllers: [MealsController],
  providers: [MealsService, MealsRepository],
  exports: [MealsService, MealsRepository],
})
export class MealsModule {}
