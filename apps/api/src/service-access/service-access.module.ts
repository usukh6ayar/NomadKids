import { Module } from "@nestjs/common";
import { ReportsModule } from "../reports/reports.module";
import { ServiceAccessController } from "./service-access.controller";
import { ServiceAccessRepository } from "./service-access.repository";
import { ServiceAccessService } from "./service-access.service";

/** A kindergarten's own NomadKids access and its renewal invoice — #211. */
@Module({
  imports: [ReportsModule],
  controllers: [ServiceAccessController],
  providers: [ServiceAccessService, ServiceAccessRepository],
})
export class ServiceAccessModule {}
