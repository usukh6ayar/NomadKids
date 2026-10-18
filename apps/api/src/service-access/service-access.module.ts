import { Module } from "@nestjs/common";
import { QpayModule } from "../integrations/qpay/qpay.module";
import { ReportsModule } from "../reports/reports.module";
import { ContractPaymentsController } from "./contract-payments.controller";
import { ContractPaymentsRepository } from "./contract-payments.repository";
import { ContractPaymentsService } from "./contract-payments.service";
import { ServiceAccessController } from "./service-access.controller";
import { ServiceAccessRepository } from "./service-access.repository";
import { ServiceAccessService } from "./service-access.service";

/** A kindergarten's own NomadKids access and its renewal invoice — #211. */
@Module({
  imports: [ReportsModule, QpayModule],
  controllers: [ServiceAccessController, ContractPaymentsController],
  providers: [
    ServiceAccessService,
    ServiceAccessRepository,
    ContractPaymentsService,
    ContractPaymentsRepository,
  ],
})
export class ServiceAccessModule {}
