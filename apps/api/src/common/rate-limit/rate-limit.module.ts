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
 */
@Global()
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
