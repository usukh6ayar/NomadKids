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

  /**
   * The contract waiting for the director's acceptance — the latest issued, if
   * any (the user, 2026-10-18: «онлайнаар гэрээ байгуулдаг»).
   */
  contractToSign(kindergartenId: string) {
    return this.prisma.contract.findFirst({
      where: { kindergartenId, status: "PENDING_SIGNATURE", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: CONTRACT_TERMS,
    });
  }

  /** One of this kindergarten's contracts, with its PDF — `null` for another's (§1.7). */
  contractOf(id: string, kindergartenId: string) {
    return this.prisma.contract.findFirst({
      where: { id, kindergartenId, deletedAt: null, status: { not: "CANCELLED" } },
      select: {
        ...CONTRACT_TERMS,
        status: true,
        pdf: { select: { storageKey: true, originalName: true, deletedAt: true } },
      },
    });
  }

  /** The contract's first period, still unpaid — what the director owes before renewing. */
  dueInitial(contractId: string) {
    return this.prisma.contractPayment.findFirst({
      where: { contractId, initial: true, status: "PENDING", deletedAt: null },
    });
  }

  /**
   * PENDING_SIGNATURE → ACTIVE, the acceptance and the first period's payment
   * — one transaction, so none exists without the others. `null` when the
   * contract was no longer waiting at that version (accepted twice, or
   * re-issued meanwhile).
   *
   * ★ The acceptance row is only ever created here, never updated or deleted.
   */
  async acceptContract(input: {
    contractId: string;
    kindergartenId: string;
    version: number;
    pdfMediaFileId: string;
    userId: string;
    ipAddress: string | null;
    userAgent: string | null;
    terms: Prisma.InputJsonValue;
    contractNumber: string;
    acceptedAt: Date;
    initialPayment: Omit<
      Prisma.ContractPaymentUncheckedCreateInput,
      "kindergartenId" | "contractId" | "initial"
    > | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.contract.updateMany({
        where: {
          id: input.contractId,
          kindergartenId: input.kindergartenId,
          version: input.version,
          status: "PENDING_SIGNATURE",
          deletedAt: null,
        },
        data: { status: "ACTIVE", signedAt: input.acceptedAt, activatedAt: input.acceptedAt },
      });
      if (claimed.count === 0) return null;

      const acceptance = await tx.contractAcceptance.create({
        data: {
          kindergartenId: input.kindergartenId,
          contractId: input.contractId,
          contractVersion: input.version,
          contractNumber: input.contractNumber,
          pdfMediaFileId: input.pdfMediaFileId,
          userId: input.userId,
          terms: input.terms,
          acceptedAt: input.acceptedAt,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });
      const payment = input.initialPayment
        ? await tx.contractPayment.create({
            data: {
              ...input.initialPayment,
              kindergartenId: input.kindergartenId,
              contractId: input.contractId,
              initial: true,
            },
          })
        : null;
      return { acceptance, payment };
    });
  }

  /**
   * The renewal row for one period of one contract — at most one, by the
   * unique key. ★ Never the initial row: that one is the accepted contract's
   * own figure and is never re-priced, even when a whole-term renewal quote
   * lands on the same day.
   */
  findPayment(contractId: string, period: "TERM" | "YEAR", coversFrom: Date) {
    return this.prisma.contractPayment.findFirst({
      where: { contractId, initial: false, period, coversFrom, deletedAt: null },
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
          initial: data.initial ?? false,
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
   * Re-prices a PENDING renewal to the groups running now — nothing has been
   * paid against it, and the next QR must ask for what is owed today. An
   * initial row never matches.
   */
  repricePending(
    id: string,
    data: { groupCount: number; perGroupAmount: string; amount: string; coversTo: Date },
  ) {
    return this.prisma.contractPayment.updateMany({
      where: { id, initial: false, status: "PENDING" },
      data,
    });
  }

  /** One of this kindergarten's payments — `null` for another's (§1.7: 404). */
  paymentOf(id: string, kindergartenId: string) {
    return this.prisma.contractPayment.findFirst({
      where: { id, kindergartenId, deletedAt: null },
      include: { contract: { select: { number: true } } },
    });
  }
}

const CONTRACT_TERMS = {
  id: true,
  number: true,
  version: true,
  groupCount: true,
  billingPeriod: true,
  perGroupMonthlyFee: true,
  periodFee: true,
  startsOn: true,
  endsOn: true,
  pdfMediaFileId: true,
} as const;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
