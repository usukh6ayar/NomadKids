import { Module } from "@nestjs/common";
import { SoloRulesRepository } from "./solo-rules.repository";
import { SoloRulesService } from "./solo-rules.service";

/** No imports, so `UsersModule` and `TenantsModule` can use it without a cycle. */
@Module({
  providers: [SoloRulesService, SoloRulesRepository],
  exports: [SoloRulesService],
})
export class SoloRulesModule {}
