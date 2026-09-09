import { Module } from "@nestjs/common";
import { ChildrenController } from "./children.controller";
import { ChildrenRepository } from "./children.repository";
import { ChildrenService } from "./children.service";
import { UsersModule } from "../users/users.module";
import { EsisModule } from "../integrations/esis/esis.module";

@Module({
  // For `UsersService.createGuardianAccount` — a teacher inviting a family
  // creates the account through the same routine an administrator uses.
  imports: [UsersModule, EsisModule],
  controllers: [ChildrenController],
  providers: [ChildrenService, ChildrenRepository],
  exports: [ChildrenService, ChildrenRepository],
})
export class ChildrenModule {}
