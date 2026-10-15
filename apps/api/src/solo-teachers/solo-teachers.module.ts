import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { AuthModule } from "../auth/auth.module";
import { PhoneVerificationModule } from "../phone-verification/phone-verification.module";
import { PublicKindergartensModule } from "../public-kindergartens/public-kindergartens.module";
import { SoloMergeController } from "./solo-merge.controller";
import { SoloMergeRepository } from "./solo-merge.repository";
import { SoloMergeService } from "./solo-merge.service";
import { SoloTeachersController } from "./solo-teachers.controller";
import { SoloTeachersRepository } from "./solo-teachers.repository";
import { SoloTeachersService } from "./solo-teachers.service";

/** A solo teacher's sign-up. `AuthModule` for `PasswordService`, verify.mn for the phone. */
@Module({
  imports: [AuthModule, PhoneVerificationModule, PublicKindergartensModule, UsersModule],
  controllers: [SoloTeachersController, SoloMergeController],
  providers: [SoloTeachersService, SoloTeachersRepository, SoloMergeService, SoloMergeRepository],
})
export class SoloTeachersModule {}
