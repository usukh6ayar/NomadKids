import { Module } from "@nestjs/common";
import { QpayModule } from "../integrations/qpay/qpay.module";
import { ReportsModule } from "../reports/reports.module";
import { FinanceReportPdfService } from "./finance-report-pdf.service";
import {
  ChildFinanceController,
  FinanceReportPdfController,
  ChildInvoicesController,
  InvoicesController,
  KindergartenInvoicesController,
  PaymentsController,
} from "./invoices.controller";
import { FinanceDashboardRepository } from "./finance-dashboard.repository";
import { FinanceDashboardService } from "./finance-dashboard.service";
import { FinanceReportsModule } from "./finance-reports.module";
import { InvoicesRepository } from "./invoices.repository";
import { InvoicesService } from "./invoices.service";
import { InvoiceQpayController, QpayCallbackController } from "./qpay-payments.controller";
import { QpayPaymentsService } from "./qpay-payments.service";

/**
 * Parent invoices and payments — `нэмэлт.md` §7, §8, §14.
 *
 * ★ `QpayModule` is imported rather than reached globally, which is how the
 * blast radius of a payment provider stays measurable: exactly one module can
 * talk to QPay, and it is this one.
 *
 * Exported so the financial dashboard (§9) and the nine reports (§16) can read
 * billing without a second repository over the same tables.
 */
@Module({
  imports: [QpayModule, FinanceReportsModule, ReportsModule],
  controllers: [
    KindergartenInvoicesController,
    InvoicesController,
    PaymentsController,
    ChildInvoicesController,
    ChildFinanceController,
    InvoiceQpayController,
    QpayCallbackController,
    FinanceReportPdfController,
  ],
  providers: [
    InvoicesService,
    InvoicesRepository,
    QpayPaymentsService,
    FinanceDashboardService,
    FinanceDashboardRepository,
    FinanceReportPdfService,
  ],
  exports: [InvoicesService, InvoicesRepository],
})
export class InvoicesModule {}
