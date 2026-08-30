import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { DashboardModule } from "../dashboard/dashboard.module";
import { UsersModule } from "../users/users.module";
import { PlatformController } from "./platform.controller";
import { PlatformRevenueController } from "./platform-revenue.controller";
import { PlatformRevenueRepository } from "./platform-revenue.repository";
import { PlatformRevenueService } from "./platform-revenue.service";
import { PlatformRepository } from "./platform.repository";
import { PlatformService } from "./platform.service";

@Module({
  // AuthModule supplies PasswordService and TokenService; UsersModule supplies
  // UsersRepository for the identifier collision checks; DashboardModule
  // supplies DashboardRepository, reused for the detail view's stats.
  imports: [AuditModule, AuthModule, UsersModule, DashboardModule],
  controllers: [PlatformController, PlatformRevenueController],
  providers: [
    PlatformService,
    PlatformRepository,
    PlatformRevenueService,
    PlatformRevenueRepository,
  ],
})
export class PlatformModule {}
