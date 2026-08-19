import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Deletions for tables that would otherwise grow without bound.
 *
 * These are the only hard deletes in the system. Everything domain-level is
 * soft-deleted; these three tables are operational records with no historical
 * value once expired, and keeping them forever costs query time on the hot
 * login path.
 */
@Injectable()
export class MaintenanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Removes login attempts older than the lockout window can reach.
   *
   * `countRecentFailures` scans this table on **every login attempt**, so an
   * unbounded table is a slow, self-inflicted denial of service on the endpoint
   * an attacker is already hammering.
   *
   * 30 days rather than the 15-minute window: recent history is worth keeping
   * for investigating a brute-force attempt, and `AuditLog` retains the
   * `login_failed` record permanently regardless.
   */
  async pruneLoginAttempts(olderThan: Date): Promise<number> {
    const { count } = await this.prisma.loginAttempt.deleteMany({
      where: { createdAt: { lt: olderThan } },
    });
    return count;
  }

  /** Expired or already-used password-reset and invitation tokens. */
  async pruneAuthTokens(now: Date): Promise<number> {
    const { count } = await this.prisma.authToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
    });
    return count;
  }

  /**
   * Revoked and expired sessions.
   *
   * Kept for a grace period rather than deleted on revocation: a session row
   * that vanishes the instant it is revoked makes refresh-token reuse
   * indistinguishable from an unknown token, and the family-revocation defence
   * depends on recognising the difference.
   */
  async pruneSessions(olderThan: Date): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: olderThan } }, { revokedAt: { lt: olderThan } }],
      },
    });
    return count;
  }
}
