import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "../generated/prisma/client";
import type { InvoiceStatus } from "../domain/enums";

const CHILD_SELECT = { id: true, lastName: true, firstName: true } as const;

const INVOICE_INCLUDE = {
  child: { select: CHILD_SELECT },
  lineItems: { orderBy: { createdAt: "asc" as const } },
  payments: {
    orderBy: { createdAt: "asc" as const },
    include: { recordedBy: { select: CHILD_SELECT } },
  },
} satisfies Prisma.InvoiceInclude;

/**
 * Invoices, their line items and the payments against them — нэмэлт.md §7, §8.
 */
@Injectable()
export class InvoicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Invoices ───────────────────────────────────────────────────────────────

  /**
   * The child's most recent live invoice, for `previousBalance` — the
   * single-entry principle (нэмэлт.md §17) applied to billing: a family's
   * running balance is read forward from their own last bill, never
   * re-entered by whoever generates the next one.
   */
  async findLastInvoiceForChild(childId: string, beforeMonth: Date) {
    return this.prisma.invoice.findFirst({
      where: { childId, deletedAt: null, month: { lt: beforeMonth } },
      orderBy: { month: "desc" },
      select: { id: true, balance: true },
    });
  }

  async findByChildAndMonth(childId: string, month: Date) {
    return this.prisma.invoice.findFirst({
      where: { childId, month, deletedAt: null },
      include: INVOICE_INCLUDE,
    });
  }

  async findInvoice(id: string) {
    return this.prisma.invoice.findFirst({
      where: { id, deletedAt: null },
      include: INVOICE_INCLUDE,
    });
  }

  /**
   * Ownership + existence in one query, for authorization checks and for
   * `QpayService`'s "how much is actually owed right now" check — `balance`
   * is included for that second use, not just the fields authorization needs.
   */
  async findInvoiceRef(id: string) {
    return this.prisma.invoice.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        kindergartenId: true,
        childId: true,
        paidAmount: true,
        balance: true,
        status: true,
      },
    });
  }

  /**
   * One child's own invoices, full shape — the guardian-facing read.
   *
   * ★ `INVOICE_INCLUDE`, not the summary the kindergarten-wide list uses.
   *
   * A parent looking at their own child has at most a handful of invoices ever
   * — one a month — so there is no cost to returning line items and payment
   * history inline, and doing so saves a second round trip per invoice that
   * `/invoices` (many families, summary rows, drill in for detail) correctly
   * avoids at its own scale.
   */
  async listForChild(childId: string, page: { skip: number; take: number }) {
    const where: Prisma.InvoiceWhereInput = { childId, deletedAt: null };

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { month: "desc" },
        skip: page.skip,
        take: page.take,
        include: INVOICE_INCLUDE,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { items, total };
  }

  async listInvoices(
    kindergartenId: string,
    filters: { month?: Date; childId?: string; status?: InvoiceStatus },
    page: { skip: number; take: number },
  ) {
    const where: Prisma.InvoiceWhereInput = {
      kindergartenId,
      deletedAt: null,
      ...(filters.month ? { month: filters.month } : {}),
      ...(filters.childId ? { childId: filters.childId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: [{ month: "desc" }, { child: { lastName: "asc" } }],
        skip: page.skip,
        take: page.take,
        include: { child: { select: CHILD_SELECT } },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Creates an invoice and its line items in one transaction.
   *
   * ★ `totalDue`/`balance` are computed by the caller (`InvoicesService`) and
   * passed in already-frozen — this method never does arithmetic, matching
   * `FundingRepository`'s own division of labour (the service decides the
   * numbers, the repository persists them).
   */
  async createInvoice(
    invoice: Prisma.InvoiceUncheckedCreateInput,
    lineItems: Prisma.InvoiceLineItemCreateWithoutInvoiceInput[],
  ) {
    return this.prisma.invoice.create({
      data: { ...invoice, lineItems: { create: lineItems } },
      include: INVOICE_INCLUDE,
    });
  }

  /**
   * Regenerating a month's invoice — only ever called once the service has
   * confirmed `paidAmount` is zero (`нэмэлт.md` §14: money that has moved gets
   * a reversal, not a rewritten bill). Replaces the line items outright and
   * recomputes the frozen columns, the same "supersede, don't patch" shape
   * `FundingRepository.replaceMonth` uses for its own recalculation.
   */
  async replaceInvoice(
    id: string,
    invoice: Prisma.InvoiceUpdateInput,
    lineItems: Prisma.InvoiceLineItemCreateWithoutInvoiceInput[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
      return tx.invoice.update({
        where: { id },
        data: { ...invoice, lineItems: { create: lineItems } },
        include: INVOICE_INCLUDE,
      });
    });
  }

  async updateInvoice(id: string, data: Prisma.InvoiceUpdateInput) {
    return this.prisma.invoice.update({ where: { id }, data, include: INVOICE_INCLUDE });
  }

  async setStatus(id: string, status: InvoiceStatus) {
    return this.prisma.invoice.update({
      where: { id },
      data: { status },
      include: INVOICE_INCLUDE,
    });
  }

  /**
   * The highest invoice number already issued in this kindergarten this year,
   * for `nextInvoiceNumber`.
   *
   * ★ Soft-deleted invoices are included **on purpose**, which is the one place
   * in this repository that departs from the base filter. A number belongs to a
   * document that was issued; reusing it after a void would make two different
   * bills answer to one reference a parent may already have quoted on a
   * transfer.
   */
  async lastInvoiceNumber(kindergartenId: string, prefix: string) {
    return this.prisma.invoice.findFirst({
      where: { kindergartenId, number: { startsWith: prefix } },
      select: { number: true },
      orderBy: { number: "desc" },
    });
  }

  async softDeleteInvoice(id: string) {
    return this.prisma.invoice.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Generating a month from the tariffs — нэмэлт.md §3, §7 ─────────────────

  /**
   * The `PARENT` funding rules in force at the end of the month being billed.
   *
   * ★ `invoiceItemKind: { not: null }` is the filter that makes a rule
   * billable. A `PARENT` rule without one cannot say which kind of line it
   * produces, so it is configuration somebody started and did not finish —
   * skipped rather than guessed at.
   *
   * ★★ In force is judged at `monthEnd`, not at "now". Billing February in
   * March must use February's prices, or a mid-March tariff change silently
   * rewrites a month that has already happened.
   */
  async parentTariffsInForce(kindergartenId: string, monthEnd: Date) {
    return this.prisma.fundingRule.findMany({
      where: {
        kindergartenId,
        source: "PARENT",
        deletedAt: null,
        invoiceItemKind: { not: null },
        effectiveFrom: { lte: monthEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: monthEnd } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
  }

  /**
   * Everything a month's billing needs, in three queries rather than three per
   * child — CLAUDE.md §3.4, in the place it would hurt most: a whole roll being
   * billed while an accountant waits.
   */
  async billingInputs(kindergartenId: string, from: Date, to: Date) {
    const [enrollments, attendance, meals] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { kindergartenId, status: "ACTIVE", deletedAt: null },
        select: {
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
          status: { in: ["PRESENT", "HALF_DAY"] },
        },
        _count: { _all: true },
      }),
      // ★ Grouped by the (child, date) pair — one group is one fed day, never
      // one sitting. A child who ate breakfast, lunch and supper has one billed
      // day; grouping by child alone would overcharge that parent threefold.
      this.prisma.mealRecord.groupBy({
        by: ["childId", "date"],
        where: {
          kindergartenId,
          deletedAt: null,
          date: { gte: from, lte: to },
          status: { in: ["TAKEN", "PARTIAL", "SPECIAL"] },
        },
      }),
    ]);

    const fedDays = new Map<string, number>();
    for (const group of meals) {
      fedDays.set(group.childId, (fedDays.get(group.childId) ?? 0) + 1);
    }

    return { enrollments, attendance, fedDays };
  }

  // ── Payments ───────────────────────────────────────────────────────────────

  async findPayment(id: string) {
    return this.prisma.payment.findFirst({ where: { id } });
  }

  /**
   * Records a payment and recomputes the invoice's totals in one transaction
   * — CLAUDE.md's own reasoning for "never a separate step that can drift",
   * applied here to money instead of a status flag.
   */
  async recordPayment(invoiceId: string, payment: Prisma.PaymentUncheckedCreateInput) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({ data: payment });
      const invoice = await recomputeTotals(tx, invoiceId);
      return { payment: created, invoice };
    });
  }

  /**
   * Voids a payment — sets `voidedAt` on the original and inserts a reversal
   * row with the negated amount, then recomputes the invoice. Both rows stay
   * forever; see the `Payment` model's own comment for why the sum needs no
   * `voidedAt` filter to net out correctly.
   *
   * Re-fetches the original inside the transaction rather than trusting a
   * caller-supplied snapshot, and throws if it is already voided or is itself
   * a reversal row — voiding a reversal has no meaning this schema can express.
   */
  async voidPayment(paymentId: string, note: string | null, voidedById: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (original.voidedAt) throw new NotFoundException();
      if (original.reversalOfId) throw new NotFoundException();

      await tx.payment.update({ where: { id: original.id }, data: { voidedAt: new Date() } });

      const reversal = await tx.payment.create({
        data: {
          kindergartenId: original.kindergartenId,
          invoiceId: original.invoiceId,
          amount: original.amount.negated(),
          method: original.method,
          reversalOfId: original.id,
          recordedById: voidedById,
          note,
        },
      });

      const invoice = await recomputeTotals(tx, original.invoiceId);
      return { reversal, invoice };
    });
  }
}

