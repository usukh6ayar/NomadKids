import { Injectable } from "@nestjs/common";
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
}
