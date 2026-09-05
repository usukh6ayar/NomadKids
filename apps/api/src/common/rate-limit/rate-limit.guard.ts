import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import type { Actor } from "../../authz/actor";
import { RateLimitService } from "./rate-limit.service";

export const RATE_LIMIT = "rateLimit";

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /** Bucket by authenticated user rather than by IP, where a user exists. */
  byUser?: boolean;
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

    const subject =
      options.byUser && request.actor ? `user:${request.actor.userId}` : `ip:${clientIp(request)}`;
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
