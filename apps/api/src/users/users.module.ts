import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UsersController } from "./users.controller";
import { UsersRepository } from "./users.repository";
import { UsersService } from "./users.service";

@Module({
  // AuthModule supplies PasswordService, TokenService and AuthRepository —
  // creating a user issues an invitation token, which is auth machinery.
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
