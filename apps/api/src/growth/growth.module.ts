import { Module } from "@nestjs/common";
import { ChildGrowthController, GrowthMeasurementController } from "./growth.controller";
import { GrowthRepository } from "./growth.repository";
import { GrowthService } from "./growth.service";

@Module({
  controllers: [ChildGrowthController, GrowthMeasurementController],
  providers: [GrowthService, GrowthRepository],
  exports: [GrowthService, GrowthRepository],
})
export class GrowthModule {}
