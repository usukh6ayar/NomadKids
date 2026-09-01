import { Module } from "@nestjs/common";
import {
  FinancialAuditLogController,
  FundingController,
  KindergartenFundingController,
} from "./funding.controller";
import { FundingRepository } from "./funding.repository";
import { FundingService } from "./funding.service";

@Module({
  controllers: [KindergartenFundingController, FundingController, FinancialAuditLogController],
  providers: [FundingService, FundingRepository],
  exports: [FundingService, FundingRepository],
})
export class FundingModule {}
