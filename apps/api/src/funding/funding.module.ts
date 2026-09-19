import { Module } from "@nestjs/common";
import { EsisModule } from "../integrations/esis/esis.module";
import {
  FinancialAuditLogController,
  FundingController,
  KindergartenFundingController,
} from "./funding.controller";
import { FundingRepository } from "./funding.repository";
import { FundingService } from "./funding.service";

@Module({
  /*
   * ★ `EsisModule` joined on 2026-09-14, for `нэмэлт.md` §3's meal-cost split.
   *
   * Which children the state subsidises is the ministry's decision, not the
   * kindergarten's, and `cook/levelHood/students` is where it says so. That is
   * the half of §3 CLAUDE.md §7 records as **partial**: `dependsOnMeals`
   * weights a rule, but nothing said who the subsidy covers.
   */
  imports: [EsisModule],
  controllers: [KindergartenFundingController, FundingController, FinancialAuditLogController],
  providers: [FundingService, FundingRepository],
  exports: [FundingService, FundingRepository],
})
export class FundingModule {}
