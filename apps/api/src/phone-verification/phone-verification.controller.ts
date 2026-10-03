import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { Public } from "../auth/decorators/public.decorator";
import { RateLimit, RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  checkPhoneVerificationSchema,
  type CheckPhoneVerificationDto,
} from "./phone-verification.dto";
import { PhoneVerificationService } from "./phone-verification.service";

const HOUR = 60 * 60 * 1000;

/**
 * The two purpose-free routes. Starting a verification lives with the flow
 * that consumes it — `AuthController` for a reset and an invitation,
 * `UsersController` for one's own profile — because each binds it to a
 * different subject.
 */
@Controller("phone-verifications")
@UseGuards(RateLimitGuard)
export class PhoneVerificationController {
  constructor(private readonly service: PhoneVerificationService) {}

  /**
   * Whether this deployment verifies phones at all, so the forgot-password,
   * invitation and settings screens know whether to offer the step.
   */
  @Public()
  @Get("availability")
  availability(): { enabled: boolean } {
    return { enabled: this.service.enabled };
  }

  /**
   * The browser's poll, every three seconds while the person sends the SMS.
   *
   * ★ Rate-limited by IP but loosely: many Mongolian mobile users share a
   * carrier NAT address, and a tight per-IP limit on a three-second poll would
   * stall a whole network's verifications. The upstream call is what costs,
   * and the service throttles that per row whoever polls.
   */
  @Public()
  @Post("check")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 1200, windowMs: HOUR })
  async check(
    @Body(new ZodValidationPipe(checkPhoneVerificationSchema)) body: CheckPhoneVerificationDto,
  ) {
    return this.service.check(body.handle);
  }
}
