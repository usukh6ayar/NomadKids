import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Deletions for tables that would otherwise grow without bound.
 *
 * The three `prune*` methods are the only hard deletes in the system:
 * operational records with no historical value once expired, where keeping
 * them forever costs query time on the hot login path.
 *
 * ★ `retireNotifications` is **not** one of them — 2026-09-11. A notice is
 * something a person wrote to families, so it is soft-deleted like every other
 * domain row (CLAUDE.md §3.2) and this file stopped being "hard deletes only".
 * The distinction is worth keeping visible: a `deleteMany` here is a decision
 * that the row has no reader left, and that is true of a login attempt and
 * false of a notice.
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

  /**
   * Retires a notice a week after it was published — the client, 2026-09-11.
   *
   * ★ A **soft** delete. The board filters on `deletedAt: null`, so the notice
   * leaves every feed the moment this runs, and the row stays for the
   * kindergarten that has to answer "what did you tell the parents in March".
   * Hard-deleting the same rows would make that question unanswerable to
   * save nothing — a notice is a sentence, not a scan.
   *
   * ★★ `isImportant: false` is the exemption, and it is the author's call
   * rather than a category list. The flag already exists on the compose form;
   * a list of categories that outlive the week would be a second place to keep
   * in step with the client's taxonomy, and it would decide for the person who
   * wrote the notice whether theirs was worth keeping.
   *
   * ★★★ `publishedAt`, not `createdAt`. A draft nobody has seen has not
   * started its week — a notice written on Monday and published on Friday gets
   * its seven days from Friday. Prisma's `lt` on a nullable column excludes
   * NULLs, so an unpublished draft is never matched; `status` is asserted as
   * well, because relying on that is a subtlety rather than a statement.
   */
  async retireNotifications(publishedBefore: Date): Promise<number> {
    const { count } = await this.prisma.notification.updateMany({
      where: {
        deletedAt: null,
        isImportant: false,
        status: "PUBLISHED",
        publishedAt: { lt: publishedBefore },
      },
      data: { deletedAt: new Date() },
    });
    return count;
  }
}
