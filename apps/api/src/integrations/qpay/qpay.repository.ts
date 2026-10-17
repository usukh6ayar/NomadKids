import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "../../generated/prisma/client";

/**
 * Persistence for `QpayInvoice` — one payment attempt against one
 * `AccessSubscription` or, since 2026-10-11, one `MaterialPurchase`.
 *
 * CLAUDE.md §2.2: the only file in this directory that may import
 * `PrismaClient`. `QpayService` calls this; it never touches Prisma itself.
 */
@Injectable()
export class QpayRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.QpayInvoiceUncheckedCreateInput) {
    return this.prisma.qpayInvoice.create({ data });
  }

  async findById(id: string) {
    return this.prisma.qpayInvoice.findUnique({ where: { id } });
  }

  /** What the callback keys on — QPay's own id, not ours. */
  async findByQpayInvoiceId(qpayInvoiceId: string) {
    return this.prisma.qpayInvoice.findUnique({ where: { qpayInvoiceId } });
  }

  /**
   * The most recent attempt against this subscription, any status — what both
   * `createForSubscription` (to decide whether to reuse a live QR) and
   * `status` (to report on) read.
   */
  async findLatestForSubscription(subscriptionId: string) {
    return this.prisma.qpayInvoice.findFirst({
      where: { subscriptionId },
      orderBy: { createdAt: "desc" },
    });
  }

  /** The latest attempt to pay for one teacher's purchase of one material. */
  async findLatestForMaterialPurchase(materialPurchaseId: string) {
    return this.prisma.qpayInvoice.findFirst({
      where: { materialPurchaseId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * UNPAID → PAID on the purchase, once — the material twin of
   * `AccessService.markPaid`'s claim. `false` means another call already did.
   *
   * ★ `amount` is what QPay charged — the invoice's, whole tugrik. A QR drawn
   * before the operator changed the price and paid after must record the
   * price it was paid at, not the new one.
   */
  async markMaterialPurchasePaid(
    materialPurchaseId: string,
    paidAt: Date,
    amount: number,
  ): Promise<boolean> {
    const result = await this.prisma.materialPurchase.updateMany({
      where: { id: materialPurchaseId, status: "UNPAID" },
      data: { status: "PAID", paidAt, amount },
    });
    return result.count > 0;
  }

  /** The latest attempt to pay for one period of a kindergarten's contract. */
  async findLatestForContractPayment(contractPaymentId: string) {
    return this.prisma.qpayInvoice.findFirst({
      where: { contractPaymentId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * PENDING → PAID on a contract period, once, and the contract's end moved
   * to what it now covers — one transaction, so a paid period can never leave
   * the contract short (№6, 2026-10-18). `false` means another call did it.
   *
   * ★ `endsOn` only ever moves forward: a period paid out of order cannot
   * shorten a contract already paid further.
   *
   * ★★ `amount` is what QPay charged — the attempt's (review of #258). A QR
   * drawn before the groups changed and paid after records what moved, not
   * the re-priced figure, or the revenue and the partners' shares count money
   * that never arrived. The material twin is `markMaterialPurchasePaid`.
   * `before` is the row's figure when it differed (§3.2), `overlaps` whether
   * another paid period of the contract already covers part of this one.
   */
  async markContractPaymentPaid(
    contractPaymentId: string,
    paidAt: Date,
    amount: string,
  ): Promise<
    | { claimed: false }
    | { claimed: true; before: { amount: string; groupCount: number } | null; overlaps: boolean }
  > {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.contractPayment.findUniqueOrThrow({
        where: { id: contractPaymentId },
        select: {
          contractId: true,
          coversFrom: true,
          coversTo: true,
          groupCount: true,
          perGroupAmount: true,
          amount: true,
        },
      });
      const paid = new Prisma.Decimal(amount);
      const differs = !paid.equals(current.amount);
      // The groups the QR was drawn for, when the period's per-group price divides it.
      const groups =
        differs && current.perGroupAmount.gt(0) ? paid.div(current.perGroupAmount) : null;

      const claimed = await tx.contractPayment.updateMany({
        where: { id: contractPaymentId, status: "PENDING" },
        data: {
          status: "PAID",
          paidAt,
          amount: paid,
          ...(groups?.isInteger() ? { groupCount: groups.toNumber() } : {}),
        },
      });
      if (claimed.count === 0) return { claimed: false as const };

      await tx.contract.updateMany({
        where: { id: current.contractId, endsOn: { lt: current.coversTo } },
        data: { endsOn: current.coversTo },
      });
      const overlapping = await tx.contractPayment.count({
        where: {
          id: { not: contractPaymentId },
          contractId: current.contractId,
          status: "PAID",
          deletedAt: null,
          coversFrom: { lte: current.coversTo },
          coversTo: { gte: current.coversFrom },
        },
      });
      return {
        claimed: true as const,
        before: differs
          ? { amount: current.amount.toFixed(2), groupCount: current.groupCount }
          : null,
        overlaps: overlapping > 0,
      };
    });
  }

  /** `where: status: "PENDING"` guards this the same way `claimForPayment` guards itself. */
  async markExpired(id: string): Promise<void> {
    await this.prisma.qpayInvoice.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
  }

  /**
   * The atomic half of crediting a payment — flips PENDING → PAID and
   * returns whether *this call* is the one that did it.
   *
   * ★ This is what makes `QpayService.reconcile` safe against the webhook and
   * a parent's status poll racing each other. Postgres serialises two
   * concurrent `UPDATE … WHERE id = ? AND status = 'PENDING'` statements
   * against the same row: exactly one matches and returns `count: 1`, the
   * other matches zero rows because by the time it runs the row is no longer
   * PENDING. The loser's caller must NOT create a `Payment` row — that is the
   * whole reason this step exists separately from `attachPayment`, and before
   * any `Payment` is created at all, rather than after.
   */
  async claimForPayment(id: string, paidAt: Date): Promise<boolean> {
    const result = await this.prisma.qpayInvoice.updateMany({
      // EXPIRED too: QPay can confirm a QR after our own TTL has run out —
      // `QpayService.reconcile` re-asks only on QPay's callback.
      where: { id, status: { in: ["PENDING", "EXPIRED"] } },
      data: { status: "PAID", paidAt },
    });
    return result.count > 0;
  }
}
