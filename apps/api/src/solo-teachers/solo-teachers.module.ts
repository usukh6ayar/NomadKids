import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SoloTeachersController } from "./solo-teachers.controller";
import { SoloTeachersRepository } from "./solo-teachers.repository";
import { SoloTeachersService } from "./solo-teachers.service";

/** A solo teacher's sign-up. `AuthModule` for `PasswordService` and `TokenService`. */
@Module({
  imports: [AuthModule],
  controllers: [SoloTeachersController],
  providers: [SoloTeachersService, SoloTeachersRepository],
})
export class SoloTeachersModule {}
