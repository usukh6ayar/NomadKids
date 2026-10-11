import { Module } from "@nestjs/common";
import { SoloRulesModule } from "../solo-teachers/solo-rules.module";
import { TenantsController } from "./tenants.controller";
import { TenantsRepository } from "./tenants.repository";
import { TenantsService } from "./tenants.service";

@Module({
  // SoloRulesModule: a solo teacher's workspace keeps one group.
  imports: [SoloRulesModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantsRepository],
  exports: [TenantsService, TenantsRepository],
})
export class TenantsModule {}
