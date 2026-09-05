import { Global, Module } from "@nestjs/common";
import { RateLimitService } from "./rate-limit.service";

/**
 * ★ Global, so there is exactly ONE limiter instance.
 *
 * Nest creates a separate instance per module that lists a provider. Two
 * modules each declaring `RateLimitService` therefore get two independent
 * counters, and which one a request lands in depends on which module's guard
 * resolved it — so the effective limit becomes some multiple of the configured
 * one, varying by route.
 *
 * The symptom that exposed it was a test suite where `resetAll()` cleared one
 * instance while logins accumulated in the other until they hit 429. In
 * production it would have been quieter and worse: a documented limit of 5
 * login attempts silently behaving like 10.
 *
 * ★ Still global now that the counter lives in Redis, and for a smaller
 * reason: each instance opens its own connection, so two of them would be two
 * sockets and two shutdown hooks for one job. The correctness argument above
 * has moved to Redis — which is the point of the change.
 */
@Global()
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
