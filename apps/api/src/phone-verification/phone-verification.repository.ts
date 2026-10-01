import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { PhoneVerificationPurpose } from "../domain/enums";

const ROW = {
  id: true,
  purpose: true,
  phone: true,
  userId: true,
  sessionId: true,
  expiresAt: true,
  verifiedAt: true,
  consumedAt: true,
  lastCheckedAt: true,
} as const;

/**
 * `PhoneVerification` rows. User-level, like `AuthToken` — there is no tenant
 * scope to add, and no soft delete: an expired verification is an operational
 * record that `MaintenanceRepository` removes.
 */
@Injectable()
export class PhoneVerificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    purpose: PhoneVerificationPurpose;
    phone: string;
    userId: string | null;
    sessionId: string;
    code: string;
    handleHash: string;
    expiresAt: Date;
    requestedIp: string | null;
  }) {
    return this.prisma.phoneVerification.create({ data, select: { id: true } });
  }

  async findByHandleHash(handleHash: string) {
    return this.prisma.phoneVerification.findUnique({ where: { handleHash }, select: ROW });
  }

  /**
   * Retires earlier unfinished attempts by the same subject, so only the
   * newest handle can be consumed — a code abandoned on another screen stops
   * counting the moment a new one is asked for.
   */
  async retirePending(purpose: PhoneVerificationPurpose, phone: string, userId: string | null) {
    await this.prisma.phoneVerification.updateMany({
      where: { purpose, phone, userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  /**
   * Claims the throttle slot for an upstream check.
   *
   * ★ Conditional, so two polls landing together cannot both call verify.mn:
   * only the one whose update matched goes upstream.
   */
  async claimCheck(id: string, notAfter: Date): Promise<boolean> {
    const { count } = await this.prisma.phoneVerification.updateMany({
      where: {
        id,
        verifiedAt: null,
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: notAfter } }],
      },
      data: { lastCheckedAt: new Date() },
    });
    return count === 1;
  }

  async markVerified(id: string): Promise<void> {
    await this.prisma.phoneVerification.updateMany({
      where: { id, verifiedAt: null },
      data: { verifiedAt: new Date() },
    });
  }

  /**
   * Spends a verification. False when it was already spent — the second of
   * two concurrent submissions loses here rather than both succeeding.
   */
  async consume(id: string): Promise<boolean> {
    const { count } = await this.prisma.phoneVerification.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return count === 1;
  }

  /**
   * The active account holding this phone — the same filter `findByIdentifier`
   * applies, because the question is "who could sign in with this number".
   */
  async findAccountByPhone(phone: string) {
    return this.prisma.user.findFirst({
      where: { phone, deletedAt: null, isActive: true },
      select: { id: true },
    });
  }
}
