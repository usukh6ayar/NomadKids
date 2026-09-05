import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditRepository } from "../audit/audit.repository";
import { AuthzRepository } from "../authz/authz.repository";
import type { Actor } from "../authz/actor";
import type { GuardianRelation } from "@kinder/contracts";
import { AuthRepository } from "./auth.repository";
import { PasswordService, validatePasswordStrength } from "./password.service";
import { hashToken, TokenService } from "./token.service";

/** 5 failures inside 15 minutes locks an identifier for 15 minutes. */
const MAX_FAILURES = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/** Password reset and invitation links expire after an hour. */
const ONE_TIME_TOKEN_TTL_MS = 60 * 60 * 1000;

/** What the controller needs to send the reset mail — and nothing more. */
export interface PasswordResetRequest {
  token: string;
  /** Null when the account has no email — the token is still valid. */
  email: string | null;
  name: string;
}

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    username: string;
    lastName: string;
    firstName: string;
    isSuperAdmin: boolean;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly authz: AuthzRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Password login.
   *
   * Three things here are deliberate and easy to break:
   *
   *  1. **Nothing runs in a transaction.** The failure records exist precisely
   *     to survive a failed request; wrapped in one, a later error would roll
   *     back the lockout counter along with everything else.
   *
   *  2. **Every failure path costs the same.** An unknown username burns a real
   *     argon2 verification, so "no such user" and "wrong password" take
   *     comparable time and return an identical message.
   *
   *  3. **The lockout is checked before the password**, so a locked account
   *     cannot be probed for password correctness during the lockout window.
   */
  async login(identifier: string, password: string, ctx: RequestContext): Promise<LoginResult> {
    const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
    const failures = await this.repo.countRecentFailures(identifier, since);

    if (failures >= MAX_FAILURES) {
      await this.recordFailure(identifier, ctx, "locked_out");
      throw new UnauthorizedException(
        "Хэт олон удаа буруу оролдлоо. 15 минутын дараа дахин оролдоно уу.",
      );
    }

    const user = await this.repo.findByIdentifier(identifier);

    if (!user) {
      // Burn equivalent work so a missing user is not distinguishable by timing.
      await this.passwords.burn();
      await this.recordFailure(identifier, ctx, "unknown_identifier");
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      await this.recordFailure(identifier, ctx, "bad_password", user.id);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    // A successful login clears the counter, so a user who mistypes three times
    // and then succeeds does not carry those failures toward a later lockout.
    await this.repo.clearFailures(identifier);
    await this.repo.recordAttempt(identifier, ctx.ipAddress, true);
    await this.repo.touchLastLogin(user.id);

    const { accessToken, refreshToken } = await this.issueSession(user.id, randomUUID(), ctx);

    await this.audit.append({
      action: "LOGIN",
      actorUserId: user.id,
      actorLabel: `${user.lastName} ${user.firstName}`,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        lastName: user.lastName,
        firstName: user.firstName,
        isSuperAdmin: user.isSuperAdmin,
      },
    };
  }

  /**
   * Rotating refresh.
   *
   * Every refresh issues a new token and revokes the old one. Presenting a
   * token that has *already* been rotated means two parties hold the cookie —
   * the legitimate client would have discarded it — so the entire family is
   * revoked. The victim is logged out and logs back in; the attacker is left
   * with nothing.
   */
  async refresh(refreshToken: string, ctx: RequestContext): Promise<LoginResult> {
    const session = await this.repo.findSessionByHash(hashToken(refreshToken));

    if (!session) throw new UnauthorizedException(SESSION_EXPIRED);

    if (session.revokedAt) {
      // Reuse of a rotated token. Assume theft and kill the whole family.
      this.logger.warn(`Refresh token reuse detected for family ${session.familyId}`);
      await this.repo.revokeFamily(session.familyId);
      await this.audit.append({
        action: "LOGIN_FAILED",
        actorUserId: session.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { reason: "refresh_token_reuse", familyId: session.familyId },
      });
      throw new UnauthorizedException(SESSION_EXPIRED);
    }

    if (session.expiresAt.getTime() < Date.now()) {
      await this.repo.revokeSession(session.id);
      throw new UnauthorizedException(SESSION_EXPIRED);
    }

    const user = await this.repo.findById(session.userId);
    if (!user) {
      // Deactivated or deleted since the session was created.
      await this.repo.revokeFamily(session.familyId);
      throw new UnauthorizedException(SESSION_EXPIRED);
    }

    await this.repo.revokeSession(session.id);
    const { accessToken, refreshToken: next } = await this.issueSession(
      user.id,
      session.familyId,
      ctx,
    );

    return {
      accessToken,
      refreshToken: next,
      user: {
        id: user.id,
        username: user.username,
        lastName: user.lastName,
        firstName: user.firstName,
        isSuperAdmin: user.isSuperAdmin,
      },
    };
  }

  async logout(refreshToken: string | undefined, actor: Actor | null, ctx: RequestContext) {
    if (refreshToken) {
      const session = await this.repo.findSessionByHash(hashToken(refreshToken));
      // Revoke the family, not just this session: logging out on one device
      // should not leave a rotated sibling token alive.
      if (session) await this.repo.revokeFamily(session.familyId);
    } else if (actor) {
      await this.repo.revokeSession(actor.sessionId).catch(() => undefined);
    }

    if (actor) {
      await this.audit.append({
        action: "LOGOUT",
        actorUserId: actor.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }
  }

  /**
   * Builds the Actor for a request from a verified access token.
   *
   * Re-reads memberships every time. That is the point: a revoked role stops
   * working on the next request, not when the token expires.
   */
  async resolveActor(userId: string, sessionId: string): Promise<Actor | null> {
    const session = await this.repo.findSessionById(sessionId);
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
    if (session.userId !== userId) return null;

    const user = await this.repo.findById(userId);
    if (!user) return null;

    return {
      userId,
      sessionId,
      isSuperAdmin: user.isSuperAdmin,
      memberships: await this.authz.loadMemberships(userId),
    };
  }

  // ── Password reset ────────────────────────────────────────────────────────

  /**
   * Issues a reset token, or pretends to.
   *
   * ★ Always succeeds from the caller's perspective. Returning "no such user"
   * would turn this endpoint into a free user-enumeration API, and the response
   * must not vary in content or timing.
   */
  async requestPasswordReset(
    identifier: string,
    ctx: RequestContext,
  ): Promise<PasswordResetRequest | null> {
    const user = await this.repo.findByIdentifier(identifier);
    if (!user) {
      await this.passwords.burn();
      return null;
    }

    // A new link invalidates outstanding ones, so a link mailed to an address
    // the user has since lost control of stops working.
    await this.repo.invalidateAuthTokens(user.id, "PASSWORD_RESET");

    const { token, hash } = this.tokens.createOneTimeToken();
    await this.repo.createAuthToken({
      userId: user.id,
      purpose: "PASSWORD_RESET",
      tokenHash: hash,
      expiresAt: new Date(Date.now() + ONE_TIME_TOKEN_TTL_MS),
      requestedIp: ctx.ipAddress,
    });

    await this.audit.append({
      action: "PASSWORD_RESET",
      actorUserId: user.id,
      ipAddress: ctx.ipAddress,
      metadata: { stage: "requested" },
    });

    // Returned so the caller can mail it. It is never logged, never audited,
    // and never placed in a response body.
    // ★ The token is issued even when the user has no email address.
    //
    // Many parents here have a phone number and no email, and refusing to
    // create a token for them would mean their account can never be recovered
    // at all — not even by an administrator reading the link out. Delivery is
    // the caller's problem and is conditional on `email`; issuing is not.
    return {
      token,
      email: user.email,
      name: `${user.lastName} ${user.firstName}`.trim(),
    };
  }

  async confirmPasswordReset(token: string, newPassword: string, ctx: RequestContext) {
    const errors = validatePasswordStrength(newPassword);
    if (errors.length > 0) throw new UnauthorizedException(errors.join(". "));

    const row = await this.repo.findAuthToken(hashToken(token), "PASSWORD_RESET");
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Холбоос хүчингүй эсвэл хугацаа нь дууссан байна");
    }

    await this.repo.consumeAuthToken(row.id);
    await this.repo.setPassword(row.userId, await this.passwords.hash(newPassword));

    // Changing a password must end every existing session. Otherwise a user
    // resetting because they believe they were compromised leaves the intruder
    // logged in.
    await this.repo.revokeAllUserSessions(row.userId);

    // Clear the lockout by every identifier this user can log in with.
    //
    // `LoginAttempt.identifier` is whatever was typed — deliberately, so that
    // failures against a non-existent username still count. That means it
    // cannot be cleared by user id, and a user locked out of their account
    // would stay locked out after a successful reset, which reads as the reset
    // silently not working.
    await this.clearLockoutForUser(row.userId);

    await this.audit.append({
      action: "PASSWORD_RESET",
      actorUserId: row.userId,
      ipAddress: ctx.ipAddress,
      metadata: { stage: "completed" },
    });
  }

  /**
   * Accepts an invitation: sets the first password on an account.
   *
   * ★ Until this runs the account cannot be opened by anyone.
   *
   * `UsersService.create` hashes 32 random bytes nobody ever sees, so the
   * account exists, holds a membership and is visible to an administrator, but
   * has no usable credential. This is what turns it into an account somebody
   * can log into — and it is the only thing that can, because the invitation
   * token is scoped to `INVITATION` and the reset endpoint only accepts
   * `PASSWORD_RESET`.
   *
   * ★★ Separate from `confirmPasswordReset` even though the body is identical.
   *
   * Folding them together would mean one code path where an invitation token
   * could reset an existing user's password — the token an administrator hands
   * out would become a way into an account that already has an owner. Two
   * purposes, two endpoints, two lookups.
   *
   * The failure message never distinguishes "unknown", "already used" and
   * "expired". Each of those tells someone holding a guessed token something
   * about it.
   */
  /**
   * What an invitation is for, before anybody types anything.
   *
   * ★ Public by necessity and deliberately thin.
   *
   * The acceptance form has to know whether to ask a guardian for a given name
   * and a relationship, or a member of staff for a surname and an e-mail. It
   * cannot know that from an opaque token, and encoding the answer in the URL
   * would let it be flipped by whoever holds the link.
   *
   * It also lets an expired invitation be reported *before* the password is
   * typed twice, which is the difference between "this link has expired" and a
   * red banner after the work.
   *
   * ★★ It returns a shape and a validity, never a name, an e-mail or a
   * kindergarten. An invitation token is 32 random bytes, so enumerating one is
   * not a real attack; leaking who it belongs to would be.
   */
  async describeInvitation(token: string): Promise<{ valid: boolean; kind: "staff" | "guardian" }> {
    const row = await this.repo.findAuthToken(hashToken(token), "INVITATION");
    const valid = Boolean(row && !row.usedAt && row.expiresAt.getTime() >= Date.now());

    // The kind of an invalid token is not knowledge worth handing out, and
    // "guardian" is the safer default for a form: it asks for less.
    if (!row || !valid) return { valid: false, kind: "guardian" };

    return { valid: true, kind: await this.repo.findInvitedAccountKind(row.userId) };
  }

  async acceptInvitation(
    token: string,
    password: string,
    profile: {
      firstName?: string;
      phone?: string;
      relation?: GuardianRelation;
      lastName?: string;
      email?: string;
    },
    ctx: RequestContext,
  ) {
    const errors = validatePasswordStrength(password);
    if (errors.length > 0) throw new UnauthorizedException(errors.join(". "));

    const row = await this.repo.findAuthToken(hashToken(token), "INVITATION");
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Урилга хүчингүй эсвэл хугацаа нь дууссан байна");
    }

    await this.repo.consumeAuthToken(row.id);
    await this.repo.setPassword(row.userId, await this.passwords.hash(password));

    /*
      ★ The guardian's own details, written now rather than guessed at invite.
      
      The account was created with a generated handle and the placeholder
      "Асран хамгаалагч" — see `createPlaceholderGuardianAccount`. This is where
      it becomes a person. The surname stays empty on purpose: the client asked
      for guardians to give a given name only.
      
      `relation` reaches every guardianship this user holds, which is correct
      and not a shortcut: a person invited twice for two siblings is the same
      father in both, and the invitation they just accepted is the only place
      they will ever be asked.
    */
    if (
      profile.firstName ||
      profile.phone ||
      profile.relation ||
      profile.lastName ||
      profile.email
    ) {
      await this.repo.completeInvitedProfile(row.userId, profile);
    }

    /*
     * Revoked for the same reason a reset does it, not because a fresh account
     * has sessions: an invitation can be re-issued for an existing user, and if
     * it ever is, whoever was logged in should be logged out by it.
     */
    await this.repo.revokeAllUserSessions(row.userId);
    await this.clearLockoutForUser(row.userId);

    await this.audit.append({
      // `ACTIVATE` already exists for exactly this — no new enum value, and so
      // no migration, for an action the audit vocabulary already names.
      action: "ACTIVATE",
      actorUserId: row.userId,
      ipAddress: ctx.ipAddress,
      metadata: { stage: "completed" },
    });
  }

  /** Changing your own password, while logged in. */
  async changePassword(actor: Actor, current: string, next: string, ctx: RequestContext) {
    const hash = await this.repo.getPasswordHash(actor.userId);
    if (!hash || !(await this.passwords.verify(hash, current))) {
      throw new UnauthorizedException("Одоогийн нууц үг буруу байна");
    }

    const errors = validatePasswordStrength(next);
    if (errors.length > 0) throw new UnauthorizedException(errors.join(". "));

    await this.repo.setPassword(actor.userId, await this.passwords.hash(next));
    // Every other session ends; the current one survives so the user is not
    // logged out of the tab they just used.
    await this.repo.revokeAllUserSessions(actor.userId, actor.sessionId);

    await this.audit.append({
      action: "PASSWORD_RESET",
      actorUserId: actor.userId,
      ipAddress: ctx.ipAddress,
      metadata: { stage: "changed_by_user" },
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Clears failed attempts recorded against any identifier this user can log in
   * with — username, email or phone. See the note at the call site for why this
   * cannot simply take a user id.
   */
  private async clearLockoutForUser(userId: string): Promise<void> {
    const user = await this.repo.findById(userId);
    if (!user) return;
    for (const identifier of [user.username, user.email, user.phone]) {
      if (identifier) await this.repo.clearFailures(identifier);
    }
  }

  private async issueSession(userId: string, familyId: string, ctx: RequestContext) {
    const { token: refreshToken, hash } = this.tokens.createRefreshToken();
    const session = await this.repo.createSession({
      userId,
      familyId,
      tokenHash: hash,
      expiresAt: this.tokens.refreshTokenExpiry(),
      userAgent: ctx.userAgent,
      ipAddress: ctx.ipAddress,
    });

    return {
      accessToken: this.tokens.signAccessToken({ sub: userId, sid: session.id }),
      refreshToken,
    };
  }

  /** ★ Not transactional, by design. See `login`. */
  private async recordFailure(
    identifier: string,
    ctx: RequestContext,
    reason: string,
    userId?: string,
  ) {
    await this.repo.recordAttempt(identifier, ctx.ipAddress, false);
    await this.audit.append({
      action: "LOGIN_FAILED",
      actorUserId: userId ?? null,
      // The identifier is recorded, the password never is.
      actorLabel: identifier,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { reason },
    });
  }
}

/** One message for every credential failure — never "no such user". */
const INVALID_CREDENTIALS = "Нэвтрэх нэр эсвэл нууц үг буруу байна";
const SESSION_EXPIRED = "Нэвтрэх хугацаа дууссан байна. Дахин нэвтэрнэ үү.";
