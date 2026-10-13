import { Module } from "@nestjs/common";
import { MyAgreementsController, PlatformAgreementsController } from "./agreements.controller";
import { AgreementsRepository } from "./agreements.repository";
import { AgreementsService } from "./agreements.service";

/** User agreements (#211). `AuthzModule` and `AuditModule` are global. */
@Module({
  controllers: [MyAgreementsController, PlatformAgreementsController],
  providers: [AgreementsService, AgreementsRepository],
})
export class AgreementsModule {}
