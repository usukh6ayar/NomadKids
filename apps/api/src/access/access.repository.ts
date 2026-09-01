import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Prisma } from "../generated/prisma/client";

/**
 * Portal access subscriptions — one child, one school year.
 *
 * CLAUDE.md §2.2: the only file in this directory that may import
 * `PrismaClient`.
 */
@Injectable()
export class AccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The kindergarten's current school year — what a new subscription is for. */
  async currentSchoolYear(kindergartenId: string) {
    return this.prisma.schoolYear.findFirst({
      where: { kindergartenId, deletedAt: null, isCurrent: true },
      select: { id: true, name: true, endsOn: true },
    });
  }

  async findForChildYear(childId: string, schoolYearId: string) {
    return this.prisma.accessSubscription.findFirst({
      where: { childId, schoolYearId, deletedAt: null },
      include: { schoolYear: { select: { id: true, name: true, endsOn: true } } },
    });
  }

  async findById(id: string) {
    return this.prisma.accessSubscription.findFirst({ where: { id, deletedAt: null } });
  }

  async create(data: Prisma.AccessSubscriptionUncheckedCreateInput) {
    return this.prisma.accessSubscription.create({
      data,
      include: { schoolYear: { select: { id: true, name: true, endsOn: true } } },
    });
  }

  /**
   * Flips UNPAID → ACTIVE and reports whether *this call* is the one that did
   * it — the same single-winner shape as `QpayRepository.claimForPayment`, and
   * for the same reason: the webhook and a parent's status poll can arrive at
   * once, and only one of them may record the payment.
   */
  async claimActive(id: string, paidAt: Date): Promise<boolean> {
    const result = await this.prisma.accessSubscription.updateMany({
      where: { id, status: "UNPAID", deletedAt: null },
      data: { status: "ACTIVE", paidAt },
    });
    return result.count > 0;
  }
}
