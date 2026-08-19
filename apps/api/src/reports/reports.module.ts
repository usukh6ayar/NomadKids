import { Module } from "@nestjs/common";
import { AssessmentModule } from "../assessment/assessment.module";
import { ObservationsModule } from "../observations/observations.module";
import { ChildReportsController, ReportsController } from "./reports.controller";
import { ReportsRepository } from "./reports.repository";
import { ReportsService } from "./reports.service";
import { ReportsQueue } from "./reports.queue";
import { ReportsWorker } from "./reports.worker";
import { ReportGeneratorService } from "./report-generator.service";
import { ReportRetentionService } from "./report-retention.service";
import { PdfRendererService } from "./pdf-renderer.service";

/**
 * Reports — RFP §10.3 (portfolio) and §6.4 (term report).
 *
 * `ObservationsModule` is imported for `ObservationsRepository.readableWhere`:
 * a report is a third reader of the same records, and it composes the same
 * visibility predicate the list and detail endpoints use rather than writing a
 * fourth copy. `test/authz-consistency.test.ts` holds the three to it.
 *
 * `AssessmentModule` supplies term and term-report lookups, so that "may this
 * person ask for this term report" is answered by the module that owns the
 * rule.
 */
@Module({
  imports: [ObservationsModule, AssessmentModule],
  controllers: [ReportsController, ChildReportsController],
  providers: [
    ReportsService,
    ReportsRepository,
    ReportsQueue,
    ReportsWorker,
    ReportGeneratorService,
    ReportRetentionService,
    PdfRendererService,
  ],
  exports: [
    ReportsService,
    ReportsRepository,
    ReportGeneratorService,
    ReportRetentionService,
    ReportsQueue,
    // Exported for /health/readiness, which probes Chromium at deploy time.
    PdfRendererService,
  ],
})
export class ReportsModule {}
