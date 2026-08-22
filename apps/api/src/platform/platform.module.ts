import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { PlatformController } from "./platform.controller";
import { PlatformRepository } from "./platform.repository";
import { PlatformService } from "./platform.service";

@Module({
  // AuthModule supplies PasswordService and TokenService; UsersModule supplies
  // UsersRepository for the identifier collision checks.
  imports: [AuthModule, UsersModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformRepository],
})
export class PlatformModule {}
