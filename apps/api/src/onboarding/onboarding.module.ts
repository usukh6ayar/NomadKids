import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthzModule } from "../authz/authz.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ReportsModule } from "../reports/reports.module";
import { ApplicationsController, PlatformApplicationsController } from "./onboarding.controller";
import { OnboardingRepository } from "./onboarding.repository";
import { OnboardingService } from "./onboarding.service";

/**
 * Onboarding — `docs/CONTRACT_ONBOARDING.md` steps 1–4.
 *
 * ★ `ReportsModule` is imported for the contract PDF, which rides the existing
 * BullMQ + Chromium pipeline rather than a second one. CLAUDE.md §6: a PDF is
 * ~2.5 seconds and never happens inside a request.
 */
@Module({
  imports: [PrismaModule, AuthzModule, AuditModule, ReportsModule],
  controllers: [ApplicationsController, PlatformApplicationsController],
  providers: [OnboardingRepository, OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
