import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RateLimit, RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import type { Actor } from "../authz/actor";
import { AuthService, type RequestContext } from "./auth.service";
import {
  changePasswordSchema,
  loginSchema,
  invitationAcceptSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  type ChangePasswordDto,
  type LoginDto,
  type InvitationAcceptDto,
  type PasswordResetConfirmDto,
  type PasswordResetRequestDto,
} from "./auth.dto";
import { clearAuthCookies, CSRF_COOKIE, REFRESH_COOKIE, setAuthCookies } from "./cookies";
import { CurrentActor } from "./decorators/actor.decorator";
import { Public } from "./decorators/public.decorator";
import { AuthzRepository } from "../authz/authz.repository";
import { AuthRepository } from "./auth.repository";
import { MailService } from "../mail/mail.service";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

@Controller("auth")
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly authz: AuthzRepository,
    private readonly users: AuthRepository,
    private readonly mail: MailService,
  ) {}

  /**
   * Password login.
   *
   * Tokens go into HttpOnly cookies and are never in the response body — the
   * body carries only what the UI needs to render. A token in JSON is a token
   * some frontend eventually puts in localStorage.
   *
   * ★ The per-IP limit is 60, not 10, and the difference matters.
   *
   * Brute force is stopped by the **per-identifier** lockout in `AuthService`:
   * five failures against one account locks it for fifteen minutes, and that
   * counter lives in the database, survives a restart and is shared across
   * instances. That is the control doing the real work.
   *
   * This limit is supplementary, and it is keyed by IP — which in a
   * kindergarten is *one address for the entire building*. At 10 per fifteen
   * minutes, eight teachers signing in at 8am plus one person mistyping twice
   * exhausts it, and nobody in the building can log in until the window rolls.
   * The staff would experience the security control as the product being
   * broken, on the first morning, with no way to tell why.
   *
   * 60 is high enough that shared-NAT staff never reach it, and still four
   * attempts a minute — useless as a spray rate against accounts each of which
   * locks after five failures.
   *
   * Found in Phase 12 by hitting it with the QA probes. docs/SECURITY.md §9.
   */
  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 60, windowMs: 15 * MINUTE })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body.identifier, body.password, context(req));
    const csrfToken = randomBytes(24).toString("base64url");

    setAuthCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      csrfToken,
    });

    const memberships = await this.authz.loadMemberships(result.user.id);
    return { user: result.user, memberships, csrfToken };
  }

  /**
   * Rotates the refresh token.
   *
   * Public because the access token has expired by definition — the refresh
   * cookie is the credential. It carries its own rate limit: a client looping
   * on refresh is either broken or hostile.
   */
  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  /*
   * ★ Counted per session, not per IP — 2026-09-06.
   *
   * The browser began calling this on a timer when the refresh flow landed;
   * before that nothing called it at all. At a 15-minute access token that is
   * four refreshes an hour per signed-in tab, so `60` counted per IP is
   * fifteen people behind one kindergarten's router — after which everybody
   * else is signed out. See `bySession` in `rate-limit.guard.ts`.
   *
   * 60 per session per hour is still ten times what a well-behaved client
   * needs, and a client looping on refresh is either broken or hostile.
   */
  @RateLimit({ limit: 60, windowMs: HOUR, bySession: true })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = cookie(req, REFRESH_COOKIE);
    if (!token) {
      clearAuthCookies(res);
      return { user: null };
    }

    try {
      const result = await this.auth.refresh(token, context(req));
      const csrfToken = cookie(req, CSRF_COOKIE) ?? randomBytes(24).toString("base64url");
      setAuthCookies(res, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        csrfToken,
      });
      const memberships = await this.authz.loadMemberships(result.user.id);
      return { user: result.user, memberships, csrfToken };
    } catch (error) {
      // A refused refresh must clear the cookies, or the browser retries the
      // same dead token forever and the user sees a login page that never works.
      clearAuthCookies(res);
      throw error;
    }
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(cookie(req, REFRESH_COOKIE), actor, context(req));
    clearAuthCookies(res);
  }

  /** The current user, their memberships and a CSRF token. */
  @Get("me")
  async me(@CurrentActor() actor: Actor, @Req() req: Request) {
    const user = await this.users.findById(actor.userId);
    return { user, memberships: actor.memberships, csrfToken: cookie(req, CSRF_COOKIE) ?? null };
  }

  /**
   * Requests a password reset.
   *
   * ★ Always 204, whether or not the identifier exists. Anything else turns
   * this into a user-enumeration endpoint. The service burns equivalent work on
   * the missing-user path so the timing does not leak either.
   */
  @Public()
  @Post("password-reset")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 20, windowMs: HOUR })
  async requestPasswordReset(
    @Body(new ZodValidationPipe(passwordResetRequestSchema)) body: PasswordResetRequestDto,
    @Req() req: Request,
  ): Promise<void> {
    const result = await this.auth.requestPasswordReset(body.identifier, context(req));

    // ★ Delivery is fire-and-forget with respect to the response.
    //
    // The endpoint returns 204 whether or not the identifier exists, whether or
    // not SMTP is configured, and whether or not the send succeeded. Any of
    // those varying — in status, body or timing — turns this into a user
    // enumeration oracle, which is the whole reason the service burns an argon2
    // verification on the missing-user path.
    //
    // A failure is the operator's problem, logged by MailService. It is never
    // the requester's, because telling them "we could not email you" confirms
    // the account exists.
    if (result?.email) {
      await this.mail.sendPasswordReset(result.email, result.token, result.name);
    }
  }

  @Public()
  @Post("password-reset/confirm")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 10, windowMs: HOUR })
  async confirmPasswordReset(
    @Body(new ZodValidationPipe(passwordResetConfirmSchema)) body: PasswordResetConfirmDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.confirmPasswordReset(body.token, body.password, context(req));
    // Every session was revoked server-side; clear this browser's cookies too.
    clearAuthCookies(res);
  }

  /**
   * Accepts an invitation and sets the first password.
   *
   * Public, because by definition the person cannot log in yet — the account
   * has no usable credential until this succeeds.
   *
   * Rate-limited like the reset confirmation: the token is the only thing
   * standing between a guesser and a new account, so the endpoint must not be
   * cheap to hammer.
   */
  /**
   * What an invitation is for, so the form can ask the right questions and can
   * report an expired link before the password is typed twice.
   *
   * Public for the same reason `accept` is: the person cannot log in yet.
   * Rate-limited more loosely than the acceptance — this reads nothing and
   * changes nothing — but limited all the same, so it cannot become a cheap
   * oracle for whether a token is live.
   */
  @Public()
  @Get("invitation/:token")
  @RateLimit({ limit: 30, windowMs: HOUR })
  async describeInvitation(
    @Param("token") token: string,
  ): Promise<{ valid: boolean; kind: "staff" | "guardian" }> {
    return this.auth.describeInvitation(token);
  }

  @Public()
  @Post("invitation/accept")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 10, windowMs: HOUR })
  async acceptInvitation(
    @Body(new ZodValidationPipe(invitationAcceptSchema)) body: InvitationAcceptDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.acceptInvitation(
      body.token,
      body.password,
      {
        firstName: body.firstName,
        phone: body.phone,
        relation: body.relation,
        lastName: body.lastName,
        email: body.email,
      },
      context(req),
    );
    // Any session this account had was revoked server-side; clear the browser's
    // cookies too, so the next step is a deliberate login.
    clearAuthCookies(res);
  }

  @Post("password")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 10, windowMs: HOUR, byUser: true })
  async changePassword(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.changePassword(actor, body.currentPassword, body.newPassword, context(req));
  }
}

function context(req: Request): RequestContext {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  };
}

function cookie(req: Request, name: string): string | undefined {
  return (req.cookies as Record<string, string> | undefined)?.[name];
}
