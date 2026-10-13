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
   *
   * ★ Routed by shape: with an `@` it is an e-mail and matches `email` alone;
   * otherwise a username or a phone. A username cannot hold an `@`
   * (`createUserSchema`), so one account's username can never answer for
   * another's address.
   *
   * ★★ E-mail again since 2026-10-13 (the user: «бүртгүүлэхэд болон нэвтрэхэд
   * email авч болно. Гэхдээ нууц үг сэргээх, бүртгэлээ баталгаажуулахад
   * SMS-ээр»), after #170 took it out on 2026-10-04. Signing in is all it
   * does: nothing is sent to it and nothing is reset through it — the phone,
   * SMS-proven, stays the account's proof.
   */
  async findByIdentifier(identifier: string) {
    const value = identifier.trim();
    const select = {
      id: true,
      username: true,
      passwordHash: true,
      lastName: true,
      firstName: true,
      isSuperAdmin: true,
    } as const;

    if (!value.includes("@")) {
      return this.prisma.user.findFirst({
        where: { deletedAt: null, isActive: true, OR: [{ username: value }, { phone: value }] },
        select,
      });
    }

    /*
     * Case-insensitive, because people type their address however they like
     * and older rows were stored as typed. The unique index is case-sensitive,
     * so two accounts can hold one address in two casings — production had
     * two such pairs on 2026-10-13. Then the address names nobody: picking one
     * would sign a person into whichever account happened to sort first.
     */
    const matches = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        email: { equals: value, mode: "insensitive" },
      },
      select,
      take: 2,
    });
    return matches.length === 1 ? matches[0]! : null;
  }

  /**
   * The active account holding this phone, matched on `phone` alone.
   *
   * For the password reset by phone: `findByIdentifier` would also match a
   * username, and a username that happens to be eight digits must not answer
   * for somebody else's proven number.
   */
  async findActiveByPhone(phone: string) {
    return this.prisma.user.findFirst({
      where: { phone, deletedAt: null, isActive: true },
      select: { id: true },
    });
  }

  /**
   * Does anybody **other than this user** already hold this phone?
   *
   * ★ Not `findByIdentifier`. That one filters `isActive: true` and
   * `deletedAt: null` because it answers "who is signing in"; the unique index
   * knows nothing of either, so a check built on it would pass and the insert
   * would still fail. The question here is the index's question.
   *
   * ★★ `NOT: { id: userId }`, because writing your own number back to your
   * own row is not a collision.
   */
  async findOtherUserByContact(
    userId: string,
    contact: { phone?: string; email?: string },
  ): Promise<"phone" | "email" | null> {
    if (contact.phone) {
      const byPhone = await this.prisma.user.findFirst({
        where: { NOT: { id: userId }, phone: contact.phone },
        select: { id: true },
      });
      if (byPhone) return "phone";
    }
    if (contact.email) {
      // Case-insensitive: an address in another casing would sign in as both.
      const byEmail = await this.prisma.user.findFirst({
        where: { NOT: { id: userId }, email: { equals: contact.email, mode: "insensitive" } },
        select: { id: true },
      });
      if (byEmail) return "email";
    }
    return null;
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
      select: { id: true, userId: true, familyId: true, revokedAt: true, expiresAt: true },
    });
  }

  /**
   * The devices an account is signed in on: one per refresh-token family that
   * still has a live row. The live row is the family's newest — every refresh
   * revokes the row it replaces — so its `createdAt` is when the device was
   * last used, and the family's oldest row is when it signed in.
   *
   * ★ Capped: with the limit off an account can hold any number of families,
   * and no list here is unbounded (§3.4).
   */
  async listActiveDevices(userId: string, now: Date) {
    const live = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      select: { familyId: true, userAgent: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    if (live.length === 0) return [];

    const started = await this.prisma.session.groupBy({
      by: ["familyId"],
      where: { userId, familyId: { in: [...new Set(live.map((row) => row.familyId))] } },
      _min: { createdAt: true },
    });
    const startedAt = new Map(started.map((row) => [row.familyId, row._min.createdAt]));

    const seen = new Set<string>();
    return live.flatMap((row) => {
      if (seen.has(row.familyId)) return [];
      seen.add(row.familyId);
      return [
        {
          id: row.familyId,
          userAgent: row.userAgent,
          createdAt: startedAt.get(row.familyId) ?? row.createdAt,
          lastUsedAt: row.createdAt,
        },
      ];
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

  /**
   * What kind of account an invitation is for, so the acceptance form can ask
   * the right questions.
   *
   * ★ `isSuperAdmin` or any `Membership` means staff. A guardian holds neither:
   * they reach a child through `Guardianship`, never through a membership
   * (CLAUDE.md §1.1). That makes the distinction a property of the account
   * rather than a flag on the token, so it cannot be set wrongly at invite
   * time and cannot drift from what the account actually is.
   */
  async findInvitedAccountKind(userId: string): Promise<"staff" | "guardian"> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true, _count: { select: { memberships: true } } },
    });
    return user?.isSuperAdmin || (user?._count.memberships ?? 0) > 0 ? "staff" : "guardian";
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

  /**
   * Writes the details a guardian gave when accepting their invitation.
   *
   * ★ One transaction, because the two halves are one act: a user whose name
   * was updated but whose guardianship still says `OTHER` is a record that
   * looks complete and is not.
   *
   * The relationship reaches every guardianship this user holds — see the note
   * at the call site. `updateMany` rather than a loop: a parent of two siblings
   * has two rows and they are the same person in both.
   */
  async completeInvitedProfile(
    userId: string,
    profile: {
      firstName?: string;
      phone?: string;
      relation?: string;
      /** Staff only — a guardian gives a given name and no surname. */
      lastName?: string;
      email?: string;
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      /*
        Only what was sent. A director's invitation carries a password and
        nothing else — their name was typed by the platform operator when the
        kindergarten was registered, and overwriting it with `undefined` would
        be this endpoint erasing a fact it was never given.
      */
      if (profile.firstName || profile.phone || profile.lastName || profile.email) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(profile.firstName ? { firstName: profile.firstName } : {}),
            ...(profile.phone ? { phone: profile.phone } : {}),
            ...(profile.lastName ? { lastName: profile.lastName } : {}),
            ...(profile.email ? { email: profile.email } : {}),
          },
        });
      }

      if (profile.relation) {
        await tx.guardianship.updateMany({
          where: { guardianUserId: userId, deletedAt: null },
          data: { relation: profile.relation as never },
        });
      }
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
