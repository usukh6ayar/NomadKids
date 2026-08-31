import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Prisma } from "../generated/prisma/client";
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

  /** Ownership + existence in one query, for authorization checks that only need the ids. */
  async findInvoiceRef(id: string) {
    return this.prisma.invoice.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, kindergartenId: true, childId: true, paidAmount: true, status: true },
    });
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

  async softDeleteInvoice(id: string) {
    return this.prisma.invoice.update({ where: { id }, data: { deletedAt: new Date() } });
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

  const paidAmount = (sum._sum.amount?.toNumber() ?? 0).toFixed(2);
  const balance = invoice.totalDue.toNumber() - Number(paidAmount);

  let status: InvoiceStatus = invoice.status;
  if (status !== "REFUNDED") {
    if (balance <= 0) status = "PAID";
    else if (Number(paidAmount) > 0) {
      status = new Date() > invoice.dueDate ? "OVERDUE" : "PARTIALLY_PAID";
    } else {
      status = new Date() > invoice.dueDate ? "OVERDUE" : "UNPAID";
    }
  }

  return tx.invoice.update({
    where: { id: invoiceId },
    data: { paidAmount, balance: balance.toFixed(2), status },
    include: INVOICE_INCLUDE,
  });
}
