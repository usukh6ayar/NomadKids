import { Injectable } from "@nestjs/common";

/**
 * Fixed-window rate limiting, in process memory.
 *
 * ★ In-memory means the limit is per instance. With one API container that is
 * the real limit; with several it becomes N× the configured value. That is an
 * accepted MVP trade-off, not an oversight — Redis is already in the stack for
 * BullMQ and swapping the backing store is a contained change behind this
 * interface.
 *
 * It is a *supplementary* control. The account lockout that actually protects
 * passwords lives in the database (`LoginAttempt`), survives restarts, and is
 * shared across instances. This layer exists to blunt volume.
 */
@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  /**
   * Records a hit and reports whether the caller is over the limit.
   *
   * @returns `allowed` plus seconds until the window resets, for Retry-After.
   */
  hit(key: string, limit: number, windowMs: number): RateLimitResult {
    this.sweep();

    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    return {
      allowed: bucket.count <= limit,
      remaining,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Test helper. */
  resetAll(): void {
    this.buckets.clear();
  }

  /**
   * Drops expired buckets. Without this the map grows by one entry per distinct
   * key forever, which for per-IP limits is unbounded and is a slow memory leak
   * that only shows up in production.
   */
  private sweep(): void {
    const now = Date.now();
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}
