import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthService } from "../auth.service";
import { TokenService } from "../token.service";
import { ACCESS_COOKIE } from "../cookies";
import { IS_PUBLIC } from "../decorators/public.decorator";
import type { Actor } from "../../authz/actor";

/**
 * Authenticates every request from the access cookie and attaches the Actor.
 *
 * Registered globally, so a new controller is protected by default and opting
 * out requires writing `@Public()` — the safe direction. A forgotten decorator
 * makes an endpoint inaccessible, which someone notices immediately; the
 * inverse would make it public, which nobody notices.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { actor?: Actor }>();

    // Cookies only. A Bearer header is deliberately not accepted here: mixing
    // schemes on one endpoint would let a request bypass CSRF protection by
    // presenting a header instead of a cookie. Mobile clients get their own
    // bearer-authenticated routes later. docs/SECURITY.md §3.5.
    const token = (request.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException();

    const payload = this.tokens.verifyAccessToken(token);
    if (!payload) throw new UnauthorizedException();

    // Re-reads the session and memberships from the database. This is what
    // makes revocation immediate rather than token-lifetime-delayed.
    const actor = await this.auth.resolveActor(payload.sub, payload.sid);
    if (!actor) throw new UnauthorizedException();

    request.actor = actor;
    return true;
  }
}
