import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Prisma } from "../generated/prisma/client";

const SUBSCRIPTION_INCLUDE = {
  schoolYear: { select: { id: true, name: true, endsOn: true } },
} as const;

/**
 * Portal access subscriptions — one child, one school year or one term.
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
      select: { id: true, name: true, startsOn: true, endsOn: true },
    });
  }

  /** This child's YEAR row for a school year. */
  async findForChildYear(childId: string, schoolYearId: string) {
    return this.prisma.accessSubscription.findFirst({
      where: { childId, schoolYearId, period: "YEAR", deletedAt: null },
      include: SUBSCRIPTION_INCLUDE,
    });
  }

  /** This child's TERM row for one term of a school year. */
  async findForChildTerm(childId: string, schoolYearId: string, termNumber: number) {
    return this.prisma.accessSubscription.findFirst({
      where: { childId, schoolYearId, termNumber, period: "TERM", deletedAt: null },
      include: SUBSCRIPTION_INCLUDE,
    });
  }

  /**
   * A paid row of this child's that covers `day` — a year or a term, the
   * longest first. The same question `AuthzRepository.loadPortalAccessActive`
   * asks for the gate.
   */
  async findActiveCovering(childId: string, day: Date) {
    return this.prisma.accessSubscription.findFirst({
      where: { childId, status: "ACTIVE", deletedAt: null, expiresAt: { gte: day } },
      include: SUBSCRIPTION_INCLUDE,
      orderBy: { expiresAt: "desc" },
    });
  }

  async findById(id: string) {
    return this.prisma.accessSubscription.findFirst({ where: { id, deletedAt: null } });
  }

  async create(data: Prisma.AccessSubscriptionUncheckedCreateInput) {
    return this.prisma.accessSubscription.create({ data, include: SUBSCRIPTION_INCLUDE });
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
