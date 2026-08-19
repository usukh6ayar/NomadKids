import { Module } from "@nestjs/common";
import {
  AssessmentConfigController,
  ChildAssessmentController,
  GroupAssessmentController,
  TermsController,
} from "./assessment.controller";
import { AssessmentRepository } from "./assessment.repository";
import { AssessmentService } from "./assessment.service";

@Module({
  controllers: [
    AssessmentConfigController,
    TermsController,
    ChildAssessmentController,
    GroupAssessmentController,
  ],
  providers: [AssessmentService, AssessmentRepository],
  exports: [AssessmentService, AssessmentRepository],
})
export class AssessmentModule {}
