import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * What «Үйлчилгээний эрх» reads for a kindergarten (#211): its contract with
 * the platform, and how many groups it runs now.
 */
@Injectable()
export class ServiceAccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  kindergarten(id: string) {
    return this.prisma.kindergarten.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, kind: true },
    });
  }

  /** The contract in force — the latest-ending ACTIVE one, if any. */
  activeContract(kindergartenId: string) {
    return this.prisma.contract.findFirst({
      where: { kindergartenId, status: "ACTIVE", deletedAt: null },
      orderBy: { endsOn: "desc" },
      select: {
        id: true,
        number: true,
        billingPeriod: true,
        perGroupMonthlyFee: true,
        endsOn: true,
      },
    });
  }

  /** Groups running in the current school year — what a renewal is priced on. */
  currentGroupCount(kindergartenId: string) {
    return this.prisma.group.count({
      where: {
        kindergartenId,
        deletedAt: null,
        status: "ACTIVE",
        schoolYear: { isCurrent: true, deletedAt: null },
      },
    });
  }

  /** The payment for one period of one contract — at most one, by the unique key. */
  findPayment(contractId: string, period: "TERM" | "YEAR", coversFrom: Date) {
    return this.prisma.contractPayment.findFirst({
      where: { contractId, period, coversFrom, deletedAt: null },
    });
  }

  /**
   * Creates the period's row — or, when a concurrent request created it first
   * (the unique key), returns that one with `created: false`.
   */
  async createPayment(data: Prisma.ContractPaymentUncheckedCreateInput) {
    try {
      return { row: await this.prisma.contractPayment.create({ data }), created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const row = await this.prisma.contractPayment.findFirst({
        where: {
          contractId: data.contractId,
          period: data.period,
          coversFrom: data.coversFrom,
          deletedAt: null,
        },
      });
      if (!row) throw error;
      return { row, created: false };
    }
  }

  /**
   * Re-prices a PENDING payment to the groups running now — nothing has been
   * paid against it, and the next QR must ask for what is owed today.
   */
  repricePending(id: string, data: { groupCount: number; perGroupAmount: string; amount: string }) {
    return this.prisma.contractPayment.updateMany({
      where: { id, status: "PENDING" },
      data,
    });
  }

  /** One of this kindergarten's payments — `null` for another's (§1.7: 404). */
  paymentOf(id: string, kindergartenId: string) {
    return this.prisma.contractPayment.findFirst({
      where: { id, kindergartenId, deletedAt: null },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
