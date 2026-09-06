import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * The rate limiter, against a real Redis.
 *
 * ★ Direct unit tests rather than through HTTP, which is unusual here — almost
 * everything in this suite goes through a route because a check that never runs
 * against the real one proves nothing (CLAUDE.md §4.1). The routes' own 429
 * behaviour is covered by `auth.test.ts` and the register files.
 *
 * What those cannot see is the **shape of the window**, and that is what this
 * file exists for. A limiter that blocks correctly and never unblocks passes
 * every "does it return 429" test ever written.
 *
 * ★★ The bug this was written for: the first Redis version ran `INCR` and
 * `EXPIRE` in a pipeline, setting the TTL on every hit. That turns a fixed
 * window into a sliding one — a client sending a request every few seconds
 * pushes the expiry forward faster than it elapses, so a 15-minute login
 * window never resets and the block becomes permanent. It was found by review,
 * not by a test, which is why there is now a test.
 */

const service = new RateLimitService();

/** A key nothing else in the suite will touch. */
function uniqueKey(): string {
  return `test:${Math.random().toString(36).slice(2, 10)}`;
}

beforeEach(async () => {
  await service.resetAll();
});

afterAll(async () => {
  await service.resetAll();
  await service.onApplicationShutdown();
});

describe("rate limiter", () => {
  it("allows up to the limit and refuses the next", async () => {
    const key = uniqueKey();

    for (let i = 1; i <= 3; i += 1) {
      const result = await service.hit(key, 3, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3 - i);
    }

    const over = await service.hit(key, 3, 60_000);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
  });

  /**
   * ★★★ The window is **fixed**, not sliding.
   *
   * The TTL must be set once, when the counter is created, and must then run
   * down whatever traffic arrives. This asserts it directly: the remaining
   * time after several hits is not greater than after the first.
   *
   * A sliding window would show the TTL back at (or near) the full duration on
   * every hit, and the block would never expire under sustained traffic.
   */
  it("does not extend the window on every hit", async () => {
    const key = uniqueKey();

    const first = await service.hit(key, 100, 60_000);
    expect(first.retryAfterSeconds).toBeLessThanOrEqual(60);

    // Enough real time to make an extension visible in whole seconds.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const later = await service.hit(key, 100, 60_000);

    // Strictly less: the window has been running down, not resetting.
    expect(later.retryAfterSeconds).toBeLessThan(first.retryAfterSeconds);
  });

  /**
   * ★ Retry-After describes *this* window, not a fresh one.
   *
   * A client told to wait the full 15 minutes on the fourteenth minute waits
   * twice as long as the limit actually asks — which on the login route reads
   * as the account being locked.
   */
  it("reports the time left in the current window, not the window length", async () => {
    const key = uniqueKey();

    await service.hit(key, 1, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const blocked = await service.hit(key, 1, 10_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeLessThan(10);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each key separately", async () => {
    const a = uniqueKey();
    const b = uniqueKey();

    await service.hit(a, 1, 60_000);
    const other = await service.hit(b, 1, 60_000);

    expect(other.allowed).toBe(true);
  });

  it("forgets a key on reset", async () => {
    const key = uniqueKey();

    await service.hit(key, 1, 60_000);
    expect((await service.hit(key, 1, 60_000)).allowed).toBe(false);

    await service.reset(key);
    expect((await service.hit(key, 1, 60_000)).allowed).toBe(true);
  });

  /**
   * ★ A window shorter than a second still gets one.
   *
   * `PEXPIRE` takes milliseconds so the script itself is fine, but
   * `retryAfterSeconds` must never come back as 0 on a refusal — a client told
   * to retry in zero seconds retries immediately and is refused again.
   */
  it("never tells a refused caller to retry in zero seconds", async () => {
    const key = uniqueKey();

    await service.hit(key, 1, 500);
    const blocked = await service.hit(key, 1, 500);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
