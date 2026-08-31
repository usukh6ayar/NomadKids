import { Module } from "@nestjs/common";
import {
  InvoicesController,
  KindergartenInvoicesController,
  PaymentsController,
} from "./invoices.controller";
import { InvoicesRepository } from "./invoices.repository";
import { InvoicesService } from "./invoices.service";

@Module({
  controllers: [KindergartenInvoicesController, InvoicesController, PaymentsController],
  providers: [InvoicesService, InvoicesRepository],
  exports: [InvoicesService, InvoicesRepository],
})
export class InvoicesModule {}
