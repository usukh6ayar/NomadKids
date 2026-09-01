import { Module } from "@nestjs/common";
import { ReportsModule } from "../reports/reports.module";
import {
  ChildFinanceController,
  FinanceReportPdfController,
  KindergartenFinanceController,
} from "./finance.controller";
import { FinanceDashboardRepository } from "./finance-dashboard.repository";
import { FinanceDashboardService } from "./finance-dashboard.service";
import { FinanceReportPdfService } from "./finance-report-pdf.service";
import { FinanceReportsModule } from "./finance-reports.module";
import {
  ChildInvoicesController,
  InvoicesController,
  KindergartenInvoicesController,
  PaymentsController,
} from "./invoices.controller";
import { InvoicesRepository } from "./invoices.repository";
import { InvoicesService } from "./invoices.service";

/**
 * Parent invoices and payments, plus the financial dashboard and the §16
 * reports — `нэмэлт.md` §7, §9, §10, §14, §16.
 *
 * ★ `QpayModule` is **not** imported here, and the direction matters. §8's
 * module imports *this* one to reach `InvoicesRepository`; importing it back
 * would close a cycle Nest can only resolve with `forwardRef`. Exactly one
 * module talks to QPay, and it is not this one.
 *
 * ★★ `FinanceReportsModule` exists to break the other cycle: this module needs
 * `ReportsModule` to queue a PDF, and `ReportsModule` needs the report data to
 * render one. Both import `FinanceReportsModule`, which imports neither, so the
 * arrow runs one way — see that module's own comment.
 */
@Module({
  imports: [FinanceReportsModule, ReportsModule],
  controllers: [
    ChildInvoicesController,
    KindergartenInvoicesController,
    KindergartenFinanceController,
    InvoicesController,
    PaymentsController,
    ChildFinanceController,
    FinanceReportPdfController,
  ],
  providers: [
    InvoicesService,
    InvoicesRepository,
    FinanceDashboardService,
    FinanceDashboardRepository,
    FinanceReportPdfService,
  ],
  exports: [InvoicesService, InvoicesRepository],
})
export class InvoicesModule {}
