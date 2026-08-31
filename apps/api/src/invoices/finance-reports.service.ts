import { BadRequestException, Injectable } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { buildReportWorkbook } from "./finance-report-workbook";
import { FinanceReportsRepository } from "./finance-reports.repository";
import {
  annualReport,
  childFundingReport,
  mealCostReport,
  mealDaysReport,
  parentPaymentsReport,
  stateFundingReport,
  unpaidReport,
  varianceReport,
  REPORT_TITLE,
  type FinanceReportKey,
  type ReportTable,
} from "./finance-reports";
import { monthBounds } from "./invoice-math";

/**
 * The eight financial reports — `нэмэлт.md` §16.
 *
 * ★ Behind `assertCanReadFinance`: the accountant and the administrator, 404
 * for a teacher (§13). A report is the most concentrated financial document in
 * the product — one file with every child's money in it — so the gate matters
 * more here than on a screen showing one row.
 *
 * ★★ Every download is audited. §14 names "Тайлан татсан" as an event that
 * must be recorded, and it is the only one on this list that leaves no other
 * trace: an export copies the kindergarten's whole financial position onto
 * somebody's laptop, and the audit row is what makes that answerable later.
 */
@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly repo: FinanceReportsRepository,
    private readonly tenants: TenantAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /** The report as data, for a screen. */
  async table(
    actor: Actor,
    kindergartenId: string,
    report: FinanceReportKey,
    period: string,
  ): Promise<ReportTable> {
    this.tenants.assertCanReadFinance(actor, kindergartenId);
    return this.build(kindergartenId, report, period);
  }

  /** The same report as a spreadsheet. */
  async workbook(
    actor: Actor,
    kindergartenId: string,
    report: FinanceReportKey,
    period: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    this.tenants.assertCanReadFinance(actor, kindergartenId);

    const [table, kindergartenName] = await Promise.all([
      this.build(kindergartenId, report, period),
      this.repo.kindergartenName(kindergartenId),
    ]);

    const buffer = await buildReportWorkbook({ table, kindergartenName, period });

    // §14: "Тайлан татсан". Recorded after the file is built, so a failed
    // export does not log a download that never happened.
    await this.audit.append({
      action: "DOWNLOAD",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "FinanceReport",
      objectId: report,
      metadata: { report, period, rows: table.rows.length },
    });

    return { buffer, filename: `${report}-${period}.xlsx` };
  }

  /**
   * The report's data with **no authorization check** — for the PDF worker.
   *
   * ★ The check has already happened. A `FINANCE_REPORT` job only exists
   * because `FinanceReportsService.enqueue` ran `assertCanReadFinance` before
   * queuing it, and the worker has no actor to check against — it runs on a
   * timer, not on a request. Re-checking here would mean inventing a user for
   * the worker to be, which is worse than not checking.
   *
   * ★★ Deliberately named differently from `table(actor, …)` so the two cannot
   * be confused at a call site. Anything reached from a controller uses
   * `table`; this is reachable only from the generator.
   */
  async tableFor(
    kindergartenId: string,
    report: FinanceReportKey,
    period: string,
  ): Promise<ReportTable> {
    return this.build(kindergartenId, report, period);
  }

  /** The kindergarten's name, for a document header. */
  async kindergartenName(kindergartenId: string): Promise<string> {
    return this.repo.kindergartenName(kindergartenId);
  }

  /**
   * Validates a report and period without building it.
   *
   * ★ Used before queuing a PDF, so a malformed period fails at the button
   * rather than in a worker twenty seconds later — where the only symptom
   * would be a job that says FAILED with a message the requester cannot act on.
   */
  assertPeriodValid(report: FinanceReportKey, period: string): void {
    if (report === "annual") {
      schoolYearBounds(period);
      return;
    }
    if (report === "unpaid") return;
    monthBoundsOrThrow(period);
  }

  /**
   * ★ One switch, and every branch reads from the same two queries.
   *
   * The alternative — a method per report, each with its own query — is how
   * "what counts as a funded day" ends up answered differently in the meal
   * report and the variance report. §17's single-entry principle applies to
   * reading as much as to writing.
   */
  private async build(
    kindergartenId: string,
    report: FinanceReportKey,
    period: string,
  ): Promise<ReportTable> {
    if (report === "annual") {
      const { from, to } = schoolYearBounds(period);
      const months = await this.repo.yearCalculations(kindergartenId, from, to);

      return annualReport(
        months.map((row) => ({
          month: row.month,
          source: row.source,
          children: row._count._all,
          calculated: row._sum.calculatedAmount,
          approved: row._sum.approvedAmount,
          received: row._sum.receivedAmount,
        })),
      );
    }

    if (report === "unpaid") {
      // Deliberately every month — arrears are not a property of the month
      // being viewed. `unpaidReport` sorts by how late each bill is.
      const invoices = await this.repo.invoicesWithPayments(kindergartenId, null);
      return unpaidReport(invoices, new Date());
    }

    const { first } = monthBoundsOrThrow(period);

    if (report === "parent-payments") {
      const invoices = await this.repo.invoicesWithPayments(kindergartenId, first);
      return parentPaymentsReport(invoices);
    }

    const rows = await this.repo.monthCalculations(kindergartenId, first);

    switch (report) {
      case "state-funding":
        return stateFundingReport(rows);
      case "child-funding":
        return childFundingReport(rows);
      case "meal-days":
        return mealDaysReport(rows);
      case "meal-cost":
        return mealCostReport(rows);
      case "variance":
        return varianceReport(rows);
    }
  }
}

/** The report titles, for a menu. */
export { REPORT_TITLE };

function monthBoundsOrThrow(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new BadRequestException("Сар YYYY-MM хэлбэртэй байна");
  }
  return monthBounds(period);
}

/**
 * A Mongolian school year as a date range.
 *
 * ★ September to August, not January to December. The kindergarten year starts
 * in September, and an annual summary cut on the calendar year would split
 * every cohort in half — the figure a board is shown at year end would cover
 * two different sets of children.
 *
 * Accepts `2025-2026` or a single `2025`, both meaning September 2025 through
 * August 2026.
 */
function schoolYearBounds(period: string): { from: Date; to: Date } {
  const match = /^(\d{4})(?:-(\d{4}))?$/.exec(period);
  if (!match) {
    throw new BadRequestException("Хичээлийн жил 2025-2026 хэлбэртэй байна");
  }

  const startYear = Number(match[1]);

  return {
    from: new Date(Date.UTC(startYear, 8, 1)),
    to: new Date(Date.UTC(startYear + 1, 7, 1)),
  };
}
