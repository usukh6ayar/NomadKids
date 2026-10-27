import { Module } from "@nestjs/common";
import {
  ChildSurveysController,
  GroupA79BaselineController,
  KindergartenSurveysController,
  SurveysController,
} from "./surveys.controller";
import { SurveysRepository } from "./surveys.repository";
import { SurveysService } from "./surveys.service";

@Module({
  controllers: [
    KindergartenSurveysController,
    ChildSurveysController,
    GroupA79BaselineController,
    SurveysController,
  ],
  providers: [SurveysService, SurveysRepository],
  exports: [SurveysService, SurveysRepository],
})
export class SurveysModule {}
