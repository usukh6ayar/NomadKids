import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { Actor } from "../../authz/actor";
import { RateLimitService } from "./rate-limit.service";
import { REFRESH_COOKIE } from "../../auth/cookies";

export const RATE_LIMIT = "rateLimit";

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /** Bucket by authenticated user rather than by IP, where a user exists. */
  byUser?: boolean;
  /**
   * Bucket by the **refresh cookie** rather than by IP, where one is present.
   *
   * ★ For `POST /auth/refresh`, which has no `actor` — the access token has
   * expired by definition, so `byUser` cannot work — and which every signed-in
   * browser now calls on a timer.
   *
   * With an access token lasting 15 minutes each session refreshes four times
   * an hour, so an IP-wide limit of 60 is **fifteen people** behind one
   * kindergarten's router. The sixteenth gets a 429, the retry fails, and they
   * are signed out — the exact symptom the refresh flow was added to remove,
   * reappearing as a building-wide outage at the busiest moment of the morning.
   *
   * The cookie is hashed, never stored: a rate-limit key lives in Redis, and a
   * refresh token in Redis is a credential in a cache.
   */
  bySession?: boolean;
}

export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT, options);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  /**
   * ★ `async` since 2026-09-05, because the limiter counts in Redis.
   *
   * Nest awaits a guard that returns a promise, so this is the whole cost of
   * moving the counter out of process memory — which is what the service's
   * previous docblock predicted and what criterion 6 needed.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const response = context.switchToHttp().getResponse<Response>();

    const subject = bucketFor(options, request);
    const key = `${request.method}:${request.route?.path ?? request.path}:${subject}`;

    const result = await this.limiter.hit(key, options.limit, options.windowMs);
    response.setHeader("X-RateLimit-Remaining", String(result.remaining));

    if (!result.allowed) {
      response.setHeader("Retry-After", String(result.retryAfterSeconds));
      throw new HttpException(
        "Хэт олон хүсэлт илгээлээ. Түр хүлээнэ үү.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}

/**
 * Which bucket this request counts against.
 *
 * Falls back to the IP whenever the preferred identifier is absent — an
 * unauthenticated request under `byUser`, or a refresh with no cookie under
 * `bySession`. That fallback is deliberate: those are exactly the requests
 * that have no session to protect and most need a per-IP ceiling.
 */
function bucketFor(options: RateLimitOptions, request: Request & { actor?: Actor }): string {
  if (options.byUser && request.actor) return `user:${request.actor.userId}`;

  if (options.bySession) {
    const token = (request.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    // Hashed, and truncated: the key only has to be unique, and a full digest
    // in a Redis key is more of the credential than anything needs.
    if (token) {
      return `sid:${createHash("sha256").update(token).digest("base64url").slice(0, 22)}`;
    }
  }

  return `ip:${clientIp(request)}`;
}

/**
 * The client IP.
 *
 * ★ `X-Forwarded-For` is only meaningful when a trusted proxy set it. Express's
 * `trust proxy` setting decides that, and it is configured in main.ts to trust
 * exactly one hop — the platform's load balancer. Without that, a client can
 * send its own header and every per-IP limit becomes decorative.
 */
function clientIp(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? "unknown";
}
