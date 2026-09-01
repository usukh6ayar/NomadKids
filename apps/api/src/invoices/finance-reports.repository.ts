import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The reads behind the financial reports — `нэмэлт.md` §16.
 *
 * ★ Nine reports, **five queries**. §16 lists them as nine bullet points, and
 * building nine independent readers would mean nine places where "what counts
 * as a funded day" could drift apart — the one property §17's single-entry
 * principle exists to protect. The reports are different *shapes* of four
 * underlying facts: the funding calculations, the invoices, the payments, and
 * the months they fall in.
 *
 * ★★ One of the nine is not here at all. "Ирц–санхүүжилтийн тулгалт" is the
 * monthly register, which shipped with §6 and already has its own Excel export
 * (`FundingService.exportRegister`). Rebuilding it as a tenth reader would put
 * two answers to one question in the product.
 */
@Injectable()
export class FinanceReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every funding calculation for a month, with the child and the rule.
   *
   * Serves four of the nine — the state funding report, the per-child funding
   * report, the meal-cost reports and the variance report. Each filters or
   * groups this differently in the service; none re-queries.
   *
   * ★ Bounded by month, so the row count is the kindergarten's roll rather
   * than its whole history (CLAUDE.md §3.4).
   */
  async monthCalculations(kindergartenId: string, month: Date) {
    return this.prisma.fundingCalculation.findMany({
      where: { kindergartenId, month, deletedAt: null },
      select: {
        id: true,
        source: true,
        daysAttended: true,
        daysFed: true,
        dailyRate: true,
        calculatedAmount: true,
        approvedAmount: true,
        receivedAmount: true,
        note: true,
        child: { select: { id: true, lastName: true, firstName: true } },
        fundingRule: { select: { name: true, dependsOnMeals: true } },
      },
      orderBy: [{ source: "asc" }, { child: { lastName: "asc" } }],
    });
  }

  /**
   * A school year's calculations, grouped by month and source.
   *
   * ★ Aggregated in the database rather than pulled row by row: a year of a
   * 300-child kindergarten is ~3,600 rows, and the annual summary needs twelve
   * numbers from them.
   */
  async yearCalculations(kindergartenId: string, from: Date, to: Date) {
    return this.prisma.fundingCalculation.groupBy({
      by: ["month", "source"],
      where: { kindergartenId, month: { gte: from, lte: to }, deletedAt: null },
      _sum: { calculatedAmount: true, approvedAmount: true, receivedAmount: true },
      _count: { _all: true },
      orderBy: [{ month: "asc" }],
    });
  }

  /**
   * A month's issued invoices with what has been paid against each.
   *
   * Serves the parent-payment report and the unpaid report — the same rows,
   * filtered differently. `month: null` widens it to every month, which is what
   * the unpaid report needs: arrears are not a property of the month you are
   * looking at.
   */
  async invoicesWithPayments(kindergartenId: string, month: Date | null) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        kindergartenId,
        deletedAt: null,
        ...(month ? { month } : {}),
      },
      select: {
        id: true,
        number: true,
        month: true,
        status: true,
        baseAmount: true,
        mealAmount: true,
        extraAmount: true,
        discountAmount: true,
        previousBalance: true,
        totalDue: true,
        dueDate: true,
        child: { select: { id: true, lastName: true, firstName: true } },
      },
      orderBy: [{ month: "desc" }, { number: "asc" }],
      // A hard ceiling rather than pagination: a report is a file, and one
      // that silently stopped at page one would be worse than one that refused.
      // 5,000 invoices is ~14 years for a 300-child kindergarten.
      take: 5_000,
    });

    if (invoices.length === 0) return [];

    /*
     * ★ One grouped query for every payment, not one per invoice. This is the
     * N+1 CLAUDE.md §3.4 forbids, in the place it would hurt most: a report
     * runs over the whole roll while somebody waits for a download.
     */
    const payments = await this.prisma.payment.groupBy({
      by: ["invoiceId"],
      where: { invoiceId: { in: invoices.map((invoice) => invoice.id) } },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const paidBy = new Map(payments.map((row) => [row.invoiceId, row]));

    return invoices.map((invoice) => {
      const paid = paidBy.get(invoice.id);
      const paidAmount = paid?._sum?.amount ?? new Prisma.Decimal(0);

      return {
        ...invoice,
        // ★ `number` is nullable on the invoice — it was added after the rows
        // that existed before it. A report is a document somebody reads, so an
        // unnumbered invoice gets a dash rather than the word "null".
        number: invoice.number ?? "—",
        // The report's own vocabulary, kept stable across the invoice
        // implementation that was merged away: `totalAmount` is what the eight
        // report builders and their 25 tests read.
        totalAmount: invoice.totalDue,
        paidAmount,
        paymentCount: paid?._count?._all ?? 0,
        outstanding: invoice.totalDue.sub(paidAmount),
      };
    });
  }

  /**
   * The payments themselves, for the parent-payment report's detail.
   *
   * ★ Filtered by the **invoice's** month, the same rule the dashboard uses: a
   * February bill paid in March is February's income, and a report that moved
   * it would disagree with the dashboard about the same month.
   */
  async monthPayments(kindergartenId: string, month: Date) {
    return this.prisma.payment.findMany({
      where: {
        kindergartenId,
        invoice: { month, deletedAt: null },
      },
      select: {
        id: true,
        amount: true,
        method: true,
        // ★ `createdAt`, not a separate `paidAt`. A `Payment` row exists only
        // once money has moved — there is no pending state for a date to be
        // waiting on — so the row's own creation is the moment it was received.
        createdAt: true,
        reversalOfId: true,
        note: true,
        invoice: {
          select: {
            number: true,
            child: { select: { id: true, lastName: true, firstName: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 5_000,
    });
  }

  /** The kindergarten's name, for the file's header. */
  async kindergartenName(id: string) {
    const row = await this.prisma.kindergarten.findFirst({
      where: { id, deletedAt: null },
      select: { name: true },
    });
    return row?.name ?? "";
  }
}
