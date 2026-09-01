import { Module } from "@nestjs/common";
import {
  ChildInvoicesController,
  InvoicesController,
  KindergartenInvoicesController,
  PaymentsController,
} from "./invoices.controller";
import { InvoicesRepository } from "./invoices.repository";
import { InvoicesService } from "./invoices.service";

@Module({
  controllers: [
    ChildInvoicesController,
    KindergartenInvoicesController,
    InvoicesController,
    PaymentsController,
  ],
  providers: [InvoicesService, InvoicesRepository],
  exports: [InvoicesService, InvoicesRepository],
})
export class InvoicesModule {}
