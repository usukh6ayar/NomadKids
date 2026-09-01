import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { Prisma } from "../../generated/prisma/client";

/**
 * Persistence for `QpayInvoice` — one payment attempt against one `Invoice`.
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
   * The most recent attempt against this invoice, any status — what both
   * `createForInvoice` (to decide whether to reuse a live one) and `status`
   * (to report on) read.
   */
  async findLatestForInvoice(invoiceId: string) {
    return this.prisma.qpayInvoice.findFirst({
      where: { invoiceId },
      orderBy: { createdAt: "desc" },
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
      where: { id, status: "PENDING" },
      data: { status: "PAID", paidAt },
    });
    return result.count > 0;
  }

  /**
   * Links the `Payment` row created after a successful `claimForPayment`.
   *
   * A plain update, not guarded — by this point the row is exclusively ours;
   * `claimForPayment` already proved no other caller can also be here.
   */
  async attachPayment(id: string, paymentId: string): Promise<void> {
    await this.prisma.qpayInvoice.update({ where: { id }, data: { paymentId } });
  }
}
