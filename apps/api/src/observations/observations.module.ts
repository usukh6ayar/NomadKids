import { Module } from "@nestjs/common";
import {
  ChildObservationsController,
  GroupObservationStatsController,
  GroupObservationsController,
  ObservationsController,
  ParentObservationsController,
} from "./observations.controller";
import { ObservationsRepository } from "./observations.repository";
import { ObservationsService } from "./observations.service";

@Module({
  controllers: [
    ChildObservationsController,
    ParentObservationsController,
    ObservationsController,
    GroupObservationStatsController,
    GroupObservationsController,
  ],
  providers: [ObservationsService, ObservationsRepository],
  exports: [ObservationsService, ObservationsRepository],
})
export class ObservationsModule {}
