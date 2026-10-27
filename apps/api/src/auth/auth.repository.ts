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
        /*
         * ★ Username or phone — not e-mail, since 2026-10-04 (client: «email-ээр
         * verification хийхгүй, зөвхөн SMS»). An address nobody has proven is
         * not an identity, and the phone now is: it is SMS-verified wherever a
         * person sets it. `User.email` stays as a contact field.
         */
        OR: [{ username: value }, { phone: value }],
      },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        lastName: true,
        firstName: true,
        isSuperAdmin: true,
      },
    });
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
    contact: { phone?: string },
  ): Promise<{ phone: string | null } | null> {
    if (!contact.phone) return null;

    return this.prisma.user.findFirst({
      where: { NOT: { id: userId }, phone: contact.phone },
      select: { phone: true },
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
  async findInvitedAccount(userId: string): Promise<{
    kind: "staff" | "guardian";
    selfRegistered: boolean;
    /** Tied to an ESIS person — its name is the ministry's, not retyped. */
    esisLinked: boolean;
    hasName: boolean;
    hasPhone: boolean;
    /** Server-side only — never answered to the public describe call. */
    phone: string | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isSuperAdmin: true,
        selfRegisteredAt: true,
        esisPersonId: true,
        firstName: true,
        phone: true,
        /*
          ★ Staff memberships only (2026-10-27). A family's placeholder holds a
          PARENT membership from the moment it is invited, so counting every
          membership called each guardian invitation "staff" — the form asked
          a parent for a surname and skipped the child check.
        */
        _count: { select: { memberships: { where: { role: { not: "PARENT" } } } } },
      },
    });
    return {
      kind: user?.isSuperAdmin || (user?._count.memberships ?? 0) > 0 ? "staff" : "guardian",
      selfRegistered: Boolean(user?.selfRegisteredAt),
      esisLinked: Boolean(user?.esisPersonId),
      hasName: Boolean(user?.firstName?.trim()),
      hasPhone: Boolean(user?.phone),
      phone: user?.phone ?? null,
    };
  }

  /**
   * The children a guardian invitation is for — each live guardianship of the
   * invited account. For the acceptance's child check (2026-10-27): the name
   * the card already prints, and the birth date only the family knows.
   */
  async findInvitationChildren(userId: string) {
    const rows = await this.prisma.guardianship.findMany({
      where: { guardianUserId: userId, deletedAt: null, child: { deletedAt: null } },
      orderBy: { createdAt: "asc" },
      select: { child: { select: { lastName: true, firstName: true, dateOfBirth: true } } },
    });
    return rows.map((row) => row.child);
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
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      /*
        Only what was sent. A director's invitation carries a password and
        nothing else — their name was typed by the platform operator when the
        kindergarten was registered, and overwriting it with `undefined` would
        be this endpoint erasing a fact it was never given.
      */
      if (profile.firstName || profile.phone || profile.lastName) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(profile.firstName ? { firstName: profile.firstName } : {}),
            ...(profile.phone ? { phone: profile.phone } : {}),
            ...(profile.lastName ? { lastName: profile.lastName } : {}),
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
