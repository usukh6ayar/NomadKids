import { Module } from "@nestjs/common";
import {
  ChildSurveysController,
  KindergartenSurveysController,
  SurveysController,
} from "./surveys.controller";
import { SurveysRepository } from "./surveys.repository";
import { SurveysService } from "./surveys.service";

@Module({
  controllers: [KindergartenSurveysController, ChildSurveysController, SurveysController],
  providers: [SurveysService, SurveysRepository],
  exports: [SurveysService, SurveysRepository],
})
export class SurveysModule {}
