import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { teacherSignupSchema, type TeacherSignup } from "@kinder/contracts";
import type { Request } from "express";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RateLimit, RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { Public } from "../auth/decorators/public.decorator";
import {
  startPhoneVerificationSchema,
  type StartPhoneVerificationDto,
} from "../phone-verification/phone-verification.dto";
import { SoloTeachersService } from "./solo-teachers.service";

const HOUR = 60 * 60 * 1000;

/**
 * «Багш» → «Бүртгүүлэх» on the pricing page. Public, and each sign-up creates
 * a workspace, so five an hour from one address — enough for a staffroom
 * signing up together, too few to fill the tenant table.
 */
@Controller("teacher-applications")
@UseGuards(RateLimitGuard)
export class SoloTeachersController {
  constructor(private readonly service: SoloTeachersService) {}

  @Public()
  @Post()
  @RateLimit({ limit: 5, windowMs: HOUR })
  signup(
    @Body(new ZodValidationPipe(teacherSignupSchema)) dto: TeacherSignup,
    @Req() req: Request,
  ) {
    return this.service.signup(dto, req.ip ?? null);
  }

  /**
   * The SMS proving the form's phone (2026-10-14), before any account exists.
   * The person texts *from* the phone, so this cannot be turned on a
   * stranger's number; the limit matches the password reset's.
   */
  @Public()
  @Post("phone")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, windowMs: HOUR })
  startPhoneVerification(
    @Body(new ZodValidationPipe(startPhoneVerificationSchema)) body: StartPhoneVerificationDto,
    @Req() req: Request,
  ) {
    return this.service.startPhoneVerification(body.phone, req.ip ?? null);
  }
}
