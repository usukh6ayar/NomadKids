import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DashboardModule } from "../dashboard/dashboard.module";
import { UsersModule } from "../users/users.module";
import { PlatformController } from "./platform.controller";
import { PlatformRepository } from "./platform.repository";
import { PlatformService } from "./platform.service";

@Module({
  // AuthModule supplies PasswordService and TokenService; UsersModule supplies
  // UsersRepository for the identifier collision checks; DashboardModule
  // supplies DashboardRepository, reused for the detail view's stats.
  imports: [AuthModule, UsersModule, DashboardModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformRepository],
})
export class PlatformModule {}
