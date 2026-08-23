import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthTokenPurpose } from "../domain/enums";

/**
 * Every database read and write the auth flow needs.
 *
 * One rule runs through this file and is easy to undo by accident: the failure
 * records — `LoginAttempt` and the `login_failed` audit row — must NEVER be
 * written inside an interactive transaction. They exist to record that
 * something went wrong, and a failing request often rolls back around them,
 * silently resetting the lockout counter. docs/SECURITY.md §2.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds a user by any of the three identifiers they might type.
   *
   * Soft-deleted and deactivated users are excluded here rather than checked by
   * the caller, so there is one place to get it wrong.
   */
  async findByIdentifier(identifier: string) {
    const value = identifier.trim();
    return this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ username: value }, { email: value }, { phone: value }],
      },
      // `email` is needed by the password-reset path, which has to know where
      // to send the link. It is not returned to any client — the login response
      // is built from a different shape.
      select: {
        id: true,
        username: true,
        email: true,
        passwordHash: true,
        lastName: true,
        firstName: true,
        isSuperAdmin: true,
      },
    });
  }

  async findById(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        lastName: true,
        firstName: true,
        lastLoginAt: true,
        isSuperAdmin: true,
      },
    });
  }

  // ── Login attempts ────────────────────────────────────────────────────────

  /** ★ Never call inside a transaction. See the note at the top of this file. */
  async recordAttempt(identifier: string, ipAddress: string | null, succeeded: boolean) {
    await this.prisma.loginAttempt.create({
      data: { identifier: identifier.trim(), ipAddress, succeeded },
    });
  }

  /**
   * Failures for this identifier inside the window. Successful logins are not
   * counted, and are not cleared either — see the note in AuthService about why
   * a successful login resets the counter explicitly.
   */
  async countRecentFailures(identifier: string, since: Date): Promise<number> {
    return this.prisma.loginAttempt.count({
      where: { identifier: identifier.trim(), succeeded: false, createdAt: { gte: since } },
    });
  }

  async clearFailures(identifier: string): Promise<void> {
    await this.prisma.loginAttempt.deleteMany({
      where: { identifier: identifier.trim(), succeeded: false },
    });
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async createSession(data: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
  }) {
    return this.prisma.session.create({ data, select: { id: true, familyId: true } });
  }

  async findSessionByHash(tokenHash: string) {
    return this.prisma.session.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
  }

  async findSessionById(sessionId: string) {
    return this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, revokedAt: true, expiresAt: true },
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revokes every session in a family.
   *
   * Called when an already-rotated refresh token is presented — the signature
   * of a stolen cookie, since the legitimate client would have discarded it.
   * Killing the family logs the attacker out along with the victim, who then
   * logs in again and gets a fresh family.
   */
  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  // ── One-time tokens ───────────────────────────────────────────────────────

  async createAuthToken(data: {
    userId: string;
    purpose: AuthTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
    requestedIp: string | null;
  }) {
    return this.prisma.authToken.create({ data, select: { id: true } });
  }

  async findAuthToken(tokenHash: string, purpose: AuthTokenPurpose) {
    return this.prisma.authToken.findFirst({
      where: { tokenHash, purpose },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
  }

  async consumeAuthToken(id: string): Promise<void> {
    await this.prisma.authToken.update({ where: { id }, data: { usedAt: new Date() } });
  }

  /**
   * Invalidates any outstanding reset tokens for a user.
   *
   * Requesting a new reset link must kill the previous one, or a link mailed to
   * an address the user has since lost control of stays usable.
   */
  async invalidateAuthTokens(userId: string, purpose: AuthTokenPurpose): Promise<void> {
    await this.prisma.authToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    const row = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { passwordHash: true },
    });
    return row?.passwordHash ?? null;
  }
}
