import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { loadEnv, type Env } from "../../config/env";
import { CSRF_COOKIE } from "../cookies";
import { IS_PUBLIC } from "../decorators/public.decorator";
import { safeEqual } from "../token.service";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_HEADER = "x-csrf-token";

/**
 * Double-submit CSRF protection plus an origin check.
 *
 * `SameSite=Lax` already stops a third-party site causing a credentialed POST,
 * so this is a second layer. It is kept because:
 *
 *   - Lax still permits the cookie on a top-level cross-site GET navigation,
 *     which is safe only while no GET mutates state — a property that has to
 *     hold forever, not just today.
 *   - Lax says nothing about another host on nomadkids.mn itself. Same-site is
 *     weaker than same-origin.
 *   - If a deployment ever moved the API to another registrable domain, Lax
 *     would silently stop applying. The guarantee should live in the layer that
 *     does not depend on deployment topology.
 *
 * docs/SECURITY.md §3.3.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly env: Env;

  constructor(private readonly reflector: Reflector) {
    this.env = loadEnv();
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method)) return true;

    // Origin check first — it is cheap and catches the plain cross-site case.
    const origin = request.headers.origin;
    if (origin && !this.env.CORS_ORIGINS.includes(origin)) {
      throw new ForbiddenException("Хүсэлтийн эх сурвалж зөвшөөрөгдөөгүй");
    }

    // Public unsafe endpoints (login, password reset) have no session cookie to
    // pair with, so the origin check above is their protection.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const cookie = (request.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
    const header = request.headers[CSRF_HEADER];

    if (!cookie || typeof header !== "string" || !safeEqual(cookie, header)) {
      throw new ForbiddenException("CSRF шалгалт амжилтгүй боллоо");
    }

    return true;
  }
}
