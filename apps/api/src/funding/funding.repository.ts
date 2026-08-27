import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { AgeBand, FundingSource } from "../domain/enums";

/**
 * Funding rules and monthly calculations — нэмэлт.md §4, §5, §6.
 */
@Injectable()
export class FundingRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Rules ──────────────────────────────────────────────────────────────────

  async listRules(kindergartenId: string) {
    return this.prisma.fundingRule.findMany({
      where: { kindergartenId, deletedAt: null },
      orderBy: [{ source: "asc" }, { effectiveFrom: "desc" }],
    });
  }

  /**
   * The rules that could apply to a month, for one source.
   *
   * ★ Overlap by date is the caller's problem, not a database constraint.
   *
   * Postgres can express "no two rules for the same source overlap" only with
   * an exclusion constraint over a range type, which Prisma cannot model — and
   * an overlap is legitimate anyway when an age-banded rule sits inside a
   * general one. The service picks the most specific and records which rule it
   * used on the calculation.
   */
  async rulesInForce(kindergartenId: string, source: FundingSource, monthEnd: Date) {
    return this.prisma.fundingRule.findMany({
      where: {
        kindergartenId,
        source,
        deletedAt: null,
        effectiveFrom: { lte: monthEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: monthEnd } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
  }

  async findRule(id: string) {
    return this.prisma.fundingRule.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, kindergartenId: true },
    });
  }

  async createRule(data: Record<string, unknown>) {
    return this.prisma.fundingRule.create({ data: data as never });
  }

  async updateRule(id: string, data: Record<string, unknown>) {
    return this.prisma.fundingRule.update({ where: { id }, data });
  }

  async softDeleteRule(id: string) {
    return this.prisma.fundingRule.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Calculations ───────────────────────────────────────────────────────────

  /**
   * Every enrolled child with their attendance and meal counts for the month.
   *
   * ★ Three grouped queries, not one per child.
   *
   * A kindergarten of three hundred children calculating a month would
   * otherwise be nine hundred round trips — the N+1 CLAUDE.md §3.4 forbids, in
   * the one place where it would run inside a request an administrator is
   * waiting on.
   */
  async monthInputs(kindergartenId: string, from: Date, to: Date) {
    const [enrollments, attendance, meals] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { kindergartenId, status: "ACTIVE", deletedAt: null },
        select: {
          id: true,
          childId: true,
          child: { select: { id: true, lastName: true, firstName: true } },
          group: { select: { id: true, ageBand: true } },
        },
      }),
      this.prisma.attendance.groupBy({
        by: ["childId"],
        where: {
          kindergartenId,
          deletedAt: null,
          date: { gte: from, lte: to },
          // ★ Which statuses count as a funded day.
          //
          // PRESENT and HALF_DAY only: a child who was excused, ill, absent or
          // OTHER did not attend, and claiming funding for them is the error
          // this list exists to prevent. HALF_DAY counts as a full day here
          // because §5 offers no half-rate — if the client wants one, it
          // belongs in `FundingRule`, not hidden in a filter.
          status: { in: ["PRESENT", "HALF_DAY"] },
        },
        _count: { _all: true },
      }),
      /*
       * ★ Grouped by `childId` **and `date`**, so one group is one fed day.
       *
       * This read used to group by `childId` alone and count rows, which is
       * wrong by a factor of however many sittings a kindergarten serves:
       * `MealRecord` is unique on `(enrollmentId, date, kind)`, so a child fed
       * breakfast, lunch and a snack has three rows for one day. Multiplying a
       * per-day tariff — §5's "Нэг өдрийн тариф" — by a count of sittings
       * overstated a claim against state funding threefold.
       *
       * `нэмэлт.md` says "хооллосон **өдөр**" throughout, and §6 reports it
       * beside "ирсэн **өдөр**": both are day counts. `demo-data.ts` has always
       * built the figure this way — one increment per date on which the child
       * ate anything — and this now agrees with it.
       *
       * Grouping by the pair yields exactly the distinct `(child, date)` pairs
       * that have at least one qualifying row, which is the definition. The
       * caller counts the groups per child.
       */
      this.prisma.mealRecord.groupBy({
        by: ["childId", "date"],
        where: {
          kindergartenId,
          deletedAt: null,
          date: { gte: from, lte: to },
          // Anything but NOT_TAKEN: the kitchen cooked and served. Which
          // statuses qualify is unchanged — only the unit is.
          status: { in: ["TAKEN", "PARTIAL", "SPECIAL"] },
        },
      }),
    ]);

    /*
     * Fed days per child.
     *
     * Reduced here rather than returned raw so the caller cannot repeat the
     * original mistake: the shape it receives is already "days", not rows.
     * `attendance` needs no such treatment — `Attendance` is unique on
     * `(enrollmentId, date)`, so there one row *is* one day.
     */
    const fedDays = new Map<string, number>();
    for (const group of meals) {
      fedDays.set(group.childId, (fedDays.get(group.childId) ?? 0) + 1);
    }

    return {
      enrollments,
      attendance,
      meals: [...fedDays].map(([childId, daysFed]) => ({ childId, daysFed })),
    };
  }

  async listCalculations(kindergartenId: string, month: Date, source?: FundingSource) {
    return this.prisma.fundingCalculation.findMany({
      where: {
        kindergartenId,
        month,
        deletedAt: null,
        ...(source ? { source } : {}),
      },
      orderBy: { child: { lastName: "asc" } },
      include: { child: { select: { id: true, lastName: true, firstName: true } } },
    });
  }

  /**
   * Replaces a month's calculations for one source, in one transaction.
   *
   * ★ Soft-deletes the previous run rather than updating it.
   *
   * A recalculation after an attendance correction is a *new* answer, and the
   * old one is what somebody may already have submitted. Keeping both, with the
   * superseded row soft-deleted, is what lets a disputed figure be traced —
   * §14's "Өмнөх утга → Шинэ утга" in the only form this table can hold it.
   */
  async replaceMonth(
    kindergartenId: string,
    month: Date,
    source: FundingSource,
    rows: Record<string, unknown>[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.fundingCalculation.updateMany({
        where: { kindergartenId, month, source, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      for (const row of rows) {
        await tx.fundingCalculation.create({ data: row as never });
      }

      return tx.fundingCalculation.findMany({
        where: { kindergartenId, month, source, deletedAt: null },
        orderBy: { child: { lastName: "asc" } },
        include: { child: { select: { id: true, lastName: true, firstName: true } } },
      });
    });
  }

  async findCalculation(id: string) {
    return this.prisma.fundingCalculation.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, kindergartenId: true, childId: true, month: true, source: true },
    });
  }

  async updateCalculation(id: string, data: Record<string, unknown>) {
    return this.prisma.fundingCalculation.update({
      where: { id },
      data,
      include: { child: { select: { id: true, lastName: true, firstName: true } } },
    });
  }

  /** The month's totals — нэмэлт.md §6 and the §9 dashboard. */
  async monthTotals(kindergartenId: string, month: Date) {
    const rows = await this.prisma.fundingCalculation.groupBy({
      by: ["source"],
      where: { kindergartenId, month, deletedAt: null },
      _sum: { calculatedAmount: true, approvedAmount: true, receivedAmount: true },
      _count: { _all: true },
    });

    return rows.map((row) => ({
      source: row.source,
      children: row._count._all,
      calculated: row._sum.calculatedAmount?.toString() ?? "0",
      approved: row._sum.approvedAmount?.toString() ?? "0",
      received: row._sum.receivedAmount?.toString() ?? "0",
    }));
  }
}

export type { AgeBand };
