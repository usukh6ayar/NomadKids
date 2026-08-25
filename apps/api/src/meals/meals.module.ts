import { Module } from "@nestjs/common";
import { ChildMealsController, GroupMealsController, MealsController } from "./meals.controller";
import { MealsRepository } from "./meals.repository";
import { MealsService } from "./meals.service";
import { HealthRecordsModule } from "../health-records/health-records.module";

@Module({
  // For the allergy cross-check — RFP Module 2's automatic menu warning.
  imports: [HealthRecordsModule],
  controllers: [MealsController, GroupMealsController, ChildMealsController],
  providers: [MealsService, MealsRepository],
  exports: [MealsService, MealsRepository],
})
export class MealsModule {}
