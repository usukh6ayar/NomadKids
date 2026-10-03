import { Module } from "@nestjs/common";
import { loadEnv } from "../config/env";
import { VerifyMnClient } from "../integrations/verify-mn/verify-mn.client";
import { VerifyMnConfig } from "../integrations/verify-mn/verify-mn.config";
import { PhoneVerificationController } from "./phone-verification.controller";
import { PhoneVerificationRepository } from "./phone-verification.repository";
import { PhoneVerificationService } from "./phone-verification.service";

/**
 * Phone verification through verify.mn — 2026-10-01.
 *
 * Imported by `AuthModule` (password reset, invitation) and `UsersModule`
 * (own profile), which own the routes that start and consume a proof.
 */
@Module({
  controllers: [PhoneVerificationController],
  providers: [
    // A factory, same reason as `QpayModule`: the config takes the parsed `Env`.
    { provide: VerifyMnConfig, useFactory: () => new VerifyMnConfig(loadEnv()) },
    VerifyMnClient,
    PhoneVerificationRepository,
    PhoneVerificationService,
  ],
  exports: [PhoneVerificationService],
})
export class PhoneVerificationModule {}
