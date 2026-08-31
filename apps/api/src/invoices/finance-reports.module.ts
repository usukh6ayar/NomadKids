import { Module } from "@nestjs/common";
import { FinanceReportsRepository } from "./finance-reports.repository";
import { FinanceReportsService } from "./finance-reports.service";

/**
 * The financial reports, as a module of their own — `нэмэлт.md` §16.
 *
 * ★ **Extracted to break a cycle, and the cycle is worth naming.**
 *
 * `InvoicesModule` needs `ReportsModule` to queue a PDF. `ReportsModule` needs
 * the report data to render one. Left in `InvoicesModule`, those two imports
 * point at each other, and Nest resolves that only with `forwardRef` — which
 * works but leaves a graph nobody can read.
 *
 * This module depends on neither. Both import it, and the arrow between them
 * runs one way: `InvoicesModule → ReportsModule → FinanceReportsModule`.
 *
 * ★★ It provides the reports' **data**, never their delivery. The Excel
 * endpoint lives in `InvoicesModule` and the PDF job in `ReportsModule`,
 * because each has its own authorization and its own audit line.
 */
@Module({
  providers: [FinanceReportsService, FinanceReportsRepository],
  exports: [FinanceReportsService],
})
export class FinanceReportsModule {}
