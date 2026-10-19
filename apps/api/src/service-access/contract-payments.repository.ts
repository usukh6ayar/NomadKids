import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type SettleResult =
  | { claimed: false }
  | { claimed: true; before: { amount: string; groupCount: number } | null; overlaps: boolean };

/**
 * PENDING → PAID on a contract period, once, and the contract's end moved to
 * what it now covers — the one settlement both QPay's reconcile and the
 * operator's bank-transfer record run (№6; the client, 2026-10-18: state
 * kindergartens pay against an invoice). Inside the caller's transaction, so
 * a paid period can never leave the contract short.
 *
 * ★ `endsOn` only ever moves forward: a period paid out of order cannot
 * shorten a contract already paid further.
 *
 * ★★ `amount` is what actually moved — the QR's, or what the bank statement
 * shows. A QR drawn before the groups changed and paid after records what it
 * took, not the re-priced figure, or the revenue and the partners' shares
 * count money that never arrived. `before` is the row's figure when it
 * differed (§3.2), `overlaps` whether another paid period of the contract
 * already covers part of this one.
 */
export async function settleContractPayment(
  tx: Prisma.TransactionClient,
  contractPaymentId: string,
  settle: {
    paidAt: Date;
    amount: string;
    method: "QPAY" | "BANK_TRANSFER";
    reference?: string | null;
    recordedById?: string | null;
    ebarimtNumber?: string | null;
  },
): Promise<SettleResult> {
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
  const paid = new Prisma.Decimal(settle.amount);
  const differs = !paid.equals(current.amount);
  // The groups the money was for, when the period's per-group price divides it.
  const groups = differs && current.perGroupAmount.gt(0) ? paid.div(current.perGroupAmount) : null;

  const claimed = await tx.contractPayment.updateMany({
    where: { id: contractPaymentId, status: "PENDING", deletedAt: null },
    data: {
      status: "PAID",
      paidAt: settle.paidAt,
      amount: paid,
      method: settle.method,
      reference: settle.reference ?? null,
      recordedById: settle.recordedById ?? null,
      ...(settle.ebarimtNumber ? { ebarimtNumber: settle.ebarimtNumber } : {}),
      ...(groups?.isInteger() ? { groupCount: groups.toNumber() } : {}),
    },
  });
  if (claimed.count === 0) return { claimed: false };

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
    claimed: true,
    before: differs ? { amount: current.amount.toFixed(2), groupCount: current.groupCount } : null,
    overlaps: overlapping > 0,
  };
}

/**
 * Every kindergarten's contract payments, for the platform operator — the
 * list a bank transfer is recorded from and an ebarimt number is kept on.
 *
 * ★ Platform-wide by design: the caller has passed
 * `PlatformAccessService.assertSuperAdmin`. Nothing here selects a child.
 */
@Injectable()
export class ContractPaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: {
    status?: "PENDING" | "PAID";
    ebarimtMissing?: boolean;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.ContractPaymentWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.ebarimtMissing ? { status: "PAID", ebarimtNumber: null } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.contractPayment.findMany({
        where,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          initial: true,
          period: true,
          coversFrom: true,
          coversTo: true,
          groupCount: true,
          amount: true,
          status: true,
          method: true,
          paidAt: true,
          reference: true,
          ebarimtNumber: true,
          createdAt: true,
          kindergarten: { select: { id: true, name: true } },
          contract: { select: { number: true } },
        },
      }),
      this.prisma.contractPayment.count({ where }),
    ]);
    return { rows, total };
  }

  findById(id: string) {
    return this.prisma.contractPayment.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        kindergartenId: true,
        status: true,
        amount: true,
        ebarimtNumber: true,
      },
    });
  }

  /** A bank transfer the operator saw on the statement — the same settlement QPay runs. */
  recordTransfer(
    id: string,
    data: {
      paidAt: Date;
      amount: string;
      reference: string | null;
      ebarimtNumber: string | null;
      recordedById: string;
    },
  ) {
    return this.prisma.$transaction((tx) =>
      settleContractPayment(tx, id, { ...data, method: "BANK_TRANSFER" }),
    );
  }

  /** The e-receipt's number, on a paid period — `false` when it is not paid. */
  async setEbarimt(id: string, ebarimtNumber: string | null): Promise<boolean> {
    const result = await this.prisma.contractPayment.updateMany({
      where: { id, status: "PAID", deletedAt: null },
      data: { ebarimtNumber },
    });
    return result.count > 0;
  }
}
