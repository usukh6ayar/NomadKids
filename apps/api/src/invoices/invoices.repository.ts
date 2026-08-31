import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { InvoiceItemKind, InvoiceStatus, PaymentMethod } from "../domain/enums";

/**
 * Parent invoices and payments — `нэмэлт.md` §7, §8.
 *
 * ★ The base filter is `deletedAt: null` **and** the tenant scope, on every
 * method that reads invoices or lines (CLAUDE.md §2.2). `Payment` has no
 * `deletedAt` at all — §14 forbids deleting a confirmed transaction by any
 * mechanism — so its reads carry the tenant scope alone.
 *
 * ★★ Money never becomes a JavaScript `number` anywhere in this file.
 *
 * Prisma returns `Decimal(12,2)` as a `Prisma.Decimal`, and it stays that way:
 * summed with `.add()`, compared with `.cmp()`, serialised with `.toFixed(2)`.
 * The moment a total is coerced to a float it acquires a representation error
 * that a bank statement will eventually disagree with, and the disagreement
 * appears in a reconciliation nobody can explain.
 */
@Injectable()
export class InvoicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Invoices ───────────────────────────────────────────────────────────────

  /**
   * One page of a kindergarten's invoices.
   *
   * Paginated because CLAUDE.md §3.4 forbids an unbounded list, and this is the
   * table that grows fastest in the system: one row per child per month, for
   * every month the kindergarten operates.
   */
  async listInvoices(params: {
    kindergartenId: string;
    month?: Date;
    childId?: string;
    status?: InvoiceStatus[];
    skip: number;
    take: number;
  }) {
    const where: Prisma.InvoiceWhereInput = {
      kindergartenId: params.kindergartenId,
      deletedAt: null,
      ...(params.month ? { month: params.month } : {}),
      ...(params.childId ? { childId: params.childId } : {}),
      ...(params.status && params.status.length > 0 ? { status: { in: params.status } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        select: this.invoiceSelect(),
        orderBy: [{ month: "desc" }, { number: "desc" }],
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * One invoice with its lines and payments.
   *
   * ★ Returns the row whatever kindergarten it belongs to — the caller
   * authorizes. Repositories scope by tenant on *lists*, where a missing filter
   * silently widens a result set; a single fetch by primary key is checked by
   * `authz/` against the row it gets back, which is the pattern the rest of the
   * codebase uses (`findRule` above it does the same).
   */
  async findInvoice(id: string) {
    return this.prisma.invoice.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...this.invoiceSelect(),
        lines: {
          where: { deletedAt: null },
          select: {
            id: true,
            kind: true,
            label: true,
            quantity: true,
            unitAmount: true,
            amount: true,
            note: true,
          },
          orderBy: { createdAt: "asc" },
        },
        payments: {
          select: {
            id: true,
            amount: true,
            method: true,
            status: true,
            paidAt: true,
            // Both provider handles: `providerInvoiceId` is what a PENDING row
            // carries before anyone has paid, and `syncInvoice` needs it to ask
            // QPay about a payment that may never have called back.
            providerInvoiceId: true,
            providerPaymentId: true,
            reversalOfId: true,
            note: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  }

  /** The tenant and status facts an authorization or state check needs. */
  async invoiceFacts(id: string) {
    return this.prisma.invoice.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        kindergartenId: true,
        childId: true,
        status: true,
        issuedAt: true,
        totalAmount: true,
      },
    });
  }

  /**
   * Is this child currently enrolled in this kindergarten?
   *
   * ★ A **tenancy** question, deliberately not `ChildAccessService`.
   *
   * An accountant billing a child needs to know the child is theirs to bill.
   * `canAccessChild` answers a different question — may this person read the
   * child's developmental record — and `нэмэлт.md` §13 says an accountant may
   * not. Widening that predicate to admit them would hand the accountant every
   * observation and assessment in the kindergarten, which is the exact
   * separation §13 exists to draw.
   *
   * Reads `Enrollment`, not `Child.kindergartenId`, for the reason CLAUDE.md
   * §1.2 gives: the column is a denormalised pointer, the enrollment is the
   * fact. A child who transferred away last term is not billable here.
   */
  async isEnrolledIn(childId: string, kindergartenId: string): Promise<boolean> {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { childId, kindergartenId, deletedAt: null },
      select: { id: true },
    });
    return enrollment !== null;
  }

  /** Does a live invoice already exist for this child and month? §7. */
  async findLiveInvoiceFor(childId: string, month: Date) {
    return this.prisma.invoice.findFirst({
      where: { childId, month, deletedAt: null },
      select: { id: true, number: true },
    });
  }

  /**
   * The invoice and its lines in one transaction — `нэмэлт.md` §7.
   *
   * A header without its lines is a bill for an unexplained amount, so the two
   * writes are one unit. Nested `create` gives that without an interactive
   * transaction, which matters because CLAUDE.md §3.6 keeps long-running work
   * out of transactions and §3.5 forbids enqueuing inside one.
   */
  async createInvoice(data: Prisma.InvoiceCreateInput) {
    return this.prisma.invoice.create({ data, select: this.invoiceSelect() });
  }

  async updateInvoice(id: string, data: Prisma.InvoiceUpdateInput) {
    return this.prisma.invoice.update({
      where: { id },
      data,
      select: this.invoiceSelect(),
    });
  }

  async softDeleteInvoice(id: string) {
    const deletedAt = new Date();
    // The lines go with it: an orphaned live line would still be counted by any
    // report that groups lines by kind without joining back to the header.
    return this.prisma.$transaction([
      this.prisma.invoiceLine.updateMany({
        where: { invoiceId: id, deletedAt: null },
        data: { deletedAt },
      }),
      this.prisma.invoice.update({ where: { id }, data: { deletedAt } }),
    ]);
  }

  /**
   * The highest invoice number issued in a kindergarten this year.
   *
   * Used to allocate the next one. The caller holds the uniqueness guarantee
   * through `@@unique([kindergartenId, number])`, which turns a lost race into
   * a constraint violation rather than two invoices sharing a number.
   */
  async lastInvoiceNumber(kindergartenId: string, prefix: string) {
    return this.prisma.invoice.findFirst({
      // Deleted invoices are included on purpose: a number belongs to a
      // document that was issued, and reusing it after a void would make two
      // different bills answer to one reference.
      where: { kindergartenId, number: { startsWith: prefix } },
      select: { number: true },
      orderBy: { number: "desc" },
    });
  }

  /**
   * What a child still owes across every issued invoice — `нэмэлт.md` §7's
   * "Өмнөх үлдэгдэл".
   *
   * Two aggregates rather than a per-invoice loop: one child with three years
   * of history is thirty-six invoices, and this runs while an accountant waits.
   */
  async outstandingFor(childId: string, before: Date) {
    const [billed, paid] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: {
          childId,
          deletedAt: null,
          issuedAt: { not: null },
          month: { lt: before },
          status: { notIn: ["REFUNDED"] },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: "PAID",
          invoice: {
            childId,
            deletedAt: null,
            issuedAt: { not: null },
            month: { lt: before },
            status: { notIn: ["REFUNDED"] },
          },
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      billed: billed._sum.totalAmount ?? new Prisma.Decimal(0),
      paid: paid._sum.amount ?? new Prisma.Decimal(0),
    };
  }

  // ── Payments ───────────────────────────────────────────────────────────────

  async createPayment(data: Prisma.PaymentCreateInput) {
    return this.prisma.payment.create({ data, select: this.paymentSelect() });
  }

  async findPayment(id: string) {
    return this.prisma.payment.findUnique({
      where: { id },
      select: { ...this.paymentSelect(), kindergartenId: true, invoiceId: true },
    });
  }

  /**
   * The payment a provider callback refers to, by its idempotency key.
   *
   * ★ The read half of double-credit protection. A retried QPay callback finds
   * the row it already created and the service returns early; the unique index
   * on the column is the half that holds when two deliveries race.
   */
  async findPaymentByIdempotencyKey(key: string) {
    return this.prisma.payment.findUnique({
      where: { idempotencyKey: key },
      select: { ...this.paymentSelect(), kindergartenId: true, invoiceId: true },
    });
  }

  /**
   * The PENDING QPay row awaiting confirmation, found either way we can find it.
   *
   * ★ Matched on `providerInvoiceId`, never on `providerPaymentId`: the row is
   * written when the QR is generated, at which point QPay has issued an
   * *invoice* id and no payment exists yet. The payment id only arrives with
   * the confirmation.
   *
   * ★★ Two lookup paths because a callback can arrive with either handle, and
   * losing a confirmed payment is worse than a slightly wider query:
   *
   *   - `providerInvoiceId` — QPay's own reference, when their payload carries
   *     it or `paymentsForInvoice` walked us here;
   *   - `invoiceId` — **our** invoice UUID, which `QpayService.createInvoice`
   *     appends to the callback URL as a query parameter for exactly this case.
   *
   * The query parameter is attacker-controllable, and that is safe: it selects
   * which pending row to settle, but the payment itself has already been
   * verified against QPay, and the amount written comes from their answer.
   * The worst a forged parameter achieves is pointing a real payment at the
   * wrong pending row — which `@@unique` on `idempotencyKey` then blocks from
   * happening twice.
   *
   * Oldest first, so a re-issued QR settles the original request.
   */
  async findPendingQpayPayment(handles: { providerInvoiceId?: string; invoiceId?: string }) {
    const or: Prisma.PaymentWhereInput[] = [];
    if (handles.providerInvoiceId) or.push({ providerInvoiceId: handles.providerInvoiceId });
    if (handles.invoiceId) or.push({ invoiceId: handles.invoiceId });
    if (or.length === 0) return null;

    return this.prisma.payment.findFirst({
      where: { status: "PENDING", method: "QPAY", OR: or },
      select: {
        id: true,
        invoiceId: true,
        kindergartenId: true,
        amount: true,
        providerInvoiceId: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async updatePayment(id: string, data: Prisma.PaymentUpdateInput) {
    return this.prisma.payment.update({
      where: { id },
      data,
      select: this.paymentSelect(),
    });
  }

  /** What has actually been received against one invoice. Reversals are negative. */
  async paidTotal(invoiceId: string) {
    const result = await this.prisma.payment.aggregate({
      where: { invoiceId, status: "PAID" },
      _sum: { amount: true },
    });
    return result._sum.amount ?? new Prisma.Decimal(0);
  }

  /** Has this payment already been reversed? §14 allows one reversal, not many. */
  async findReversalOf(paymentId: string) {
    return this.prisma.payment.findFirst({
      where: { reversalOfId: paymentId },
      select: { id: true },
    });
  }

  // ── Tariffs ────────────────────────────────────────────────────────────────

  /**
   * The `PARENT` funding rules in force for a month that name an invoice line
   * kind — the tariffs an invoice is built from.
   *
   * ★ Reads `FundingRule`, the table `FundingRepository` owns. Two repositories
   * touching one table is allowed by CLAUDE.md §2.2 — the rule is that nothing
   * *outside* a repository touches Prisma — and the alternative is worse: an
   * invoice service reaching into another module's repository, or a second copy
   * of the tariff table.
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
   * Children with a live enrollment in the month, with the counts a tariff can
   * multiply.
   *
   * Mirrors `FundingRepository.monthInputs` deliberately: the same definition
   * of an attended day and a fed day must produce the state's claim and the
   * parent's bill, or §17's single-entry principle is broken at the point it
   * matters most — the two numbers would be defended in different rooms.
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
      // Grouped by the (child, date) pair — one group is one fed day, never one
      // sitting. `FundingRepository` documents why at length; the same bug here
      // would overcharge a parent threefold.
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

  // ── Shared shapes ──────────────────────────────────────────────────────────

  private invoiceSelect() {
    return {
      id: true,
      kindergartenId: true,
      childId: true,
      month: true,
      number: true,
      status: true,
      subtotalAmount: true,
      discountAmount: true,
      previousBalance: true,
      totalAmount: true,
      dueDate: true,
      issuedAt: true,
      note: true,
      createdAt: true,
      child: { select: { id: true, lastName: true, firstName: true } },
    } satisfies Prisma.InvoiceSelect;
  }

  private paymentSelect() {
    return {
      id: true,
      amount: true,
      method: true,
      status: true,
      paidAt: true,
      providerInvoiceId: true,
      providerPaymentId: true,
      reversalOfId: true,
      note: true,
      createdAt: true,
    } satisfies Prisma.PaymentSelect;
  }
}

/** Re-exported so services can name these without importing from `generated/`. */
export type { InvoiceItemKind, InvoiceStatus, PaymentMethod };
