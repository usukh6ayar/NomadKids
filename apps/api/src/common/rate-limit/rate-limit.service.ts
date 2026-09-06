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
 * ★★ **One Lua script, not `GET`/`SET` and not a pipeline.**
 *
 * Read-modify-write across a network is the race a shared counter exists to
 * avoid: two processes both read 4, both write 5, and the sixth request
 * through a limit of 5 is allowed. `INCR` is atomic server-side, which fixes
 * that half.
 *
 * The other half is subtler and the first version of this file got it wrong.
 * It ran `INCR` and `EXPIRE` in a pipeline, setting the TTL on **every** hit —
 * which turns a fixed window into a sliding one. A client sending a request
 * every few seconds pushes the expiry forward faster than it elapses, so a
 * 15-minute window never resets and the block is permanent rather than
 * temporary. On the login route that is a lockout with no way out but waiting
 * for traffic to stop entirely.
 *
 * So the TTL is set only when the counter is new — or when the key somehow has
 * none, which would otherwise make it immortal. `INCR` and the conditional
 * `PEXPIRE` have to be atomic with respect to each other, and a `MULTI` cannot
 * branch on the result of a command inside it. Hence `EVAL`.
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
    /*
     * ★ Three attempts, then fail open rather than hold the request. A limiter
     * that queues indefinitely behind an unreachable Redis turns a
     * supplementary control into the slowest thing in every request.
     *
     * ★★ The offline queue stays **on**, which the first version turned off.
     *
     * `enableOfflineQueue: false` rejects a command outright while the socket
     * is still connecting — so the first requests after a deploy would have
     * gone uncounted, and every one of them logged as a Redis outage. On the
     * login route that is exactly the window an attacker would want. With the
     * queue on, those commands wait for the connection instead, and
     * `maxRetriesPerRequest` is what still bounds a genuine outage.
     *
     * It was found by a unit test whose first assertion read `remaining: 3`
     * where it expected 2 — the fail-open value, on a Redis that was up.
     */
    maxRetriesPerRequest: 3,
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
       * ★ The remaining TTL comes back with the count, in the same call.
       *
       * Retry-After has to say how long is left in *this* window, not how long
       * a fresh one lasts — a client told to wait the full 15 minutes on the
       * fourteenth minute waits twice as long as the limit actually asks.
       */
      const result = (await this.redis.eval(HIT_SCRIPT, 1, namespaced, String(windowMs))) as [
        number,
        number,
      ];

      const count = Number(result?.[0] ?? 0);
      const pttl = Number(result?.[1] ?? windowMs);

      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        // `pttl` is -1 (no expiry) or -2 (no key) only if the key vanished
        // between the script's own commands, which it cannot — but neither is
        // a duration a client can wait, so the window length is the fallback.
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

/**
 * Increment, and set the expiry only if the window is new.
 *
 * ★ `count == 1` is the new-window case. The `pttl < 0` clause covers a key
 * that exists without a TTL — which this script cannot produce, but a manual
 * `redis-cli SET` or an older build of this file could have left behind, and
 * an immortal counter is a permanent block.
 *
 * Returns `{count, pttl}` so the caller needs no second round trip.
 */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local pttl = redis.call('PTTL', KEYS[1])
if count == 1 or pttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  pttl = tonumber(ARGV[1])
end
return {count, pttl}
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}