/**
 * Recomputes `paidAmount`, `balance` and the auto-derivable half of `status`
 * from the invoice's live payment rows — the one place this arithmetic
 * happens, so a payment and a void can never disagree with the invoice they
 * both touch.
 *
 * ★ Never writes `REFUNDED`. That status is a person's call
 * (`InvoicesService.markRefunded`), not a number crossing zero — "the balance
 * nets out" and "this family got their money back" are different facts.
 */
async function recomputeTotals(tx: Prisma.TransactionClient, invoiceId: string) {
  const [invoice, sum] = await Promise.all([
    tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } }),
    tx.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } }),
  ]);

  // ★ Decimal throughout, never a JS number. This is a repository, so
  // `Prisma.Decimal` is the sanctioned type here (CLAUDE.md §2.2) — and it is
  // decimal.js underneath, so a value crossing into a service unchanged
  // behaves identically there.
  //
  // The earlier version of this function summed with `.toNumber()` and `-`.
  // A month's bills are a sum of many lines, and the error only ever shows up
  // where it is most expensive: reconciling against a bank statement, where a
  // one-tögrög discrepancy casts doubt on every other figure beside it.
  const paid = sum._sum.amount ?? new Prisma.Decimal(0);
  const balance = invoice.totalDue.sub(paid);
  const overdue = new Date() > invoice.dueDate;

  let status: InvoiceStatus = invoice.status;
  if (status !== "REFUNDED") {
    if (balance.lte(0)) status = "PAID";
    else if (paid.gt(0)) status = overdue ? "OVERDUE" : "PARTIALLY_PAID";
    else status = overdue ? "OVERDUE" : "UNPAID";
  }

  return tx.invoice.update({
    where: { id: invoiceId },
    data: { paidAmount: paid.toFixed(2), balance: balance.toFixed(2), status },
    include: INVOICE_INCLUDE,
  });
}
