import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { Prisma, QpayReviewReason } from "../../generated/prisma/client";
import {
  settleContractPayment,
  type SettleResult,
} from "../../service-access/contract-payments.repository";

/** What the operator's «Төлбөр шалгах» reads of one attempt — no child, no QR. */
const OPERATOR_SELECT = {
  id: true,
  status: true,
  reviewReason: true,
  amount: true,
  createdAt: true,
  paidAt: true,
  subscriptionId: true,
  materialPurchaseId: true,
  contractPaymentId: true,
  kindergarten: { select: { id: true, name: true } },
  // The payer's phone, masked by the service before it leaves the API.
  createdBy: { select: { phone: true } },
  subscription: {
    select: {
      period: true,
      termNumber: true,
      expiresAt: true,
      schoolYear: { select: { name: true } },
    },
  },
  materialPurchase: { select: { material: { select: { title: true } } } },
  contractPayment: { select: { coversFrom: true, coversTo: true } },
} satisfies Prisma.QpayInvoiceSelect;

export type OperatorQpayRow = Prisma.QpayInvoiceGetPayload<{ select: typeof OPERATOR_SELECT }>;

/** The lowest and highest uuid sharing a hex prefix — Postgres orders uuids byte-wise. */
function uuidPrefixRange(prefix: string): { gte: string; lte: string } {
  const pad = (fill: string) => {
    const hex = prefix.padEnd(32, fill);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  return { gte: pad("0"), lte: pad("f") };
}

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
   * PENDING → PAID on a contract period, once — `settleContractPayment`, the
   * settlement the operator's bank-transfer record runs too. `amount` is what
   * QPay charged (the attempt's), never the re-priced figure. The material
   * twin is `markMaterialPurchasePaid`.
   */
  markContractPaymentPaid(
    contractPaymentId: string,
    paidAt: Date,
    amount: string,
  ): Promise<SettleResult> {
    return this.prisma.$transaction((tx) =>
      settleContractPayment(tx, contractPaymentId, { paidAt, amount, method: "QPAY" }),
    );
  }

  /**
   * Every QPay attempt, for the platform operator's «Төлбөр шалгах» — newest
   * first, one page (§3.4).
   *
   * `numberPrefix` is the receipt's «Дугаар»: the first hex characters of the
   * target's id — the subscription's on a family's receipt
   * (`access-invoice.tsx`), the purchase's or contract period's otherwise.
   * `phoneDigits` matches the payer's phone. Both given, either matches.
   */
  async listForOperator(query: {
    numberPrefix: string | null;
    phoneDigits: string | null;
    status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED" | "NEEDS_REVIEW" | null;
    page: number;
    pageSize: number;
  }) {
    const search: Prisma.QpayInvoiceWhereInput[] = [];
    if (query.numberPrefix) {
      const range = uuidPrefixRange(query.numberPrefix);
      search.push(
        { subscriptionId: range },
        { materialPurchaseId: range },
        { contractPaymentId: range },
      );
    }
    if (query.phoneDigits) search.push({ createdBy: { phone: { contains: query.phoneDigits } } });

    const where: Prisma.QpayInvoiceWhereInput = {
      ...(search.length > 0 ? { OR: search } : {}),
      ...(query.status === "NEEDS_REVIEW"
        ? { reviewReason: { not: null } }
        : query.status
          ? { status: query.status }
          : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.qpayInvoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: OPERATOR_SELECT,
      }),
      this.prisma.qpayInvoice.count({ where }),
    ]);
    return { rows, total };
  }

  findForOperator(id: string) {
    return this.prisma.qpayInvoice.findUnique({ where: { id }, select: OPERATOR_SELECT });
  }

  /** Money QPay reported that nothing was opened for — `reviewReason`'s comment. */
  async markForReview(id: string, reason: QpayReviewReason): Promise<void> {
    await this.prisma.qpayInvoice.update({ where: { id }, data: { reviewReason: reason } });
  }

  /**
   * What the sweep asks QPay about again — every PENDING attempt, and the
   * EXPIRED ones drawn since `expiredSince`. Newest first, at most `limit`.
   *
   * A row already set aside for a person (`reviewReason`) is left to them:
   * asking again would only log the same short payment every ten minutes.
   * A stale PENDING row leaves the set on its first unpaid check, when
   * `reconcile` expires it.
   */
  async findUnsettled(expiredSince: Date, limit: number) {
    return this.prisma.qpayInvoice.findMany({
      where: {
        reviewReason: null,
        OR: [{ status: "PENDING" }, { status: "EXPIRED", createdAt: { gte: expiredSince } }],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
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
