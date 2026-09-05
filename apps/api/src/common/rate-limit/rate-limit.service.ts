import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import IORedis, { type Redis } from "ioredis";
import { loadEnv } from "../../config/env";

/**
 * Fixed-window rate limiting, counted in Redis.
 *
 * ★ **It used to count in process memory, and that was the thing standing
 * between this deployment and more than one API process.**
 *
 * The previous version's own docblock said so: "In-memory means the limit is
 * per instance. With one API container that is the real limit; with several it
 * becomes N× the configured value. That is an accepted MVP trade-off, not an
 * oversight — Redis is already in the stack for BullMQ and swapping the
 * backing store is a contained change behind this interface." Order А/261's
 * criterion 6 (20,000 concurrent users) is what finally needed the several,
 * and the change was indeed contained: one call site, in `RateLimitGuard`.
 *
 * It remains a *supplementary* control. The account lockout that actually
 * protects passwords lives in the database (`LoginAttempt`), survives
 * restarts, and was already shared across instances. This layer blunts volume.
 *
 * ★★ **`INCR` then `EXPIRE`, in one pipeline, not `GET`/`SET`.**
 *
 * Read-modify-write across a network is exactly the race a shared counter
 * exists to avoid: two processes both read 4, both write 5, and the sixth
 * request through a limit of 5 is allowed. `INCR` is atomic server-side, and
 * the `EXPIRE` beside it is what makes the window fixed — set unconditionally
 * rather than only on the first hit, which would leave a key immortal if a
 * process died between the two commands.
 *
 * ★★★ **It fails open, and says so loudly.**
 *
 * If Redis is unreachable the request is allowed. That is the deliberate
 * choice: this is a volume control, the real credential protection is in
 * Postgres, and a Redis outage that locked every parent out of the portal
 * would be a worse incident than the one it prevented. The alternative —
 * fail closed — turns a cache outage into a total outage. Every failure is
 * logged at `error`, because "the limiter is silently off" is precisely the
 * state nobody notices.
 */
@Injectable()
export class RateLimitService implements OnApplicationShutdown {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly env = loadEnv();

  /**
   * ★ Namespaced, and the test namespace is separate — `ReportsQueue`'s
   * `queuePrefix` makes the same split for the same reason. A developer's
   * running server and the integration suite share one Redis, and a login
   * counted by both would exhaust a limit of 5 in a way that reads as a test
   * defect rather than as interference.
   */
  private readonly prefix = this.env.NODE_ENV === "test" ? "rl-test:" : "rl:";

  private readonly redis: Redis = new IORedis(this.env.REDIS_URL, {
    // Three attempts, then fail open rather than hold the request. A limiter
    // that queues behind an unreachable Redis turns a supplementary control
    // into the slowest thing in the request.
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
  });

  /**
   * Records a hit and reports whether the caller is over the limit.
   *
   * @returns `allowed` plus seconds until the window resets, for Retry-After.
   */
  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const namespaced = this.prefix + key;
    const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

    try {
      /*
       * ★ `pttl` is read in the same round trip as the increment.
       *
       * Retry-After has to say how long is left in *this* window, not how long
       * a fresh one lasts — a client told to wait the full 15 minutes on the
       * fourteenth minute waits twice as long as the limit actually asks.
       */
      const results = await this.redis
        .multi()
        .incr(namespaced)
        .expire(namespaced, windowSeconds)
        .pttl(namespaced)
        .exec();

      if (!results) return this.failOpen(limit, new Error("Redis MULTI returned null"));

      const count = Number(results[0]?.[1] ?? 0);
      const pttl = Number(results[2]?.[1] ?? windowMs);

      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        // `pttl` is -1 (no expiry) or -2 (no key) in the races where the key
        // vanished between commands; neither is a duration a client can wait.
        retryAfterSeconds: pttl > 0 ? Math.ceil(pttl / 1000) : windowSeconds,
      };
    } catch (error) {
      return this.failOpen(limit, error);
    }
  }

  async reset(key: string): Promise<void> {
    try {
      await this.redis.del(this.prefix + key);
    } catch (error) {
      this.logger.error(`Rate-limit reset failed for ${key}`, error);
    }
  }

  /**
   * Test helper — clears every counter in this namespace.
   *
   * ★ `SCAN`, not `KEYS`. `KEYS` blocks Redis for the length of the keyspace,
   * and this runs in a `beforeEach` that fires eighteen hundred times against
   * the same Redis a developer's server may also be using.
   */
  async resetAll(): Promise<void> {
    try {
      const pattern = `${this.prefix}*`;
      let cursor = "0";
      do {
        const [next, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
        cursor = next;
        if (keys.length > 0) await this.redis.del(...keys);
      } while (cursor !== "0");
    } catch (error) {
      this.logger.error("Rate-limit resetAll failed", error);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }

  private failOpen(limit: number, error: unknown): RateLimitResult {
    this.logger.error(
      "Rate limiter unavailable — request allowed without counting. " +
        "Account lockout (LoginAttempt) is unaffected.",
      error,
    );
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}
