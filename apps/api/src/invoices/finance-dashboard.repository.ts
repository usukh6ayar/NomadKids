import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The reads behind the financial dashboard — `нэмэлт.md` §9.
 *
 * ★ Aggregates only. Not one row of this file names a child, and that is the
 * difference between this and `/kindergartens/:id/funding`. A dashboard answers
 * "how is the month going"; the register answers "who was funded for how many
 * days". Keeping the aggregate query free of child rows means the dashboard
 * cannot become a second, unpaginated export of the roster (CLAUDE.md §3.4).
 *
 * ★★ Every figure is a `Decimal` sum from the database, serialised as a string
 * by the service. Summing in JavaScript would pull the rows across to do it,
 * which is both the N+1 §3.4 forbids and a float waiting to happen.
 */
@Injectable()
export class FinanceDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * State funding for the month — §9's first three figures.
   *
   * `calculated` is what the rules produced, `approved` what the state
   * confirmed, `received` what actually arrived. §9 asks for the outstanding
   * amount too; it is `approved − received` and the service derives it rather
   * than storing a fourth number that can disagree with the three.
   */
  async stateFunding(kindergartenId: string, month: Date) {
    const result = await this.prisma.fundingCalculation.aggregate({
      where: { kindergartenId, month, source: "STATE", deletedAt: null },
      _sum: { calculatedAmount: true, approvedAmount: true, receivedAmount: true },
      _count: { _all: true },
    });

    return {
      children: result._count._all,
      calculated: result._sum.calculatedAmount ?? new Prisma.Decimal(0),
      approved: result._sum.approvedAmount ?? new Prisma.Decimal(0),
      received: result._sum.receivedAmount ?? new Prisma.Decimal(0),
    };
  }

  /**
   * What was billed to families this month — §9's "Эцэг эхийн нийт нэхэмжлэл".
   *
   * ★ `REFUNDED` is excluded: it was reversed, so it is not money the
   * kindergarten is owed. It stays in the ledger — §14 — but not in this total.
   *
   * ★★ There is no draft filter. The merged-in invoice implementation has no
   * `issuedAt`: an invoice exists or it is soft-deleted, and the state between
   * the two that this query used to exclude was never reachable — nothing ever
   * created one. Soft-deleted rows are excluded by `deletedAt: null` as usual.
   */
  async invoiced(kindergartenId: string, month: Date) {
    const result = await this.prisma.invoice.aggregate({
      where: {
        kindergartenId,
        month,
        deletedAt: null,
        status: { not: "REFUNDED" },
      },
      _sum: { totalDue: true },
      _count: { _all: true },
    });

    return {
      invoices: result._count?._all ?? 0,
      billed: result._sum?.totalDue ?? new Prisma.Decimal(0),
    };
  }

  /**
   * What families have actually paid against this month's invoices.
   *
   * ★ Filtered by the **invoice's** month, not the payment's date. A parent
   * paying February's bill in March is February's income as far as
   * reconciliation is concerned, and a dashboard that moved it would leave
   * February permanently short.
   *
   * Reversals subtract, because they carry a negative amount — one sum, no
   * second code path (`нэмэлт.md` §14).
   *
   * ★ No `status` filter on the payment. The merged-in `Payment` has no status
   * column: a row exists once money has moved, and a void is a second row with
   * the negated amount rather than a state change on the first. Summing every
   * row is therefore both simpler and the only correct thing to do — filtering
   * out voided rows would double-count, since the reversal is what cancels them.
   */
  async collected(kindergartenId: string, month: Date) {
    const result = await this.prisma.payment.aggregate({
      where: {
        kindergartenId,
        invoice: {
          month,
          deletedAt: null,
          status: { not: "REFUNDED" },
        },
      },
      _sum: { amount: true },
    });

    return result._sum?.amount ?? new Prisma.Decimal(0);
  }

  /**
   * Bills past their due date with money still owed — §9's "Хугацаа хэтэрсэн".
   *
   * ★ Not filtered by month, and deliberately so. Every other figure here is
   * "how is this month going"; this one is "what is outstanding right now",
   * and an overdue January invoice is still overdue in March. Scoping it to the
   * month would make the number shrink on the first of every month, which is
   * the opposite of what an accountant needs from it.
   *
   * ★★ Reads `dueDate` against the clock rather than trusting the `OVERDUE`
   * status. The status is refreshed when a payment lands (`statusFor`), so an
   * invoice nobody has touched since its due date passed may still say
   * `UNPAID`. The date is the fact; the status is a cache of it.
   */
  async overdue(kindergartenId: string, asOf: Date) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        kindergartenId,
        deletedAt: null,
        // `startOfDay`, not `asOf` itself — `dueDate` is a bare calendar day
        // (`@db.Date`), and comparing it to the full current instant made a
        // bill due today count as overdue from today's first second.
        dueDate: { lt: startOfDay(asOf) },
        status: { notIn: ["PAID", "REFUNDED"] },
      },
      select: { id: true, totalDue: true },
    });

    if (invoices.length === 0) {
      return { count: 0, amount: new Prisma.Decimal(0) };
    }

    /*
     * One grouped query for the payments, rather than one per invoice: a
     * kindergarten with two years of arrears would otherwise make this the
     * slowest screen in the product.
     */
    const paid = await this.prisma.payment.groupBy({
      by: ["invoiceId"],
      where: { invoiceId: { in: invoices.map((invoice) => invoice.id) } },
      _sum: { amount: true },
    });

    const paidByInvoice = new Map(paid.map((row) => [row.invoiceId, row._sum?.amount]));

    let amount = new Prisma.Decimal(0);
    let count = 0;

    for (const invoice of invoices) {
      const settled = paidByInvoice.get(invoice.id) ?? new Prisma.Decimal(0);
      const outstanding = invoice.totalDue.sub(settled);

      // A part-paid invoice counts for what is left, not for its face value.
      if (outstanding.isPositive() && !outstanding.isZero()) {
        amount = amount.add(outstanding);
        count += 1;
      }
    }

    return { count, amount };
  }

  /**
   * How many children are carrying a balance right now — the board's
   * "Төлбөр төлөх ёстой хүүхдийн тоо".
   *
   * ★ **Not scoped to a month**, for the same reason `overdue` is not: a
   * family that owes for February still owes in March, and a count that reset
   * on the first would tell an accountant their chasing list was empty.
   *
   * ★★ Reads `Invoice.balance` rather than recomputing from payments. That
   * column is maintained inside the same transaction as every payment and void
   * (`InvoicesRepository.recomputeTotals`) and is what `/invoices` already
   * filters and sorts by — a count derived a second way here would eventually
   * disagree with the list it sends the accountant to.
   *
   * ★★★ A grouped count, not a `findMany` the caller measures: a kindergarten
   * with two years of arrears must not pull every invoice across to produce
   * one integer (§3.4).
   */
  async childrenOwing(kindergartenId: string) {
    const rows = await this.prisma.invoice.groupBy({
      by: ["childId"],
      where: {
        kindergartenId,
        deletedAt: null,
        status: { not: "REFUNDED" },
        balance: { gt: 0 },
      },
      _count: { _all: true },
    });

    return rows.length;
  }

  /**
   * Whether this month is ready to be reported on — two counts, for the
   * board's "Анхаарах зүйлс".
   *
   * ★ Counts, not rows. The board needs to know *whether* a tariff is in force
   * and *whether* the month has been run; which rules and which children are
   * the register's job, one press away.
   */
  async fundingReadiness(kindergartenId: string, month: Date, monthEnd: Date) {
    const [rules, calculations] = await Promise.all([
      this.prisma.fundingRule.count({
        where: {
          kindergartenId,
          deletedAt: null,
          effectiveFrom: { lte: monthEnd },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: monthEnd } }],
        },
      }),
      this.prisma.fundingCalculation.count({
        where: { kindergartenId, month, deletedAt: null },
      }),
    ]);

    return { rules, calculations };
  }

  /**
   * Which kindergartens a child has been enrolled in, and who may view them.
   *
   * ★ A **tenancy** lookup, deliberately not `ChildAccessService`.
   *
   * That service answers "may this person read the child's developmental
   * record", and its three chains are guardian, assigned teacher and admin —
   * an accountant is none of them, and `нэмэлт.md` §13 says they must not be.
   * Routing the accountant through it returned 404 for the role the finance
   * module exists to serve; the integration suite caught it
   * (`includes the funding history for finance staff`).
   *
   * The fix is a different question rather than a wider answer: *is this child
   * one of ours, and is this person a guardian of theirs?* Both facts, one
   * query, and `canAccessChild` stays exactly as narrow as it was.
   *
   * ★★ Reads `Enrollment` history with a fallback to the denormalised column,
   * mirroring `childKindergartenIds` in `authz/child-access.ts` — CLAUDE.md
   * §1.2's one sanctioned exception, for a child registered but not yet
   * enrolled.
   */
  async childTenancy(childId: string) {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, deletedAt: null },
      select: {
        id: true,
        kindergartenId: true,
        enrollments: {
          where: { deletedAt: null },
          select: { kindergartenId: true },
        },
        guardianships: {
          where: { deletedAt: null },
          select: { guardianUserId: true, canView: true },
        },
      },
    });

    if (!child) return null;

    const kindergartenIds =
      child.enrollments.length > 0
        ? [...new Set(child.enrollments.map((e) => e.kindergartenId))]
        : [child.kindergartenId];

    return { kindergartenIds, guardianships: child.guardianships };
  }

  /**
   * One child's funding history — `нэмэлт.md` §10's "Улсын санхүүжилтийн
   * түүх" and "Ирцэд үндэслэсэн тооцоо".
   *
   * ★ The stored inputs come back with the amounts: `daysAttended`, `daysFed`
   * and `dailyRate` are what the figure was computed from, and §10 asks for the
   * attendance-based calculation rather than just its result. Showing the
   * amount alone would leave a parent's question — "why this number?" —
   * answerable only by an accountant with the register open.
   *
   * ★★ Bounded to the last two years. §3.4 forbids an unbounded list, and a
   * child's whole history is not what this tab is for; the register answers
   * "every month ever".
   */
  async childFundingHistory(childId: string, since: Date) {
    return this.prisma.fundingCalculation.findMany({
      where: { childId, deletedAt: null, month: { gte: since } },
      select: {
        id: true,
        month: true,
        source: true,
        daysAttended: true,
        daysFed: true,
        dailyRate: true,
        calculatedAmount: true,
        approvedAmount: true,
        receivedAmount: true,
        fundingRule: { select: { name: true, dependsOnMeals: true } },
      },
      orderBy: { month: "desc" },
      take: 24,
    });
  }

  /**
   * What a child still owes across every invoice — §10's "Үлдэгдэл".
   *
   * ★ Not scoped to a month, unlike the dashboard's own figures: a balance is
   * a running total by definition, and one that reset each month would tell a
   * family they owe nothing on the first of every month.
   */
  async childBalance(childId: string) {
    const [billed, paid, discounts] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: {
          childId,
          deletedAt: null,
          status: { not: "REFUNDED" },
        },
        _sum: { totalDue: true, discountAmount: true },
        _count: { _all: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          invoice: {
            childId,
            deletedAt: null,
            status: { not: "REFUNDED" },
          },
        },
        _sum: { amount: true },
      }),
      // §10 names "Хөнгөлөлт" as a figure of its own, so it is reported rather
      // than silently folded into the total it has already reduced.
      this.prisma.invoice.aggregate({
        where: { childId, deletedAt: null },
        _sum: { discountAmount: true },
      }),
    ]);

    return {
      invoices: billed._count?._all ?? 0,
      billed: billed._sum?.totalDue ?? new Prisma.Decimal(0),
      paid: paid._sum?.amount ?? new Prisma.Decimal(0),
      discounts: discounts._sum?.discountAmount ?? new Prisma.Decimal(0),
    };
  }

  /**
   * The month's meal cost — §9's last two figures, and §3's own calculation.
   *
   * ★ Derived from the funding rules that bill per fed day, not from a new
   * table. §3 gives the formula as "хүүхдийн тоо × хооллосон өдөр × тариф",
   * and every one of those three numbers already exists: `daysFed` and
   * `dailyRate` are stored on each `FundingCalculation` at the moment it was
   * run, precisely so the figure cannot drift when a rule changes later.
   *
   * ★★ Split by source, which is exactly what §3 asks for ("Хоолны зардлыг эх
   * үүсвэрээр салгаж харуулна"). A kindergarten whose meals are part state
   * funded and part parent paid sees both halves rather than one blended
   * number that answers neither question.
   *
   * ★★★ Only rows whose rule depended on meals. A tuition rule multiplied by
   * attended days is not a meal cost, and folding it in would inflate the
   * per-child average — the figure most likely to be quoted at a board meeting.
   */
  async mealCost(kindergartenId: string, month: Date) {
    const rows = await this.prisma.fundingCalculation.findMany({
      where: {
        kindergartenId,
        month,
        deletedAt: null,
        fundingRule: { dependsOnMeals: true },
      },
      select: {
        source: true,
        daysFed: true,
        childId: true,
        calculatedAmount: true,
      },
    });

    const bySource = new Map<string, Prisma.Decimal>();
    const children = new Set<string>();
    let total = new Prisma.Decimal(0);
    let fedDays = 0;

    for (const row of rows) {
      total = total.add(row.calculatedAmount);
      fedDays += row.daysFed;
      children.add(row.childId);
      bySource.set(
        row.source,
        (bySource.get(row.source) ?? new Prisma.Decimal(0)).add(row.calculatedAmount),
      );
    }

    return {
      total,
      fedDays,
      children: children.size,
      bySource: [...bySource].map(([source, amount]) => ({ source, amount })),
    };
  }
}

/**
 * Midnight UTC for the given instant — same reason and same helper
 * `dashboard.service.ts` and `growth.service.ts` each carry: `dueDate` is a
 * bare calendar day (`@db.Date`), so matching it against a local midnight
 * would miss by the timezone offset.
 */
function startOfDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0),
  );
}
